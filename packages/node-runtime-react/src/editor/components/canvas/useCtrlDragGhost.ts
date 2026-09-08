// Ctrl+drag duplicate hook: a pure-DOM ghost layer (supports GroupNodes). Ported
// from the legacy editor (components/canvas/useCtrlDragGhost.ts).
//
// Principle: the source node's ReactFlow state (position / edges / params) is
// untouched.
// Flow:
//   1. container mousedown (capture): on Ctrl+left-click of a node, stopPropagation
//      so ReactFlow never drags the original, and record the intent.
//   2. mousemove: past the threshold, clone the node DOM as a ghost on document.body
//      and follow the cursor.
//   3. mouseup: destroy the ghost and create a real node at the drop point.
//
// Sizing: a ReactFlow node's DOM width/height are in Flow coords; getBoundingClientRect
// returns screen coords (= Flow size × zoom). The ghost keeps the node's original CSS
// size and applies scale(zoom) + translate, so zoom ≠ 1 doesn't distort it.
import { useEffect, useRef } from 'react'
import type { Edge, Node, ReactFlowInstance } from 'reactflow'
import { usePipelineStore, useHistoryStore } from '../../stores/index.js'
import { buildGroupNodeData } from './GroupNode.js'
import { remapGroupIds, resolveEdgeColorFromStore } from './groupViewUtils.js'
import { RELAY_BATTERY_ID } from './RelayNode.js'
import type { CanvasFrame, PipelineEdge } from '../../types.js'

// Drag threshold (screen px); below this a press is a click, not a drag.
const DRAG_THRESHOLD = 4

interface UseCtrlDragGhostParams {
  reactFlowInstance: ReactFlowInstance | null
  reactFlowWrapper: React.RefObject<HTMLDivElement>
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  /** Append rebuilt edges when a frame is duplicated (members + internal wires). */
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  /** Ungroup callback (Canvas), injected into a duplicated GroupNode's data. */
  onUngroup?: (groupId: string) => void
  /** Enter-group callback (Canvas), injected into a duplicated GroupNode's data. */
  onEnterGroup?: (groupId: string) => void
}

