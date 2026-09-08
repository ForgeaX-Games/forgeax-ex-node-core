// Canvas frames hook: create / drag / delete labelled bounding frames around a
// set of nodes (visual only — frames are not executed). Ported from the legacy
// editor (the frame logic interleaved through components/canvas/Canvas.tsx) onto
// the editor stores + the existing CanvasFrameNode renderer + canvasFrameExport.
//
// A frame tracks its members' bounding box: dragging the frame moves its members
// with it; dragging a member individually re-grows/shrinks the frame box. Both
// the frame geometry and member positions persist through the pipeline store.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Node, Edge, ReactFlowInstance } from 'reactflow'
import { usePipelineStore, useHistoryStore } from '../../stores/index.js'
import type { Battery, CanvasFrame } from '../../types.js'
import { DEFAULT_BATTERY_WIDTH } from './canvasConstants.js'
import { copyFramePngToClipboard } from './canvasFrameExport.js'
import type { DomainPortTypes } from '../../utils/portTypes.js'
import type { ContextMenuState } from './BatteryNode.js'

// Frame padding around the member bounding box (flow units) + minimum size.
const FRAME_PAD_X = 24
const FRAME_PAD_TOP = 48
const FRAME_PAD_BOTTOM = 24
const FRAME_MIN_WIDTH = 220
const FRAME_MIN_HEIGHT = 140
// A nested frame's title bar overhangs above its box; extend the parent bounds up
// by this much so a containing frame fully wraps a child frame's label.
const FRAME_TITLE_TOP_OFFSET = 34
// Extra breathing room when a frame contains other (nested) frames.
const FRAME_NESTED_EXTRA_PAD = 4

// ReactFlow node size: prefer the measured width/height, else the style, else a
// default. A frame can't fall back to a battery height so 90 is the node guess.
export function getRfNodeSize(node: Node): { width: number; height: number } {
  const width =
    typeof node.width === 'number'
      ? node.width
      : typeof node.style?.width === 'number'
        ? node.style.width
        : DEFAULT_BATTERY_WIDTH
  const height =
    typeof node.height === 'number'
      ? node.height
      : typeof node.style?.height === 'number'
        ? node.style.height
        : 90
  return { width, height }
}

/** Larger frames sit farther back so nested (smaller) frames can be grabbed first. */
export function getFrameZIndex(width: number, height: number): number {
  return -20 - Math.round((width * height) / 1000)
}

