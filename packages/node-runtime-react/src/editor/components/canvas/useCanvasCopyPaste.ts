// Copy/paste hook: Ctrl+C copies the selected nodes, Ctrl+V pastes them (keeping
// full params, GroupNodes, and internal edges). Ported from the legacy editor
// (components/canvas/useCanvasCopyPaste.ts).
import { useEffect, useRef } from 'react'
import type { Node, Edge } from 'reactflow'
import { usePipelineStore, useHistoryStore } from '../../stores/index.js'
import type { CanvasFrame, NodeGroup, PipelineEdge } from '../../types.js'
import { buildGroupNodeData } from './GroupNode.js'
import { remapGroupIds, resolveEdgeColorFromStore } from './groupViewUtils.js'
import { RELAY_BATTERY_ID } from './RelayNode.js'
import type { DomainPortTypes } from '../../utils/portTypes.js'

// Clipboard entry: keeps the full ReactFlow Node (incl. data.params); a GroupNode
// additionally keeps its NodeGroup snapshot for id remapping on paste.
interface ClipboardEntry {
  node: Node
  /** The source node's pipelineStore params (text, AI results, all inner state). */
  pipelineParams: Record<string, unknown>
  /** For a GroupNode: the full NodeGroup snapshot, remapped on paste. */
  nodeGroup?: NodeGroup
  /** For a CanvasFrame: the full Frame snapshot, member ids remapped on paste. */
  canvasFrame?: CanvasFrame
}

interface UseCanvasCopyPasteParams {
  nodes: Node[]
  edges: Edge[]
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  /** Ungroup callback (Canvas), injected into a pasted GroupNode's data. */
  onUngroup?: (groupId: string) => void
  /** Enter-group callback (Canvas), injected into a pasted GroupNode's data. */
  onEnterGroup?: (groupId: string) => void
  domainPortTypes?: DomainPortTypes
}