export function useCtrlDragGhost({
  reactFlowInstance,
  reactFlowWrapper,
  setNodes,
  setEdges,
  onUngroup,
  onEnterGroup,
}: UseCtrlDragGhostParams) {
  const addNode            = usePipelineStore((s) => s.addNode)
  const addGroup           = usePipelineStore((s) => s.addGroup)
  const addFrame           = usePipelineStore((s) => s.addFrame)
  const addEdge            = usePipelineStore((s) => s.addEdge)
  const duplicateAnnotation = usePipelineStore((s) => s.duplicateAnnotation)
  const incrementalExecute = usePipelineStore((s) => s.incrementalExecute)
  const persistSession     = usePipelineStore((s) => s.persistSession)

  const ghostElRef = useRef<HTMLElement | null>(null)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const mouseDownPosRef = useRef({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const pendingRef = useRef<{ nodeId: string; nodeEl: HTMLElement; nodeRect: DOMRect; zoom: number } | null>(null)

  useEffect(() => {
    const container = reactFlowWrapper.current
    if (!container) return

    // mousedown (capture): block ReactFlow's drag, record intent.
    const onMouseDown = (e: MouseEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.button !== 0) return

      const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node')
      if (!nodeEl) return

      const nodeId = nodeEl.getAttribute('data-id')
      if (!nodeId) return

      // Capture-phase stopPropagation: ReactFlow never sees the mousedown.
      e.stopPropagation()

      const rect = nodeEl.getBoundingClientRect()
      const zoom = reactFlowInstance?.getViewport().zoom ?? 1
      dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      mouseDownPosRef.current = { x: e.clientX, y: e.clientY }
      pendingRef.current = { nodeId, nodeEl, nodeRect: rect, zoom }
      isDraggingRef.current = false
    }

    // mousemove: build the ghost past the threshold.
    const onMouseMove = (e: MouseEvent) => {
      if (!pendingRef.current) return

      if (!isDraggingRef.current) {
        const dx = e.clientX - mouseDownPosRef.current.x
        const dy = e.clientY - mouseDownPosRef.current.y
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return

        isDraggingRef.current = true

        const { nodeEl, nodeRect, zoom } = pendingRef.current

        const ghost = nodeEl.cloneNode(true) as HTMLElement
        // Keep the node's inline width/height (Flow-coord px) and scale(zoom) to
        // screen size; do NOT overwrite with getBoundingClientRect (already scaled).
        Object.assign(ghost.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          transform: `translate(${nodeRect.left}px, ${nodeRect.top}px) scale(${zoom})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
          opacity: '0.7',
          zIndex: '9999',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          margin: '0',
        })

        ghost.querySelectorAll('.react-flow__handle').forEach((h) => ((h as HTMLElement).style.opacity = '0'))

        document.body.appendChild(ghost)
        ghostElRef.current = ghost
      }

      if (ghostElRef.current && pendingRef.current) {
        const x = e.clientX - dragOffsetRef.current.x
        const y = e.clientY - dragOffsetRef.current.y
        const zoom = pendingRef.current.zoom
        ghostElRef.current.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`
      }
    }

    // mouseup: destroy the ghost, create the real node at the drop point.
    const onMouseUp = (e: MouseEvent) => {
      if (!pendingRef.current) return

      const { nodeId } = pendingRef.current
      pendingRef.current = null

      if (!isDraggingRef.current) return // click, not a drag — let ReactFlow select
      isDraggingRef.current = false

      if (ghostElRef.current) {
        document.body.removeChild(ghostElRef.current)
        ghostElRef.current = null
      }

      if (!reactFlowInstance) return

      const dropScreenX = e.clientX - dragOffsetRef.current.x
      const dropScreenY = e.clientY - dragOffsetRef.current.y
      const flowPos = reactFlowInstance.screenToFlowPosition({ x: dropScreenX, y: dropScreenY })

      const rfNodes = reactFlowInstance.getNodes()
      const sourceNode = rfNodes.find((n) => n.id === nodeId)
      if (!sourceNode) return

      const { currentPipeline } = usePipelineStore.getState()

      // Annotation Ctrl+drag duplicate: write into the annotations list, never as an
      // execution node (annotations persist in `Pipeline.annotations`, not `nodes`).
      if (sourceNode.type === 'annotation') {
        const { currentPipeline: pipelineBeforeCopy } = usePipelineStore.getState()
        const newId = duplicateAnnotation(nodeId, flowPos)
        if (!newId) return
        if (pipelineBeforeCopy) {
          useHistoryStore.getState().record('paste_nodes', pipelineBeforeCopy, {
            nodeIds: [newId],
            label: '复制注释',
            labelEn: 'Copy annotation',
          })
        }
        setNodes((nds) => [
          ...nds.map((n) => ({ ...n, selected: false })),
          {
            ...sourceNode,
            id: newId,
            position: flowPos,
            selected: true,
            data: { ...sourceNode.data, initialEdit: false },
          },
        ])
        return
      }

      // Frame Ctrl+drag duplicate: clone the frame, its member nodes, and the
      // internal edges (both endpoints inside the frame) at the drop offset.
      if (sourceNode.type === 'frame') {
        const sourceFrame = currentPipeline?.frames?.find((f) => f.id === nodeId)
        if (!sourceFrame || sourceFrame.nodeIds.length === 0) return

        const delta = {
          x: flowPos.x - sourceNode.position.x,
          y: flowPos.y - sourceNode.position.y,
        }
        const memberIdSet = new Set(sourceFrame.nodeIds)
        const memberNodes = rfNodes.filter((n) => memberIdSet.has(n.id))
        if (memberNodes.length === 0) return

        const idMap = new Map<string, string>()
        const newNodes: Node[] = []
        const groupCopyIds: string[] = []

        const { currentPipeline: pipelineBeforeCopy } = usePipelineStore.getState()
        if (pipelineBeforeCopy) {
          useHistoryStore.getState().record('paste_nodes', pipelineBeforeCopy, {
            nodeIds: [sourceFrame.id, ...sourceFrame.nodeIds],
            label: `复制包围框：${sourceFrame.name}`,
            labelEn: `Copy frame: ${sourceFrame.name}`,
          })
        }

        for (const memberNode of memberNodes) {
          const newPosition = {
            x: memberNode.position.x + delta.x,
            y: memberNode.position.y + delta.y,
          }

          if (memberNode.type === 'group') {
            const sourceGroup = currentPipeline?.groups?.find((g) => g.id === memberNode.id)
            if (!sourceGroup) continue
            const newGroup = remapGroupIds(sourceGroup, newPosition)
            const noop = (_gid: string) => {}
            idMap.set(memberNode.id, newGroup.id)
            groupCopyIds.push(newGroup.id)
            addGroup(newGroup)
            addNode({
              id: newGroup.id,
              batteryId: '__group__',
              name: newGroup.name,
              position: newPosition,
              params: { groupId: newGroup.id },
            })
            newNodes.push({
              ...memberNode,
              id: newGroup.id,
              position: newPosition,
              selected: true,
              data: buildGroupNodeData(newGroup, onUngroup ?? noop, onEnterGroup ?? noop),
            })
            continue
          }

          if (memberNode.type === 'relay') {
            const pNode = currentPipeline?.nodes.find((n) => n.id === memberNode.id)
            const params = JSON.parse(JSON.stringify(pNode?.params ?? memberNode.data ?? {}))
            const newId = `relay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
            idMap.set(memberNode.id, newId)
            addNode({ id: newId, batteryId: RELAY_BATTERY_ID, name: 'Relay', position: newPosition, params })
            newNodes.push({
              ...memberNode,
              id: newId,
              position: newPosition,
              selected: true,
              data: { portType: typeof params.portType === 'string' ? params.portType : 'any' },
            })
            continue
          }

          const pNode = currentPipeline?.nodes.find((n) => n.id === memberNode.id)
          const params = JSON.parse(JSON.stringify(pNode?.params ?? memberNode.data.params ?? {}))
          const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          idMap.set(memberNode.id, newId)
          addNode({
            id: newId,
            batteryId: memberNode.data.battery?.id ?? '',
            name: memberNode.data.battery?.name ?? newId,
            position: newPosition,
            params,
          })
          newNodes.push({
            ...memberNode,
            id: newId,
            position: newPosition,
            selected: true,
            data: { battery: memberNode.data.battery, params },
          })
        }

        const newRfEdges: Edge[] = []
        for (const pEdge of currentPipeline?.edges ?? []) {
          const newSourceId = idMap.get(pEdge.source.nodeId)
          const newTargetId = idMap.get(pEdge.target.nodeId)
          if (!newSourceId || !newTargetId) continue

          const newEdgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          const newPipelineEdge: PipelineEdge = {
            id: newEdgeId,
            source: { nodeId: newSourceId, port: pEdge.source.port },
            target: { nodeId: newTargetId, port: pEdge.target.port },
          }
          addEdge(newPipelineEdge)
          newRfEdges.push({
            id: newEdgeId,
            source: newSourceId,
            target: newTargetId,
            sourceHandle: pEdge.source.port,
            targetHandle: pEdge.target.port,
            type: 'default',
            style: { stroke: resolveEdgeColorFromStore(newSourceId, pEdge.source.port), strokeWidth: 2 },
          })
        }

        const mappedNodeIds = sourceFrame.nodeIds
          .map((mid) => idMap.get(mid))
          .filter((mid): mid is string => Boolean(mid))
        if (mappedNodeIds.length === 0) return

        const now = new Date().toISOString()
        const newFrame: CanvasFrame = {
          ...sourceFrame,
          id: `frame_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: typeof sourceFrame.name === 'string' && sourceFrame.name.trim() ? sourceFrame.name : 'Frame',
          position: flowPos,
          nodeIds: mappedNodeIds,
          createdAt: now,
          updatedAt: now,
        }
        addFrame(newFrame)

        const newFrameNode: Node = {
          ...sourceNode,
          id: newFrame.id,
          position: flowPos,
          selected: true,
          style: { ...sourceNode.style, width: newFrame.width, height: newFrame.height },
          data: { name: newFrame.name, nodeIds: newFrame.nodeIds },
        }

        setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes, newFrameNode])
        if (newRfEdges.length > 0) setEdges((eds) => [...eds, ...newRfEdges])

        const firstExecId = groupCopyIds[0] ?? newNodes.find((n) => n.type !== 'annotation' && n.type !== 'frame')?.id
        if (firstExecId) {
          setTimeout(() => {
            void persistSession()
            void incrementalExecute(firstExecId, false, { persist: false })
          }, 50)
        }
        return
      }

      // GroupNode Ctrl+drag duplicate: remap ids, register to the store.
      if (sourceNode.type === 'group') {
        const sourceGroup = currentPipeline?.groups?.find((g) => g.id === nodeId)
        if (!sourceGroup) return

        const newGroup = remapGroupIds(sourceGroup, flowPos)
        const noop = (_gid: string) => {}
        const groupRfData = buildGroupNodeData(newGroup, onUngroup ?? noop, onEnterGroup ?? noop)
        const newNode: Node = { ...sourceNode, id: newGroup.id, position: flowPos, selected: true, data: groupRfData }

        const { currentPipeline: pipelineBeforeCopy } = usePipelineStore.getState()
        if (pipelineBeforeCopy) {
          useHistoryStore.getState().record('paste_nodes', pipelineBeforeCopy, {
            nodeIds: [newGroup.id],
            label: `复制成组节点：${newGroup.name}`,
            labelEn: `Copy group: ${newGroup.name}`,
          })
        }

        addGroup(newGroup)
        addNode({ id: newGroup.id, batteryId: '__group__', name: newGroup.name, position: flowPos, params: { groupId: newGroup.id } })
        setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), newNode])

        setTimeout(() => {
          void persistSession()
          void incrementalExecute(newGroup.id, true, { persist: false })
        }, 50)
        return
      }

      // Ordinary node Ctrl+drag duplicate.
      const pNode = currentPipeline?.nodes.find((n) => n.id === nodeId)
      const params = JSON.parse(JSON.stringify(pNode?.params ?? sourceNode.data.params ?? {}))

      const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const newNode: Node = {
        ...sourceNode,
        id: newId,
        position: flowPos,
        selected: true,
        data: { battery: sourceNode.data.battery, params },
      }

      const ctrlCopyLabel = `复制节点：${sourceNode.data.battery?.name ?? newId}`
      const ctrlCopyLabelEn = `Copy node: ${sourceNode.data.battery?.name ?? newId}`
      const { currentPipeline: pipelineBeforeCtrlCopy } = usePipelineStore.getState()
      if (pipelineBeforeCtrlCopy) {
        useHistoryStore.getState().record('paste_nodes', pipelineBeforeCtrlCopy, {
          nodeIds: [newId],
          label: ctrlCopyLabel,
          labelEn: ctrlCopyLabelEn,
        })
      }

      addNode({
        id: newId,
        batteryId: sourceNode.data.battery?.id ?? '',
        name: sourceNode.data.battery?.name ?? newId,
        position: flowPos,
        params,
      })

      setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), newNode])

      void incrementalExecute(newId, false)
    }

    // capture=true: intercept mousedown before ReactFlow to stopPropagation.
    container.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    return () => {
      container.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      if (ghostElRef.current) {
        document.body.removeChild(ghostElRef.current)
        ghostElRef.current = null
      }
    }
  }, [reactFlowInstance, reactFlowWrapper, setNodes, setEdges, addNode, addGroup, addFrame, addEdge, duplicateAnnotation, incrementalExecute, persistSession, onUngroup, onEnterGroup])
}
