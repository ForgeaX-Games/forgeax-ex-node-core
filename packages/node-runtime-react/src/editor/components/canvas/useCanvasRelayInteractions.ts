// Relay double-click interactions ported from the legacy editor:
//   edge double-click inserts a typed relay into the wire;
//   relay node double-click removes it and restores the direct edge when possible.
import { useCallback } from 'react'
import type { Edge, Node, ReactFlowInstance } from 'reactflow'
import { useHistoryStore, usePipelineStore } from '../../stores/index.js'
import type { BatteryPort } from '../../types.js'
import { getPortTypeColor, type DomainPortTypes } from '../../utils/portTypes.js'
import {
  RELAY_BATTERY_ID,
  RELAY_INPUT_PORT,
  RELAY_NODE_HEIGHT,
  RELAY_NODE_WIDTH,
  RELAY_OUTPUT_PORT,
} from './RelayNode.js'

interface UseCanvasRelayInteractionsParams {
  reactFlowInstance: ReactFlowInstance | null
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  isInGroupView?: boolean
  domainPortTypes?: DomainPortTypes
}

function restoredEdgeId(sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string): string {
  return `e-${sourceNodeId}-${sourcePort}-${targetNodeId}-${targetPort}`
}

function relayPortTypeFromSource(sourceNodeId: string | undefined, sourcePortName: string | undefined): string {
  const { currentPipeline, batteries } = usePipelineStore.getState()
  const sourceNode = currentPipeline?.nodes.find((n) => n.id === sourceNodeId)
  const relayPortType =
    sourceNode?.batteryId === RELAY_BATTERY_ID && typeof sourceNode.params?.portType === 'string'
      ? sourceNode.params.portType
      : undefined
  const sourceBattery = batteries.find((b) => b.id === sourceNode?.batteryId)
  const sourcePort = sourceBattery?.outputs?.find((p: BatteryPort) => p.name === sourcePortName)
  return relayPortType ?? sourcePort?.type ?? 'any'
}

function edgeColorForPortType(portType: string, domainPortTypes?: DomainPortTypes): string {
  return portType === 'any' ? 'var(--color-accent)' : getPortTypeColor(portType, domainPortTypes)
}