export function useCanvasCopyPaste({ nodes, edges, setNodes, setEdges, onUngroup, onEnterGroup, domainPortTypes }: UseCanvasCopyPasteParams) {
  const addNode            = usePipelineStore((s) => s.addNode)
  const addGroup           = usePipelineStore((s) => s.addGroup)
  const addFrame           = usePipelineStore((s) => s.addFrame)
  const addEdge            = usePipelineStore((s) => s.addEdge)
  const duplicateAnnotation = usePipelineStore((s) => s.duplicateAnnotation)
  const incrementalExecute = usePipelineStore((s) => s.incrementalExecute)
  const persistSession     = usePipelineStore((s) => s.persistSession)

  const clipboardRef = useRef<ClipboardEntry[]>([])
  const clipboardEdgesRef = useRef<PipelineEdge[]>([])
  // Paste offset accumulator (ref so useEffect re-runs don't reset it).
  const pasteOffsetCountRef = useRef(0)

  // Ctrl+C / Ctrl+V global keyboard handling. Only active when focus is not in an
  // editable element, so it never clobbers normal text editing.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      const isCtrl = e.ctrlKey || e.metaKey

      // Ctrl+C: copy the selected nodes.
      if (isCtrl && e.key === 'c') {
        // Read the latest params from the store (incl. AI output etc.).
        const { currentPipeline } = usePipelineStore.getState()
        const selectedMap = new Map<string, Node>()
        for (const n of nodes.filter((n) => n.selected)) {
          selectedMap.set(n.id, n)
        }

        // Copying a frame also pulls its member nodes into the clipboard, so the
        // frame can be rebuilt around the pasted copies.
        for (const n of Array.from(selectedMap.values())) {
          if (n.type !== 'frame') continue
          const frame = (currentPipeline?.frames ?? []).find((f) => f.id === n.id)
          const memberIds = frame?.nodeIds ?? (Array.isArray(n.data?.nodeIds) ? (n.data.nodeIds as string[]) : [])
          for (const memberId of memberIds) {
            const memberNode = nodes.find((node) => node.id === memberId)
            if (memberNode) selectedMap.set(memberId, memberNode)
          }
        }

        const selectedNodes = Array.from(selectedMap.values())
        if (selectedNodes.length === 0) return

        const selectedIds = new Set(selectedNodes.map((n) => n.id))
        clipboardRef.current = selectedNodes.map((n) => {
          const pNode = currentPipeline?.nodes.find((pn) => pn.id === n.id)
          const nodeGroup = n.type === 'group'
            ? currentPipeline?.groups?.find((g) => g.id === n.id)
            : undefined
          const canvasFrame = n.type === 'frame'
            ? currentPipeline?.frames?.find((f) => f.id === n.id)
            : undefined
          return {
            node: n,
            pipelineParams: JSON.parse(JSON.stringify(pNode?.params ?? n.data.params ?? {})),
            nodeGroup: nodeGroup ? JSON.parse(JSON.stringify(nodeGroup)) : undefined,
            canvasFrame: canvasFrame ? JSON.parse(JSON.stringify(canvasFrame)) : undefined,
          }
        })
        // Keep internal edges (both endpoints inside the selection).
        clipboardEdgesRef.current = (currentPipeline?.edges ?? []).filter(
          (e2) => selectedIds.has(e2.source.nodeId) && selectedIds.has(e2.target.nodeId),
        )
        pasteOffsetCountRef.current = 0
        return
      }

      // Ctrl+V: paste.
      if (isCtrl && e.key === 'v') {
        if (clipboardRef.current.length === 0) return
        e.preventDefault()

        pasteOffsetCountRef.current++
        const PASTE_OFFSET = 15 * pasteOffsetCountRef.current

        const { currentPipeline: pipelineBeforePaste } = usePipelineStore.getState()
        const firstEntry = clipboardRef.current[0]
        const firstEntryName = firstEntry?.node.data?.battery?.name
          ?? (firstEntry?.node.type === 'annotation' ? '注释' : firstEntry?.node.type === 'frame' ? '包围框' : firstEntry?.node.id)
          ?? ''
        const firstEntryNameEn = firstEntry?.node.data?.battery?.name
          ?? (firstEntry?.node.type === 'annotation' ? 'Annotation' : firstEntry?.node.type === 'frame' ? 'Frame' : firstEntry?.node.id)
          ?? ''
        const pasteLabel = clipboardRef.current.length > 1
          ? `粘贴 ${clipboardRef.current.length} 个节点`
          : `粘贴节点：${firstEntryName}`
        const pasteLabelEn = clipboardRef.current.length > 1
          ? `Paste ${clipboardRef.current.length} nodes`
          : `Paste node: ${firstEntryNameEn}`
        if (pipelineBeforePaste) {
          useHistoryStore.getState().record('paste_nodes', pipelineBeforePaste, { label: pasteLabel, labelEn: pasteLabelEn })
        }

        const newNodes: Node[] = []
        const groupPasteIds: string[] = []
        // Frames are created last, once every member id has been remapped.
        const pendingFrameEntries: Array<{ entry: ClipboardEntry; position: { x: number; y: number } }> = []
        const idMap = new Map<string, string>()

        for (const entry of clipboardRef.current) {
          const newPosition = {
            x: entry.node.position.x + PASTE_OFFSET,
            y: entry.node.position.y + PASTE_OFFSET,
          }

          // Annotation paste: write into currentPipeline.annotations, never as an
          // execution node (annotations live outside `nodes`; reusing addNode would
          // create an invalid `batteryId: ''` node that is lost on refresh).
          if (entry.node.type === 'annotation') {
            const newId = duplicateAnnotation(entry.node.id, newPosition)
            if (!newId) continue
            idMap.set(entry.node.id, newId)
            newNodes.push({
              ...entry.node,
              id: newId,
              position: newPosition,
              selected: true,
              data: { ...entry.node.data, initialEdit: false },
            })
            continue
          }

          // Frame paste is deferred until all member ids are remapped below.
          if (entry.node.type === 'frame') {
            pendingFrameEntries.push({ entry, position: newPosition })
            continue
          }

          // GroupNode paste: remap ids, register to the store.
          if (entry.node.type === 'group' && entry.nodeGroup) {
            const newGroup = remapGroupIds(entry.nodeGroup, newPosition)
            const noop = (_gid: string) => {}
            const groupRfData = buildGroupNodeData(newGroup, onUngroup ?? noop, onEnterGroup ?? noop)
            const newNode: Node = { ...entry.node, id: newGroup.id, position: newPosition, selected: true, data: groupRfData }
            newNodes.push(newNode)
            groupPasteIds.push(newGroup.id)
            idMap.set(entry.node.id, newGroup.id)

            addGroup(newGroup)
            addNode({ id: newGroup.id, batteryId: '__group__', name: newGroup.name, position: newPosition, params: { groupId: newGroup.id } })
            continue
          }

          // Relay paste: lightweight inner node, no battery snapshot.
          if (entry.node.type === 'relay') {
            const newId = `relay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
            idMap.set(entry.node.id, newId)
            const params = JSON.parse(JSON.stringify(entry.pipelineParams))
            const newNode: Node = {
              ...entry.node, id: newId, position: newPosition, selected: true,
              data: { portType: typeof params.portType === 'string' ? params.portType : 'any' },
            }
            newNodes.push(newNode)
            addNode({ id: newId, batteryId: RELAY_BATTERY_ID, name: 'Relay', position: newPosition, params })
            continue
          }

          // Ordinary node paste.
          const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          idMap.set(entry.node.id, newId)
          const newData = {
            battery: entry.node.data.battery,
            params: JSON.parse(JSON.stringify(entry.pipelineParams)),
          }
          const newNode: Node = { ...entry.node, id: newId, position: newPosition, selected: true, data: newData }
          newNodes.push(newNode)

          addNode({
            id: newId,
            batteryId: newData.battery?.id ?? '',
            name: newData.battery?.name ?? newId,
            position: newPosition,
            params: newData.params,
          })
        }

        // Rebuild internal edges between the pasted nodes.
        const newRfEdges: Edge[] = []
        for (const pEdge of clipboardEdgesRef.current) {
          const newSourceId = idMap.get(pEdge.source.nodeId)
          const newTargetId = idMap.get(pEdge.target.nodeId)
          if (!newSourceId || !newTargetId) continue

          const newEdgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          const color = resolveEdgeColorFromStore(newSourceId, pEdge.source.port, undefined, domainPortTypes)
          addEdge({
            id: newEdgeId,
            source: { nodeId: newSourceId, port: pEdge.source.port },
            target: { nodeId: newTargetId, port: pEdge.target.port },
          })
          newRfEdges.push({
            id: newEdgeId,
            source: newSourceId,
            target: newTargetId,
            sourceHandle: pEdge.source.port,
            targetHandle: pEdge.target.port,
            type: 'default',
            style: { stroke: color, strokeWidth: 2 },
          })
        }

        // Rebuild frames around their pasted members (ids now fully remapped).
        for (const { entry, position } of pendingFrameEntries) {
          const sourceFrame = entry.canvasFrame
          if (!sourceFrame) continue
          const mappedNodeIds = sourceFrame.nodeIds
            .map((nodeId) => idMap.get(nodeId))
            .filter((nodeId): nodeId is string => Boolean(nodeId))
          if (mappedNodeIds.length === 0) continue

          const now = new Date().toISOString()
          const newFrame: CanvasFrame = {
            ...sourceFrame,
            id: `frame_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: typeof sourceFrame.name === 'string' && sourceFrame.name.trim() ? sourceFrame.name : 'Frame',
            position,
            nodeIds: mappedNodeIds,
            filePath: undefined,
            createdAt: now,
            updatedAt: now,
          }
          idMap.set(entry.node.id, newFrame.id)
          addFrame(newFrame)
          newNodes.push({
            ...entry.node,
            id: newFrame.id,
            position,
            style: { ...entry.node.style, width: newFrame.width, height: newFrame.height },
            selected: true,
            data: { name: newFrame.name, nodeIds: newFrame.nodeIds },
          })
        }

        // Deselect existing nodes, select the pasted ones; append new edges.
        setNodes((nds) => [...nds.map((n) => (n.selected ? { ...n, selected: false } : n)), ...newNodes])
        if (newRfEdges.length > 0) setEdges((eds) => [...eds, ...newRfEdges])

        // Recompute so pasted nodes evaluate (AI nodes run manually).
        if (newNodes.length > 0) {
          const firstGroupId = groupPasteIds[0]
          const firstRegularNode = newNodes.find((n) => n.type !== 'group' && n.type !== 'annotation' && n.type !== 'frame')
          if (firstGroupId) {
            setTimeout(() => {
              void persistSession()
              void incrementalExecute(firstGroupId, false, { persist: false })
            }, 50)
          } else if (firstRegularNode) {
            void incrementalExecute(firstRegularNode.id, false)
          }
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [nodes, edges, setNodes, setEdges, addNode, addGroup, addFrame, addEdge, duplicateAnnotation, incrementalExecute, persistSession, onUngroup, onEnterGroup, domainPortTypes])
}
