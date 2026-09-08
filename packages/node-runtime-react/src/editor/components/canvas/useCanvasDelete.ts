// Delete logic hook: node deletion (onNodesDelete) and edge deletion
// (onEdgesChange remove branch). Ported verbatim from the legacy editor
// (components/canvas/useCanvasDelete.ts), retargeted onto the editor stores.
import { useCallback } from 'react'
import { applyEdgeChanges } from 'reactflow'
import type { Node, Edge, EdgeChange } from 'reactflow'
import { usePipelineStore, useHistoryStore } from '../../stores/index.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'

interface UseCanvasDeleteParams {
  nodes: Node[]
  edges: Edge[]
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
}

export function useCanvasDelete({ nodes, edges, setEdges, setNodes }: UseCanvasDeleteParams) {
  const removeNode = usePipelineStore((s) => s.removeNode)
  const removeGroup = usePipelineStore((s) => s.removeGroup)
  const removeFrame = usePipelineStore((s) => s.removeFrame)
  const removeAnnotation = usePipelineStore((s) => s.removeAnnotation)
  const removeEdge = usePipelineStore((s) => s.removeEdge)
  const clearNodeOutputs = usePipelineStore((s) => s.clearNodeOutputs)
  const clearNodeDynamicOutputPorts = usePipelineStore((s) => s.clearNodeDynamicOutputPorts)
  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const incrementalExecute = usePipelineStore((s) => s.incrementalExecute)
  const persistSession = usePipelineStore((s) => s.persistSession)

  /**
   * Node delete: ① snapshot surviving downstream → ② remove all (store reaches
   * final state) → ③ persist → ④ recompute downstream. Never interleave
   * removeNode + incrementalExecute in a loop (incrementalExecute reads get()
   * synchronously and would see an intermediate state).
   */
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const frameNodes = deleted.filter((node) => node.type === 'frame')
      const annotationNodes = deleted.filter((node) => node.type === 'annotation')
      const pipelineNodes = deleted.filter(
        (node) => node.type !== 'frame' && node.type !== 'annotation',
      )

      for (const frame of frameNodes) removeFrame(frame.id)
      // Annotations live in pipeline.annotations (not .nodes); route to their own
      // remover so they don't reappear on the next rebuild.
      for (const annotation of annotationNodes) removeAnnotation(annotation.id)
      if (pipelineNodes.length === 0) return

      const { currentPipeline } = usePipelineStore.getState()
      const allEdges = currentPipeline?.edges ?? []
      const allNodeIds = new Set(currentPipeline?.nodes.map((n) => n.id) ?? [])
      const deletedIds = new Set(pipelineNodes.map((d) => d.id))

      const survivingDownstreamIds = new Set<string>()
      for (const node of pipelineNodes) {
        allEdges
          .filter((e) => e.source.nodeId === node.id)
          .map((e) => e.target.nodeId)
          .filter((id) => allNodeIds.has(id) && !deletedIds.has(id))
          .forEach((id) => survivingDownstreamIds.add(id))
      }

      const nodeNames = pipelineNodes.map((n) => n.data?.battery?.name ?? n.id).join('、')
      const delLabel = pipelineNodes.length > 1 ? `删除 ${pipelineNodes.length} 个节点` : `删除节点：${nodeNames}`
      const delLabelEn =
        pipelineNodes.length > 1
          ? `Delete ${pipelineNodes.length} nodes`
          : `Delete node: ${pipelineNodes.map((n) => formatIdAsLabel(n.data?.battery?.id ?? n.id)).join(', ')}`
      const { currentPipeline: pipelineBeforeDel } = usePipelineStore.getState()
      if (pipelineBeforeDel) {
        useHistoryStore.getState().record('delete_node', pipelineBeforeDel, {
          nodeIds: pipelineNodes.map((d) => d.id),
          label: delLabel,
          labelEn: delLabelEn,
        })
      }

      for (const node of pipelineNodes) {
        const groupId = node.data?.battery?.id === '__group__'
          ? (typeof node.data?.params?.groupId === 'string' ? node.data.params.groupId : node.id)
          : null
        removeNode(node.id)
        if (groupId) removeGroup(groupId)
        clearNodeOutputs([node.id])
        clearNodeDynamicOutputPorts([node.id])
      }

      void persistSession()

      for (const downId of survivingDownstreamIds) {
        incrementalExecute(downId, false, { persist: false })
      }
    },
    [removeNode, removeGroup, removeFrame, removeAnnotation, clearNodeOutputs, clearNodeDynamicOutputPorts, incrementalExecute, persistSession],
  )

  /**
   * Custom onEdgesChange: intercept RF edge changes. On remove, also sync the
   * store and recompute downstream — RF fires only onEdgesChange(remove) on
   * drag-disconnect, not onEdgesDelete, leaving ghost edges otherwise.
   */
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removedEdges = changes
        .filter((c) => c.type === 'remove')
        .map((c) => edges.find((e) => e.id === c.id))
        .filter((e): e is Edge => e !== undefined)

      setEdges((eds) => applyEdgeChanges(changes, eds))

      if (removedEdges.length > 0) {
        const targetNodeIds = [...new Set(removedEdges.map((e) => e.target))]
        const deletedIds = new Set(removedEdges.map((e) => e.id))

        const edgeDelLabel = removedEdges.length > 1 ? `删除 ${removedEdges.length} 条连线` : '删除连线'
        const edgeDelLabelEn =
          removedEdges.length > 1 ? `Delete ${removedEdges.length} connections` : 'Delete connection'
        const { currentPipeline: pipelineBeforeEdgeDel } = usePipelineStore.getState()
        if (pipelineBeforeEdgeDel) {
          useHistoryStore.getState().record('delete_edge', pipelineBeforeEdgeDel, {
            edgeIds: removedEdges.map((e) => e.id),
            label: edgeDelLabel,
            labelEn: edgeDelLabelEn,
          })
        }

        removedEdges.forEach((edge) => removeEdge(edge.id))

        clearNodeOutputs(targetNodeIds)

        const remainingEdges = edges.filter((e) => !deletedIds.has(e.id))
        for (const targetId of targetNodeIds) {
          const targetNode = nodes.find((n) => n.id === targetId)
          const dynCfg = targetNode?.data?.battery?.dynamicInputs
          if (!dynCfg) continue

          const connectedIndices = remainingEdges
            .filter((e) => e.target === targetId && e.targetHandle?.startsWith(dynCfg.prefix))
            .map((e) => parseInt(e.targetHandle!.slice(dynCfg.prefix.length)))
            .filter((n) => !isNaN(n))

          const highestConnected = connectedIndices.length > 0 ? Math.max(...connectedIndices) : -1
          const newPortCount = Math.max(dynCfg.minCount, highestConnected + 2)
          const currentPortCount =
            typeof targetNode?.data?.params?.portCount === 'number'
              ? targetNode.data.params.portCount
              : dynCfg.minCount

          if (newPortCount < currentPortCount) {
            setNodes((nds) =>
              nds.map((n) =>
                n.id === targetId
                  ? { ...n, data: { ...n.data, params: { ...n.data.params, portCount: newPortCount } } }
                  : n,
              ),
            )
            updateNodeParam(targetId, 'portCount', newPortCount, true)
          }
        }

        for (const targetId of targetNodeIds) {
          incrementalExecute(targetId, false)
        }
      }
    },
    [edges, nodes, setEdges, setNodes, removeEdge, clearNodeOutputs, updateNodeParam, incrementalExecute],
  )

  // onEdgesDelete: all delete logic lives in onEdgesChange's remove branch;
  // this empty impl satisfies the ReactFlow signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const onEdgesDelete = useCallback((_deleted: Edge[]) => {}, [])

  return { onNodesDelete, onEdgesChange, onEdgesDelete }
}