export function useCanvasRelayInteractions({
  reactFlowInstance,
  setNodes,
  setEdges,
  isInGroupView = false,
  domainPortTypes,
}: UseCanvasRelayInteractionsParams) {
  const addNode = usePipelineStore((s) => s.addNode)
  const removeNode = usePipelineStore((s) => s.removeNode)
  const addEdge = usePipelineStore((s) => s.addEdge)
  const removeEdge = usePipelineStore((s) => s.removeEdge)
  const clearNodeOutputs = usePipelineStore((s) => s.clearNodeOutputs)
  const clearNodeDynamicOutputPorts = usePipelineStore((s) => s.clearNodeDynamicOutputPorts)
  const persistSession = usePipelineStore((s) => s.persistSession)
  const incrementalExecute = usePipelineStore((s) => s.incrementalExecute)

  const onEdgeDoubleClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault()
      event.stopPropagation()
      if (isInGroupView || !reactFlowInstance) return
      if (!edge.sourceHandle || !edge.targetHandle) return

      const { currentPipeline } = usePipelineStore.getState()
      if (!currentPipeline) return
      const pipelineEdge = currentPipeline.edges.find((e) => e.id === edge.id)
      if (!pipelineEdge) return

      const portType = relayPortTypeFromSource(pipelineEdge.source.nodeId, pipelineEdge.source.port)
      const edgeColor = edgeColorForPortType(portType, domainPortTypes)
      const flow = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const relayId = `relay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const relayPosition = {
        x: flow.x - RELAY_NODE_WIDTH / 2,
        y: flow.y - RELAY_NODE_HEIGHT / 2,
      }
      const firstEdgeId = `e-${pipelineEdge.source.nodeId}-${pipelineEdge.source.port}-${relayId}-${RELAY_INPUT_PORT}`
      const secondEdgeId = `e-${relayId}-${RELAY_OUTPUT_PORT}-${pipelineEdge.target.nodeId}-${pipelineEdge.target.port}`

      useHistoryStore.getState().record('add_node', currentPipeline, {
        nodeIds: [relayId],
        edgeIds: [edge.id, firstEdgeId, secondEdgeId],
        label: '插入 relay',
        labelEn: 'Insert relay',
      })

      removeEdge(edge.id)
      addNode({
        id: relayId,
        batteryId: RELAY_BATTERY_ID,
        name: 'Relay',
        position: relayPosition,
        params: { portType },
      })
      addEdge({
        id: firstEdgeId,
        source: pipelineEdge.source,
        target: { nodeId: relayId, port: RELAY_INPUT_PORT },
      })
      addEdge({
        id: secondEdgeId,
        source: { nodeId: relayId, port: RELAY_OUTPUT_PORT },
        target: pipelineEdge.target,
      })

      setNodes((nds) => [
        ...nds,
        {
          id: relayId,
          type: 'relay',
          position: relayPosition,
          style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT },
          data: { portType },
          selected: false,
        },
      ])
      setEdges((eds) => [
        ...eds.filter((e) => e.id !== edge.id),
        {
          id: firstEdgeId,
          source: pipelineEdge.source.nodeId,
          sourceHandle: pipelineEdge.source.port,
          target: relayId,
          targetHandle: RELAY_INPUT_PORT,
          animated: false,
          style: { stroke: edgeColor, strokeWidth: 2 },
        },
        {
          id: secondEdgeId,
          source: relayId,
          sourceHandle: RELAY_OUTPUT_PORT,
          target: pipelineEdge.target.nodeId,
          targetHandle: pipelineEdge.target.port,
          animated: false,
          style: { stroke: edgeColor, strokeWidth: 2 },
        },
      ])

      void persistSession().then(() => incrementalExecute(relayId, false, { persist: false }))
    },
    [addEdge, addNode, domainPortTypes, incrementalExecute, isInGroupView, persistSession, reactFlowInstance, removeEdge, setEdges, setNodes],
  )

  const onNodeDoubleClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.type !== 'relay') return
      event.preventDefault()
      event.stopPropagation()
      if (isInGroupView) return

      const { currentPipeline } = usePipelineStore.getState()
      if (!currentPipeline) return

      const incoming = currentPipeline.edges.filter(
        (e) => e.target.nodeId === node.id && e.target.port === RELAY_INPUT_PORT,
      )
      const outgoing = currentPipeline.edges.filter(
        (e) => e.source.nodeId === node.id && e.source.port === RELAY_OUTPUT_PORT,
      )

      // Relay supports one-in / multi-out; on delete, reconnect every input
      // edge to every output edge so forked wires are not lost (legacy fix:
      // previously only the exact 1-in-1-out case restored a direct edge).
      const directEdgeKey = (edge: { source: { nodeId: string; port: string }; target: { nodeId: string; port: string } }) =>
        `${edge.source.nodeId}:${edge.source.port}->${edge.target.nodeId}:${edge.target.port}`
      const existingDirectEdgeKeys = new Set(
        currentPipeline.edges
          .filter((e) => e.source.nodeId !== node.id && e.target.nodeId !== node.id)
          .map(directEdgeKey),
      )
      const restoredEdges: Array<{ id: string; source: { nodeId: string; port: string }; target: { nodeId: string; port: string } }> = []
      for (const inEdge of incoming) {
        for (const outEdge of outgoing) {
          const restoredEdge = {
            id: restoredEdgeId(inEdge.source.nodeId, inEdge.source.port, outEdge.target.nodeId, outEdge.target.port),
            source: inEdge.source,
            target: outEdge.target,
          }
          const key = directEdgeKey(restoredEdge)
          if (existingDirectEdgeKeys.has(key)) continue
          existingDirectEdgeKeys.add(key)
          restoredEdges.push(restoredEdge)
        }
      }

      useHistoryStore.getState().record('delete_node', currentPipeline, {
        nodeIds: [node.id],
        edgeIds: [
          ...incoming.map((e) => e.id),
          ...outgoing.map((e) => e.id),
          ...restoredEdges.map((e) => e.id),
        ],
        label: '删除 relay',
        labelEn: 'Delete relay',
      })

      removeNode(node.id)
      clearNodeOutputs([node.id])
      clearNodeDynamicOutputPorts([node.id])
      for (const restoredEdge of restoredEdges) addEdge(restoredEdge)

      const connectedRelayEdgeIds = new Set([...incoming, ...outgoing].map((e) => e.id))
      const colorForRestoredEdge = (restoredEdge: { source: { nodeId: string; port: string } }) =>
        edgeColorForPortType(relayPortTypeFromSource(restoredEdge.source.nodeId, restoredEdge.source.port), domainPortTypes)
      setNodes((nds) => nds.filter((n) => n.id !== node.id))
      setEdges((eds) => {
        const nextEdges = eds.filter((e) => !connectedRelayEdgeIds.has(e.id))
        return [
          ...nextEdges,
          ...restoredEdges.map((restoredEdge) => ({
            id: restoredEdge.id,
            source: restoredEdge.source.nodeId,
            sourceHandle: restoredEdge.source.port,
            target: restoredEdge.target.nodeId,
            targetHandle: restoredEdge.target.port,
            animated: false,
            style: { stroke: colorForRestoredEdge(restoredEdge), strokeWidth: 2 },
          })),
        ]
      })

      void persistSession().then(() => {
        const affectedTargets = restoredEdges.length > 0
          ? [...new Set(restoredEdges.map((e) => e.target.nodeId))]
          : [...new Set(outgoing.map((e) => e.target.nodeId))]
        for (const targetId of affectedTargets) void incrementalExecute(targetId, false, { persist: false })
      })
    },
    [
      addEdge,
      clearNodeDynamicOutputPorts,
      clearNodeOutputs,
      domainPortTypes,
      incrementalExecute,
      isInGroupView,
      persistSession,
      removeNode,
      setEdges,
      setNodes,
    ],
  )

  return { onEdgeDoubleClick, onNodeDoubleClick }
}
