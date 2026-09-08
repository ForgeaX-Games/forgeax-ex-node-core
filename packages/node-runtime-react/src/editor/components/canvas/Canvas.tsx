// Main canvas component: the core ReactFlow visualisation surface. This file is
// the shell — local state, hook assembly, and JSX render; the interaction logic
// lives in the extracted canvas hooks:
//   useCanvasGraphSync — rebuild RF nodes/edges from the store + agent selection
//   useCanvasConnect   — connection creation, type validation, handle pulse
//   useCanvasDrop      — drop a battery from the palette
//   useCanvasDelete    — node / edge deletion + dynamic-port shrink
//   useCanvasGrid      — grid CSS-var updates on pan/zoom
//
// Split for clarity from the legacy 1664-LOC Canvas.tsx: the rendered DOM, CSS
// class names, ReactFlow wiring and node/edge type registration are identical.
// Group view, frames, snap guides, ctrl-drag ghost and copy/paste are all wired
// here via their extracted hooks. The only legacy couplings intentionally left
// out are APP-LEVEL chrome (the embedded renderer iframe) — a consumer injects
// those through Editor props, not the generic canvas.
import { useCallback, useState, useRef, useMemo, useEffect } from 'react'
import ReactFlow, {
  MiniMap,
  Panel,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useViewport,
  SelectionMode,
  type Node,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
  type OnSelectionChangeParams,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { Connection } from 'reactflow'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import type { Battery, BatteryPort } from '../../types.js'
import { createCanvasNodeTypes, edgeTypes } from './canvasConstants.js'
import { ContextMenuPortal, type ContextMenuState } from './BatteryNode.js'
import { CanvasSearchPopover } from './CanvasSearchPopover.js'
import { useCanvasGraphSync, buildCanvasNodes, buildCanvasEdges } from './useCanvasGraphSync.js'
import { useCanvasConnect } from './useCanvasConnect.js'
import { useCanvasDrop } from './useCanvasDrop.js'
import { useCanvasDelete } from './useCanvasDelete.js'
import { useCanvasGrid } from './useCanvasGrid.js'
import { useCanvasGroup } from './useCanvasGroup.js'
import { useCanvasCopyPaste } from './useCanvasCopyPaste.js'
import { useCanvasSnap } from './useCanvasSnap.js'
import { useCanvasFrames } from './useCanvasFrames.js'
import { useCanvasUndoRedo } from './useCanvasUndoRedo.js'
import { useCtrlDragGhost } from './useCtrlDragGhost.js'
import { useCanvasRelayInteractions } from './useCanvasRelayInteractions.js'
import {
  useCanvasGroupView,
  BOUNDARY_EDGE_PREFIX,
  isGroupContextInputNodeId,
  isGroupContextOutputNodeId,
} from './useCanvasGroupView.js'
import GroupBreadcrumb from './GroupBreadcrumb.js'
import { getPortTypeColor } from '../../utils/portTypes.js'
import { useHistoryStore } from '../../stores/index.js'
import './Canvas.css'
import type { DomainPortTypes } from '../../utils/portTypes.js'

interface CanvasProps {
  domainNodeTypes?: Record<string, NodeTypes[string]>
  domainPortTypes?: DomainPortTypes
}

function Canvas({ domainNodeTypes, domainPortTypes }: CanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)

  // Precise selectors: action refs are stable; state fields only re-render on
  // their own change, so 60fps updateNodeParam doesn't re-render the shell.
  const setSelectedNode = usePipelineStore((s) => s.setSelectedNode)
  const setSelectedNodeIds = usePipelineStore((s) => s.setSelectedNodeIds)
  const setNodePreview = usePipelineStore((s) => s.setNodePreview)
  const moveAnnotation = usePipelineStore((s) => s.moveAnnotation)
  const searchBatteries = usePipelineStore((s) => s.batteries)
  const searchLangMode = useUIStore((s) => s.langMode)

  // Local ReactFlow node / edge state.
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useEdgesState([])
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const activeNodeTypes = useMemo(() => createCanvasNodeTypes(domainNodeTypes, domainPortTypes), [domainNodeTypes, domainPortTypes])

  // Snap-align state: targets written by onNodeDrag, applied in onNodesChange.
  const snapTargetsRef = useRef<{ id: string; x: number; y: number }[]>([])
  const snapEnabled = useUIStore((s) => s.snapEnabled)

  // Selection-direction awareness: left-to-right (ltr) -> solid box + Full mode;
  // right-to-left (rtl) -> dashed box + Partial mode.
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(SelectionMode.Full)
  const [selectionDir, setSelectionDir] = useState<'ltr' | 'rtl'>('ltr')
  const selectionStartX = useRef<number | null>(null)
  const prevSelectionDir = useRef<'ltr' | 'rtl'>('ltr')

  // ── Selection-overlay context menu ────────────────────────────────────────
  const [selectionContextMenu, setSelectionContextMenu] = useState<ContextMenuState | null>(null)
  const closeSelectionContextMenu = useCallback(() => setSelectionContextMenu(null), [])

  const handleSelectionPreviewAction = useCallback(
    (nodeIds: string[], enabled: boolean) => {
      const label = `${enabled ? 'Enable' : 'Disable'} preview (${nodeIds.length} node(s))`
      const labelEn = `${enabled ? 'Enable' : 'Disable'} preview (${nodeIds.length} node(s))`
      const { currentPipeline } = usePipelineStore.getState()
      if (currentPipeline) {
        useHistoryStore.getState().record('toggle_preview', currentPipeline, { nodeIds, label, labelEn })
      }
      setNodePreview(nodeIds, enabled)
    },
    [setNodePreview],
  )

  // ── Functional hooks ──────────────────────────────────────────────────────
  const { connectLineColor, isValidConnection, onConnect: outerOnConnect, onConnectStart, onConnectEnd } =
    useCanvasConnect({ nodes, setEdges, setNodes, domainPortTypes })

  const { onNodesDelete: outerOnNodesDelete, onEdgesChange: outerOnEdgesChange, onEdgesDelete: outerOnEdgesDelete } = useCanvasDelete({
    nodes,
    edges,
    setEdges,
    setNodes,
  })

  const { updateGridVars } = useCanvasGrid(reactFlowWrapper)

  // ── Group system (create / ungroup / group-view navigation) ───────────────
  const { groupSelectedNodes, ungroupNode } = useCanvasGroup({ nodes, edges, setNodes, setEdges, domainPortTypes })

  // handleEnterGroup must call enterGroupView, which is produced by the group-view
  // hook below — break the cycle with a ref (legacy pattern).
  const handleEnterGroupRef = useRef<(groupId: string) => void>(() => {})
  const handleUngroup = useCallback((groupId: string) => {
    ungroupNode(groupId, handleUngroup)
  }, [ungroupNode])
  const handleEnterGroup = useCallback((groupId: string) => {
    handleEnterGroupRef.current(groupId)
  }, [])

  const { onDragOver, onDrop, placeBattery } = useCanvasDrop({
    reactFlowInstance,
    setNodes,
    onUngroup: handleUngroup,
    onEnterGroup: handleEnterGroup,
  })

  const groupCallbacks = useMemo(
    () => ({ onUngroup: handleUngroup, onEnterGroup: handleEnterGroup }),
    [handleUngroup, handleEnterGroup],
  )
  const buildOuterNodes = useCallback(() => buildCanvasNodes(groupCallbacks), [groupCallbacks])
  const buildOuterEdges = useCallback(() => buildCanvasEdges(domainPortTypes), [domainPortTypes])

  const {
    isInGroupView,
    breadcrumbs,
    syncInnerNodePosition,
    syncInnerNodesDelete,
    syncInnerEdgeAdd,
    syncInnerEdgeRemove,
    enterGroupView,
    exitGroupView,
    jumpToGroupViewDepth,
  } = useCanvasGroupView({
    setNodes,
    setEdges,
    reactFlowInstance,
    buildOuterNodes,
    buildOuterEdges,
    onUngroup: handleUngroup,
    onEnterGroup: handleEnterGroup,
    domainPortTypes,
  })
  // Wire the deferred enter-group ref to the real implementation.
  handleEnterGroupRef.current = enterGroupView

  // Clipboard (Ctrl+C / Ctrl+V) — pasted GroupNodes get the same callbacks.
  useCanvasCopyPaste({ nodes, edges, setNodes, setEdges, onUngroup: handleUngroup, onEnterGroup: handleEnterGroup, domainPortTypes })

  // Global Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z — restore the history snapshot through
  // the kernel (no local-state desync); see useCanvasUndoRedo.
  useCanvasUndoRedo()

  // Ctrl+drag to duplicate a node (DOM ghost layer).
  useCtrlDragGhost({ reactFlowInstance, reactFlowWrapper, setNodes, setEdges, onUngroup: handleUngroup, onEnterGroup: handleEnterGroup })

  // Snap-align: guides while dragging + node-move persistence/history on stop.
  const {
    snapGuides,
    onNodeDrag: snapOnNodeDrag,
    onNodeDragStop: snapOnNodeDragStop,
    onSelectionDragStop: snapOnSelectionDragStop,
  } = useCanvasSnap({ nodes, reactFlowInstance, reactFlowWrapper, snapTargetsRef, snapEnabled })

  // Canvas frames: create from selection + drag-containment + frame context menu.
  const {
    onFrameDragStart,
    onFrameDragMove,
    onFrameDragStop,
    syncFramesToStore,
    createFrameFromSelection,
    frameContextMenu,
    closeFrameContextMenu,
    onNodeContextMenu,
  } = useCanvasFrames({
    nodes,
    setNodes,
    edges,
    reactFlowInstance,
    groupSelectedNodes,
    onUngroup: handleUngroup,
    onEnterGroup: handleEnterGroup,
    domainPortTypes,
  })

  // Graph-sync owns the RF layer only at the root level; in a group view the
  // group-view hook drives it. Registered after the group hooks so isInGroupView
  // is known.
  useCanvasGraphSync({ reactFlowInstance, setNodes, setEdges, isInGroupView, groupCallbacks, domainPortTypes })

  const { onEdgeDoubleClick, onNodeDoubleClick } = useCanvasRelayInteractions({
    reactFlowInstance,
    setNodes,
    setEdges,
    isInGroupView,
    domainPortTypes,
  })

  const handleFlowInit = useCallback(
    (instance: ReactFlowInstance) => {
      setReactFlowInstance(instance)
      updateGridVars(instance.getViewport())
    },
    [updateGridVars],
  )

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => {
      const next = applyNodeChanges(changes, nds)
      // Apply any active snap target (X-axis override) during the drag frame.
      if (snapTargetsRef.current.length === 0) return next
      return next.map((n) => {
        const snap = snapTargetsRef.current.find((s) => s.id === n.id)
        return snap ? { ...n, position: { x: snap.x, y: n.position.y } } : n
      })
    })
  }, [])

  // ── Selection sync ──────────────────────────────────────────────────────
  // onSelectionChange is the single source of truth, avoiding races between
  // onNodeClick and onPaneClick.
  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      setSelectedNodeIds(selectedNodes.map((n) => n.id))

      if (
        selectedNodes.length === 1 &&
        selectedNodes[0].type !== 'annotation' &&
        selectedNodes[0].type !== 'frame'
      ) {
        const node = selectedNodes[0]
        setSelectedNode({
          id: node.id,
          batteryId: node.data.battery?.id || '',
          name: node.data.battery?.name || node.id,
          position: node.position,
          params: node.data.params || {},
        })
      } else {
        setSelectedNode(null)
      }
    },
    [setSelectedNode, setSelectedNodeIds],
  )

  // ReactFlow onSelectionContextMenu: right-click the marquee rectangle. With ≥2
  // real pipeline nodes selected, offer Create Frame / Group (annotation + frame
  // nodes don't count toward the threshold).
  const onSelectionContextMenu = useCallback((e: React.MouseEvent, selectedNodes: Node[]) => {
    e.preventDefault()
    if (selectedNodes.length === 0) return
    const { currentPipeline } = usePipelineStore.getState()
    const anyEnabled = selectedNodes.some(
      (n) => currentPipeline?.nodes.find((pn) => pn.id === n.id)?.previewEnabled !== false,
    )
    const selectedIds = selectedNodes.map((n) => n.id)
    const frameableCount = selectedNodes.filter((n) =>
      currentPipeline?.nodes.some((pn) => pn.id === n.id),
    ).length
    setSelectionContextMenu({
      x: e.clientX,
      y: e.clientY,
      nodeIds: selectedIds,
      previewEnabled: anyEnabled,
      // A single real node can be framed; grouping still needs ≥2.
      extraItems: [
        ...(frameableCount >= 1
          ? [
              {
                label: `Create Frame (${frameableCount} node(s))`,
                onClick: () => createFrameFromSelection(selectedNodes),
              },
            ]
          : []),
        ...(frameableCount >= 2
          ? [
              {
                label: `Group (${frameableCount} node(s))`,
                onClick: () => groupSelectedNodes(selectedIds, handleUngroup, handleEnterGroup),
              },
            ]
          : []),
      ],
    })
  }, [createFrameFromSelection, groupSelectedNodes, handleUngroup, handleEnterGroup])

  // ── Marquee-direction detection ───────────────────────────────────────────
  const handleWrapperMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (
      target.closest('.react-flow__node') ||
      target.closest('.react-flow__handle') ||
      target.closest('.react-flow__minimap') ||
      target.closest('.react-flow__edge')
    )
      return
    selectionStartX.current = e.clientX
  }, [])

  const handleWrapperMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (selectionStartX.current === null) return
    const diff = e.clientX - selectionStartX.current
    if (Math.abs(diff) < 5) return
    const newDir = diff > 0 ? 'ltr' : 'rtl'
    if (newDir !== prevSelectionDir.current) {
      prevSelectionDir.current = newDir
      setSelectionDir(newDir)
      setSelectionMode(newDir === 'ltr' ? SelectionMode.Full : SelectionMode.Partial)
    }
  }, [])

  const handleWrapperMouseUp = useCallback(() => {
    selectionStartX.current = null
  }, [])

  // ── Group-aware connection / deletion / drag ──────────────────────────────
  // At root level these delegate to the store-backed hooks. Inside a group view,
  // edges/positions belong to the group, so they route to the group-view sync
  // refs (flushed back to the store on exit) instead of touching the outer graph.
  const onConnect = useCallback((params: Connection) => {
    if (!isInGroupView) {
      outerOnConnect(params)
      return
    }
    if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return
    // Edges touching the read-only external context nodes are intentionally not
    // creatable from inside a group view (they mirror the parent level only).
    if (
      isGroupContextInputNodeId(params.source) || isGroupContextInputNodeId(params.target) ||
      isGroupContextOutputNodeId(params.source) || isGroupContextOutputNodeId(params.target)
    ) return
    const srcNode = nodes.find((n) => n.id === params.source)
    const srcPort = srcNode?.data?.battery?.outputs?.find((o: BatteryPort) => o.name === params.sourceHandle)
    const relayPortType = srcNode?.type === 'relay' && typeof srcNode.data?.portType === 'string' ? srcNode.data.portType : undefined
    const color = relayPortType
      ? getPortTypeColor(relayPortType, domainPortTypes)
      : srcPort
        ? getPortTypeColor(srcPort.type, domainPortTypes)
        : 'var(--color-accent)'
    const edgeId = `e-${params.source}-${params.sourceHandle}-${params.target}-${params.targetHandle}`
    setEdges((eds) => {
      const filtered = eds.filter((e) => !(e.target === params.target && e.targetHandle === params.targetHandle))
      return [...filtered, {
        id: edgeId,
        source: params.source!,
        sourceHandle: params.sourceHandle!,
        target: params.target!,
        targetHandle: params.targetHandle!,
        animated: false,
        style: { stroke: color, strokeWidth: 2 },
      }]
    })
    syncInnerEdgeAdd({
      id: edgeId,
      source: { nodeId: params.source, port: params.sourceHandle },
      target: { nodeId: params.target, port: params.targetHandle },
    })
  }, [isInGroupView, outerOnConnect, nodes, setEdges, syncInnerEdgeAdd, domainPortTypes])

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    if (!isInGroupView) {
      outerOnEdgesDelete(deleted)
      return
    }
    for (const e of deleted) syncInnerEdgeRemove(e.id)
  }, [isInGroupView, outerOnEdgesDelete, syncInnerEdgeRemove])

  const onNodesDelete = useCallback((deleted: Node[]) => {
    if (isInGroupView) {
      syncInnerNodesDelete(deleted)
      return
    }
    outerOnNodesDelete(deleted)
  }, [isInGroupView, outerOnNodesDelete, syncInnerNodesDelete])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (!isInGroupView) {
      outerOnEdgesChange(changes)
      return
    }

    const removedEdges = changes
      .filter((change) => change.type === 'remove')
      .map((change) => edges.find((edge) => edge.id === change.id))
      .filter((edge): edge is Edge => edge !== undefined)

    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges))

    for (const edge of removedEdges) {
      if (!edge.id.startsWith(BOUNDARY_EDGE_PREFIX)) syncInnerEdgeRemove(edge.id)
    }
  }, [edges, isInGroupView, outerOnEdgesChange, setEdges, syncInnerEdgeRemove])

  // Capture the member start-positions when a frame drag begins (root level only;
  // frames don't exist inside a group view).
  const onNodeDragStart = useCallback((_event: React.MouseEvent, node: Node) => {
    if (isInGroupView) return
    onFrameDragStart(node)
  }, [isInGroupView, onFrameDragStart])

  const onNodeDragStop = useCallback((event: React.MouseEvent, node: Node, draggedNodes: Node[]) => {
    if (isInGroupView) {
      // Persist inner node positions to the group (skip transient context nodes).
      for (const n of draggedNodes) {
        if (isGroupContextInputNodeId(n.id) || isGroupContextOutputNodeId(n.id)) continue
        syncInnerNodePosition(n.id, n.position)
      }
      return
    }
    // Annotation drag: persist position to the store (annotations aren't graph
    // nodes, so they bypass the snap/frame pipeline).
    if (node.type === 'annotation') {
      moveAnnotation(node.id, node.position)
      return
    }
    // Dragging a frame persists its geometry + member positions itself.
    if (onFrameDragStop(node)) return
    // Root level: snap + persist + history, then re-grow any frame a member left.
    snapOnNodeDragStop(event, node, draggedNodes)
    syncFramesToStore(reactFlowInstance?.getNodes() ?? nodes)
  }, [isInGroupView, syncInnerNodePosition, onFrameDragStop, snapOnNodeDragStop, syncFramesToStore, reactFlowInstance, nodes, moveAnnotation])

  const onNodeDrag = useCallback((event: React.MouseEvent, node: Node, draggedNodes: Node[]) => {
    if (isInGroupView) return
    // Dragging a frame translates its members instead of snap-aligning.
    if (onFrameDragMove(node)) return
    snapOnNodeDrag(event, node, draggedNodes)
  }, [isInGroupView, onFrameDragMove, snapOnNodeDrag])

  const onSelectionDragStop = useCallback((event: React.MouseEvent, draggedNodes: Node[]) => {
    if (isInGroupView) {
      for (const n of draggedNodes) {
        if (isGroupContextInputNodeId(n.id) || isGroupContextOutputNodeId(n.id)) continue
        syncInnerNodePosition(n.id, n.position)
      }
      return
    }
    // Persist any annotation positions moved as part of a multi-selection drag.
    for (const n of draggedNodes) {
      if (n.type === 'annotation') moveAnnotation(n.id, n.position)
    }
    snapOnSelectionDragStop(event, draggedNodes)
    syncFramesToStore(reactFlowInstance?.getNodes() ?? nodes)
  }, [isInGroupView, syncInnerNodePosition, snapOnSelectionDragStop, syncFramesToStore, reactFlowInstance, nodes, moveAnnotation])

  // Ctrl/Cmd+G groups the current multi-selection into a GroupNode (root only).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 'g' && e.key !== 'G')) return
      if (isInGroupView) return
      const { selectedNodeIds } = usePipelineStore.getState()
      if (selectedNodeIds.length >= 2) {
        e.preventDefault()
        groupSelectedNodes(selectedNodeIds, handleUngroup, handleEnterGroup)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isInGroupView, groupSelectedNodes, handleUngroup, handleEnterGroup])

  // ── Double-click search popover ───────────────────────────────────────────
  // ReactFlow v11 has no onPaneDoubleClick; onPaneClick emulates a double-click
  // with a 300ms / 8px threshold (zoomOnDoubleClick is disabled). On a hit we
  // record both the screen coordinate (popover position) and the flow coordinate
  // (battery insert position, pan/zoom already removed by screenToFlowPosition).
  const [searchPopover, setSearchPopover] = useState<{
    screenX: number
    screenY: number
    flowX: number
    flowY: number
  } | null>(null)
  const lastPaneClickRef = useRef<{ time: number; x: number; y: number } | null>(null)

  const onPaneClick = useCallback((e: React.MouseEvent) => {
    if (!reactFlowInstance) return
    const now = performance.now()
    const last = lastPaneClickRef.current
    const isDouble = !!last && now - last.time < 300 && Math.abs(e.clientX - last.x) < 8 && Math.abs(e.clientY - last.y) < 8
    if (isDouble) {
      lastPaneClickRef.current = null
      const flow = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setSearchPopover({ screenX: e.clientX, screenY: e.clientY, flowX: flow.x, flowY: flow.y })
    } else {
      lastPaneClickRef.current = { time: now, x: e.clientX, y: e.clientY }
    }
  }, [reactFlowInstance])

  const closeSearchPopover = useCallback(() => setSearchPopover(null), [])

  const handlePickBattery = useCallback((b: Battery) => {
    if (!searchPopover) return
    placeBattery(b, { x: searchPopover.flowX, y: searchPopover.flowY })
  }, [searchPopover, placeBattery])

  // ── JSX ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={`canvas${isInGroupView ? ' canvas--group-view' : ''}`}
      ref={reactFlowWrapper}
      data-selection-dir={selectionDir}
      onMouseDown={handleWrapperMouseDown}
      onMouseMove={handleWrapperMouseMove}
      onMouseUp={handleWrapperMouseUp}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        connectionLineStyle={{ stroke: connectLineColor, strokeWidth: 2 }}
        onInit={handleFlowInit}
        onMove={(_e, viewport) => updateGridVars(viewport)}
        zoomOnDoubleClick={false}
        onPaneClick={isInGroupView ? undefined : onPaneClick}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStop={onSelectionDragStop}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onSelectionChange={onSelectionChange}
        onSelectionContextMenu={onSelectionContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        nodeTypes={activeNodeTypes}
        edgeTypes={edgeTypes}
        isValidConnection={isValidConnection}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode="Shift"
        selectionOnDrag={true}
        panOnDrag={[1, 2]}
        zoomOnScroll={true}
        zoomOnPinch={true}
        minZoom={0.01}
        maxZoom={200}
        selectionMode={selectionMode}
        elevateNodesOnSelect={false}
        defaultEdgeOptions={{
          animated: false,
          style: { stroke: 'var(--color-accent)', strokeWidth: 2 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <MiniMap
          nodeColor="var(--color-accent)"
          maskColor="rgba(0, 0, 0, 0.5)"
          style={{ backgroundColor: 'var(--color-bg-secondary)', width: 100, height: 75 }}
        />
        <Panel position="bottom-right" className="zoom-slider-panel">
          <ZoomSlider reactFlowInstance={reactFlowInstance} />
        </Panel>
      </ReactFlow>

      {isInGroupView && (
        <GroupBreadcrumb breadcrumbs={breadcrumbs} onExit={exitGroupView} onJumpToDepth={jumpToGroupViewDepth} />
      )}

      {selectionContextMenu && (
        <ContextMenuPortal
          menu={selectionContextMenu}
          onClose={closeSelectionContextMenu}
          onAction={handleSelectionPreviewAction}
        />
      )}

      {frameContextMenu && (
        <ContextMenuPortal menu={frameContextMenu} onClose={closeFrameContextMenu} onAction={() => {}} />
      )}

      {searchPopover && (
        <CanvasSearchPopover
          batteries={searchBatteries}
          langMode={searchLangMode}
          screenX={searchPopover.screenX}
          screenY={searchPopover.screenY}
          onClose={closeSearchPopover}
          onPickBattery={handlePickBattery}
        />
      )}

      {snapGuides.length > 0 && (
        <svg className="snap-guide-overlay" aria-hidden="true">
          {snapGuides.map((guide, i) =>
            guide.type === 'vertical' ? (
              <line key={i} x1={guide.position} y1={0} x2={guide.position} y2="100%" className="snap-guide-line" />
            ) : (
              <line key={i} x1={0} y1={guide.position} x2="100%" y2={guide.position} className="snap-guide-line" />
            ),
          )}
        </svg>
      )}
    </div>
  )
}

// ── Zoom control sub-component ──────────────────────────────────────────────
//
// useViewport() subscribes to ReactFlow's internal store, so only this
// component re-renders on viewport change — the parent Canvas is never
// disturbed during scroll-zoom.

const SLIDER_MIN = Math.log10(0.05)
const SLIDER_MAX = Math.log10(5)

function ZoomSlider({ reactFlowInstance }: { reactFlowInstance: ReactFlowInstance | null }) {
  const { zoom } = useViewport()

  const handleZoomSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!reactFlowInstance) return
      const newZoom = Math.pow(10, parseFloat(e.target.value))
      const { x, y } = reactFlowInstance.getViewport()
      reactFlowInstance.setViewport({ x, y, zoom: newZoom }, { duration: 0 })
    },
    [reactFlowInstance],
  )

  return (
    <div className="zoom-slider-control">
      <button
        className="zoom-btn"
        onClick={() => reactFlowInstance?.zoomOut({ duration: 150 })}
        title="缩小"
      >
        −
      </button>
      <input
        type="range"
        className="zoom-slider-input"
        min={SLIDER_MIN}
        max={SLIDER_MAX}
        step={0.005}
        value={Math.log10(Math.max(0.05, Math.min(5, zoom)))}
        onChange={handleZoomSlider}
        title={`${Math.round(zoom * 100)}%`}
      />
      <button
        className="zoom-btn"
        onClick={() => reactFlowInstance?.zoomIn({ duration: 150 })}
        title="放大"
      >
        +
      </button>
      <span className="zoom-label">{Math.round(zoom * 100)}%</span>
    </div>
  )
}

export default Canvas