/** A frame node's member ids (defensive: tolerate missing/garbled data). */
function getFrameMemberIds(node: Node): string[] {
  const ids = node.data?.nodeIds
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

/** Bounding-box geometry for a frame around `nodeIds` (null if no members exist). */
export function computeFrameGeometry(
  rfNodes: Node[],
  nodeIds: string[],
  options: { excludeFrameId?: string } = {},
): Pick<CanvasFrame, 'position' | 'width' | 'height'> | null {
  const nodeIdSet = new Set(nodeIds)
  const members = rfNodes.filter((node) => nodeIdSet.has(node.id) && node.type !== 'frame')
  if (members.length === 0) return null

  const bounds = members.reduce(
    (acc, node) => {
      const { width, height } = getRfNodeSize(node)
      return {
        minX: Math.min(acc.minX, node.position.x),
        minY: Math.min(acc.minY, node.position.y),
        maxX: Math.max(acc.maxX, node.position.x + width),
        maxY: Math.max(acc.maxY, node.position.y + height),
      }
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )

  // Expand to fully contain any strictly-nested frames (a frame whose members are
  // a proper subset of ours), accounting for their overhanging title bars.
  let nestedFrameCount = 0
  for (const node of rfNodes) {
    if (node.type !== 'frame' || node.id === options.excludeFrameId) continue
    const frameMemberIds = getFrameMemberIds(node)
    if (frameMemberIds.length === 0 || frameMemberIds.length >= nodeIdSet.size) continue
    if (!frameMemberIds.every((id) => nodeIdSet.has(id))) continue

    const { width, height } = getRfNodeSize(node)
    bounds.minX = Math.min(bounds.minX, node.position.x)
    bounds.minY = Math.min(bounds.minY, node.position.y - FRAME_TITLE_TOP_OFFSET)
    bounds.maxX = Math.max(bounds.maxX, node.position.x + width)
    bounds.maxY = Math.max(bounds.maxY, node.position.y + height)
    nestedFrameCount += 1
  }

  const extraPad = nestedFrameCount > 0 ? FRAME_NESTED_EXTRA_PAD : 0
  const padX = FRAME_PAD_X + extraPad
  const padTop = FRAME_PAD_TOP
  const padBottom = FRAME_PAD_BOTTOM + extraPad

  return {
    position: {
      x: bounds.minX - padX,
      y: bounds.minY - padTop,
    },
    width: Math.max(FRAME_MIN_WIDTH, bounds.maxX - bounds.minX + padX * 2),
    height: Math.max(FRAME_MIN_HEIGHT, bounds.maxY - bounds.minY + padTop + padBottom),
  }
}

/** True when two geometries are within sub-pixel tolerance (skip redundant updates). */
export function nearlySameFrameGeometry(
  frame: Pick<CanvasFrame, 'position' | 'width' | 'height'>,
  next: Pick<CanvasFrame, 'position' | 'width' | 'height'>,
): boolean {
  return (
    Math.abs(frame.position.x - next.position.x) < 0.5 &&
    Math.abs(frame.position.y - next.position.y) < 0.5 &&
    Math.abs(frame.width - next.width) < 0.5 &&
    Math.abs(frame.height - next.height) < 0.5
  )
}

interface UseCanvasFramesParams {
  nodes: Node[]
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  edges: Edge[]
  reactFlowInstance: ReactFlowInstance | null
  /** Group the given nodes (for "Convert to Group"). */
  groupSelectedNodes: (
    nodeIds: string[],
    onUngroup: (groupId: string) => void,
    onEnterGroup: (groupId: string) => void,
  ) => void
  onUngroup: (groupId: string) => void
  onEnterGroup: (groupId: string) => void
  domainPortTypes?: DomainPortTypes
}

export function useCanvasFrames({
  nodes,
  setNodes,
  edges,
  reactFlowInstance,
  groupSelectedNodes,
  onUngroup,
  onEnterGroup,
  domainPortTypes,
}: UseCanvasFramesParams) {
  const addFrame = usePipelineStore((s) => s.addFrame)
  const removeFrame = usePipelineStore((s) => s.removeFrame)
  const updateFrame = usePipelineStore((s) => s.updateFrame)
  const updateNode = usePipelineStore((s) => s.updateNode)
  const schedulePersistSession = usePipelineStore((s) => s.schedulePersistSession)

  // Captured when a frame drag begins: the frame's start position + each member's
  // start position, so onFrameDragMove can translate members by the same delta.
  const frameDragRef = useRef<{
    frameId: string
    startFramePosition: { x: number; y: number }
    memberStarts: Record<string, { x: number; y: number }>
  } | null>(null)

  // ── Drag: frame translates its members ─────────────────────────────────────
  const onFrameDragStart = useCallback(
    (node: Node) => {
      if (node.type !== 'frame') {
        frameDragRef.current = null
        return
      }
      const nodeIds = (node.data?.nodeIds as string[] | undefined) ?? []
      const memberSet = new Set(nodeIds)
      const memberStarts: Record<string, { x: number; y: number }> = {}
      for (const n of nodes) {
        if (memberSet.has(n.id)) memberStarts[n.id] = { ...n.position }
      }
      frameDragRef.current = {
        frameId: node.id,
        startFramePosition: { ...node.position },
        memberStarts,
      }
    },
    [nodes],
  )

  /** Move members with the dragged frame. Returns true when a frame was handled. */
  const onFrameDragMove = useCallback(
    (node: Node): boolean => {
      if (node.type !== 'frame') return false
      const drag = frameDragRef.current
      if (!drag || drag.frameId !== node.id) return true
      const dx = node.position.x - drag.startFramePosition.x
      const dy = node.position.y - drag.startFramePosition.y
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === node.id) return { ...n, position: node.position }
          const start = drag.memberStarts[n.id]
          if (!start) return n
          return { ...n, position: { x: start.x + dx, y: start.y + dy } }
        }),
      )
      return true
    },
    [setNodes],
  )

  /** Persist a frame move (geometry + member positions + history). Returns true when handled. */
  const onFrameDragStop = useCallback(
    (node: Node): boolean => {
      if (node.type !== 'frame') return false
      const frameId = node.id
      const latestNodes = reactFlowInstance?.getNodes() ?? nodes
      const finalNodes = latestNodes.map((n) => (n.id === frameId ? { ...n, position: node.position } : n))
      const frameNode = finalNodes.find((n) => n.id === frameId)
      const nodeIds = (frameNode?.data?.nodeIds as string[] | undefined) ?? []
      const geometry = computeFrameGeometry(finalNodes, nodeIds, { excludeFrameId: frameId })
      const { currentPipeline } = usePipelineStore.getState()
      if (!currentPipeline) {
        frameDragRef.current = null
        return true
      }

      useHistoryStore.getState().record('move_nodes_batch', currentPipeline, {
        nodeIds: [frameId, ...nodeIds],
        label: `Move frame (${nodeIds.length} node(s))`,
        labelEn: `Move frame (${nodeIds.length} node(s))`,
      })

      const affectedIds = new Set(nodeIds)
      for (const n of finalNodes) {
        if (affectedIds.has(n.id)) updateNode(n.id, { position: n.position })
      }
      if (geometry) updateFrame(frameId, geometry)

      frameDragRef.current = null
      schedulePersistSession('frame-drag-stop')
      return true
    },
    [reactFlowInstance, nodes, updateNode, updateFrame, schedulePersistSession],
  )

  // After a non-frame drag, re-grow any frame whose members moved.
  const syncFramesToStore = useCallback(
    (rfNodesOverride?: Node[]) => {
      const { currentPipeline } = usePipelineStore.getState()
      if (!currentPipeline) return
      const rfNodes = rfNodesOverride ?? nodes
      for (const frame of currentPipeline.frames ?? []) {
        const geometry = computeFrameGeometry(rfNodes, frame.nodeIds, { excludeFrameId: frame.id })
        if (!geometry || nearlySameFrameGeometry(frame, geometry)) continue
        updateFrame(frame.id, geometry)
      }
    },
    [nodes, updateFrame],
  )

  // Keep the frame RF node's box tracking its members live (during member drags).
  useEffect(() => {
    setNodes((nds) => {
      let changed = false
      const nextNodes = nds.map((node) => {
        if (node.type !== 'frame') return node
        const nodeIds = (node.data?.nodeIds as string[] | undefined) ?? []
        const geometry = computeFrameGeometry(nds, nodeIds, { excludeFrameId: node.id })
        if (!geometry) return node
        const currentGeometry = {
          position: node.position,
          width: typeof node.style?.width === 'number' ? node.style.width : FRAME_MIN_WIDTH,
          height: typeof node.style?.height === 'number' ? node.style.height : FRAME_MIN_HEIGHT,
        }
        if (nearlySameFrameGeometry(currentGeometry, geometry)) return node
        changed = true
        return {
          ...node,
          position: geometry.position,
          style: {
            ...node.style,
            width: geometry.width,
            height: geometry.height,
            zIndex: getFrameZIndex(geometry.width, geometry.height),
          },
        }
      })
      return changed ? nextNodes : nds
    })
  }, [nodes, setNodes])

  // ── Create / convert / close ───────────────────────────────────────────────
  const createFrameFromSelection = useCallback(
    (selectedNodes: Node[]) => {
      const { currentPipeline } = usePipelineStore.getState()
      if (!currentPipeline) return

      const pipelineNodeIds = new Set(currentPipeline.nodes.map((n) => n.id))
      const framedNodes = selectedNodes.filter((n) => pipelineNodeIds.has(n.id))
      // A single real battery may be framed; nested-frame detection needs the full
      // node set, so geometry is computed against `nodes`, not just the selection.
      if (framedNodes.length < 1) return

      const geometry = computeFrameGeometry(
        nodes,
        framedNodes.map((n) => n.id),
      )
      if (!geometry) return

      const now = new Date().toISOString()
      const frame: CanvasFrame = {
        id: `frame_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `Frame ${((currentPipeline.frames ?? []).length + 1).toString()}`,
        position: geometry.position,
        width: geometry.width,
        height: geometry.height,
        nodeIds: framedNodes.map((n) => n.id),
        createdAt: now,
        updatedAt: now,
      }

      useHistoryStore.getState().record('add_frame', currentPipeline, {
        nodeIds: frame.nodeIds,
        label: `Create frame: ${frame.name}`,
        labelEn: `Create frame: ${frame.name}`,
      })

      addFrame(frame)
      setNodes((nds) => [
        ...nds,
        {
          id: frame.id,
          type: 'frame',
          position: frame.position,
          style: { width: frame.width, height: frame.height, zIndex: getFrameZIndex(frame.width, frame.height) },
          data: { name: frame.name, nodeIds: frame.nodeIds },
          deletable: true,
          selectable: true,
          draggable: true,
        },
      ])
    },
    [addFrame, nodes, setNodes],
  )

  const convertFrameToGroup = useCallback(
    (frameId: string) => {
      const { currentPipeline } = usePipelineStore.getState()
      if (!currentPipeline) return
      const frame = (currentPipeline.frames ?? []).find((f) => f.id === frameId)
      if (!frame || frame.nodeIds.length < 2) return

      removeFrame(frameId)
      setNodes((nds) => nds.filter((n) => n.id !== frameId))
      groupSelectedNodes(frame.nodeIds, onUngroup, onEnterGroup)
    },
    [groupSelectedNodes, onEnterGroup, onUngroup, removeFrame, setNodes],
  )

  const closeFrame = useCallback(
    (frameId: string) => {
      const { currentPipeline } = usePipelineStore.getState()
      const frame = (currentPipeline?.frames ?? []).find((f) => f.id === frameId)
      if (currentPipeline && frame) {
        useHistoryStore.getState().record('delete_frame', currentPipeline, {
          nodeIds: frame.nodeIds,
          label: `Close frame: ${frame.name}`,
          labelEn: `Close frame: ${frame.name}`,
        })
      }
      removeFrame(frameId)
      setNodes((nds) => nds.filter((n) => n.id !== frameId))
    },
    [removeFrame, setNodes],
  )

  const copyFramePng = useCallback(
    (frameId: string) => {
      const { currentPipeline, batteries } = usePipelineStore.getState()
      if (!currentPipeline) return
      void copyFramePngToClipboard({
        frameId,
        pipeline: currentPipeline,
        batteries: batteries as Battery[],
        rfNodes: nodes,
        rfEdges: edges,
        domainPortTypes,
      })
        .then((mode) => {
          usePipelineStore.getState().addLog(`Copied frame PNG to clipboard (${mode})`)
        })
        .catch((error) => {
          console.error('[useCanvasFrames] copy frame PNG failed', error)
          window.alert('Failed to copy frame PNG to clipboard.')
        })
    },
    [edges, nodes, domainPortTypes],
  )

  // ── Frame context menu (right-click a frame) ───────────────────────────────
  const [frameContextMenu, setFrameContextMenu] = useState<ContextMenuState | null>(null)
  const closeFrameContextMenu = useCallback(() => setFrameContextMenu(null), [])

  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      if (node.type !== 'frame') return
      e.preventDefault()
      e.stopPropagation()
      const nodeIds = (node.data?.nodeIds as string[] | undefined) ?? []
      const extraItems = [
        { label: 'Copy PNG to Clipboard', onClick: () => copyFramePng(node.id) },
        ...(nodeIds.length >= 2
          ? [{ label: `Convert to Group (${nodeIds.length} node(s))`, onClick: () => convertFrameToGroup(node.id) }]
          : []),
        { label: 'Close Frame', onClick: () => closeFrame(node.id), danger: true },
      ]
      setFrameContextMenu({
        x: e.clientX,
        y: e.clientY,
        nodeIds: [node.id],
        previewEnabled: false,
        hidePreview: true,
        extraItems,
      })
    },
    [closeFrame, convertFrameToGroup, copyFramePng],
  )

  return {
    onFrameDragStart,
    onFrameDragMove,
    onFrameDragStop,
    syncFramesToStore,
    createFrameFromSelection,
    frameContextMenu,
    closeFrameContextMenu,
    onNodeContextMenu,
  }
}
