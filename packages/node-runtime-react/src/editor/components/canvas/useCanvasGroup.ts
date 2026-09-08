// Grouping hook: provides groupSelectedNodes (collapse) and ungroupNode (expand).
// Ported from the legacy editor (components/canvas/useCanvasGroup.ts).
//
// Exposed-port rules:
//   - Exposed inputs: for each input port of each selected node, expose it when
//       (1) the node is not a text_panel,
//       (2) the port has no upstream edge from inside the selection,
//       (3) it is not an unconnected dynamic-input slot (dynamicInputs.prefix);
//     i.e. ports with an external edge + unconnected fixed inputs.
//   - Exposed outputs: every output port of the "sink" nodes (no outgoing edge
//     inside the selection).
//   - External edges (outside→inside or inside→outside) are kept, with their
//     endpoints redirected to the GroupNode's exposed ports.
// ungroupNode reverses all of the above.
import { useCallback } from 'react'
import type { Node, Edge } from 'reactflow'
import { usePipelineStore } from '../../stores/index.js'
import { useHistoryStore } from '../../stores/index.js'
import type { NodeGroup, ExposedPort, PipelineNode, PipelineEdge } from '../../types.js'
import { buildGroupNodeData } from './GroupNode.js'
import { getPortTypeColor, type DomainPortTypes } from '../../utils/portTypes.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'
import {
  resolveNodeType,
  DEFAULT_BATTERY_WIDTH,
  DEFAULT_GROUP_WIDTH,
  estimateBatteryNodeWidth,
  estimateGroupNodeWidth,
} from './canvasConstants.js'
import { getGroupPortDisplayLabel, getNodeMeta } from './groupViewUtils.js'
import { RELAY_BATTERY_ID, RELAY_NODE_HEIGHT, RELAY_NODE_WIDTH } from './RelayNode.js'

// Resolve an edge color from the source node + source port via battery metadata;
// fall back to the accent color.
function resolveEdgeColor(sourceNodeId: string, sourcePort: string, domainPortTypes?: DomainPortTypes): string {
  const { currentPipeline, batteries } = usePipelineStore.getState()
  const pNode = currentPipeline?.nodes.find((n) => n.id === sourceNodeId)
  if (pNode?.batteryId === RELAY_BATTERY_ID) {
    const portType = typeof pNode.params?.portType === 'string' ? pNode.params.portType : 'any'
    return portType === 'any' ? 'var(--color-accent)' : getPortTypeColor(portType, domainPortTypes)
  }
  const battery = batteries.find((b) => b.id === pNode?.batteryId)
  const port = battery?.outputs?.find((o) => o.name === sourcePort)
  return port ? getPortTypeColor(port.type, domainPortTypes) : 'var(--color-accent)'
}

// Resolve the ReactFlow nodeType + style from battery metadata (kept in sync
// with session restore).
function resolveNodeTypeAndStyle(batteryId: string): { type: string; style: Record<string, number> } {
  if (batteryId === RELAY_BATTERY_ID) {
    return { type: 'relay', style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT } }
  }

  const { batteries } = usePipelineStore.getState()
  const battery = batteries.find((b) => b.id === batteryId)
  if (!battery) return { type: 'battery', style: { width: DEFAULT_BATTERY_WIDTH } }

  const nodeType = resolveNodeType(battery)
  const specialStyles: Record<string, Record<string, number>> = {
    text_panel:   { width: DEFAULT_BATTERY_WIDTH, height: 150 },
    ai_battery:   { width: DEFAULT_BATTERY_WIDTH },
    json_battery: { width: DEFAULT_BATTERY_WIDTH, height: 200 },
    battery:      { width: DEFAULT_BATTERY_WIDTH },
  }
  const style = {
    ...(specialStyles[nodeType] ?? { width: DEFAULT_BATTERY_WIDTH }),
    width: estimateBatteryNodeWidth(battery, (specialStyles[nodeType]?.width as number | undefined) ?? DEFAULT_BATTERY_WIDTH),
  }
  return { type: nodeType, style }
}

// Generate a unique group id.
function genGroupId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

interface UseCanvasGroupParams {
  nodes: Node[]
  edges: Edge[]
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  domainPortTypes?: DomainPortTypes
}

export function useCanvasGroup({ nodes, edges, setNodes, setEdges, domainPortTypes }: UseCanvasGroupParams) {
  const addNode      = usePipelineStore((s) => s.addNode)
  const removeNode   = usePipelineStore((s) => s.removeNode)
  const addEdge      = usePipelineStore((s) => s.addEdge)
  const removeEdge   = usePipelineStore((s) => s.removeEdge)
  const addGroup     = usePipelineStore((s) => s.addGroup)
  const removeGroup  = usePipelineStore((s) => s.removeGroup)

  // Collapse the nodes in selectedNodeIds into one GroupNode.
  const groupSelectedNodes = useCallback(
    (selectedNodeIds: string[], onUngroup: (groupId: string) => void, onEnterGroup?: (groupId: string) => void) => {
      if (selectedNodeIds.length < 2) return

      const { currentPipeline } = usePipelineStore.getState()
      if (!currentPipeline) return

      // Nested grouping: __group__ children are treated as ordinary batteries
      // (meta derived by deriveGroupVirtualMeta); port exposure / boundary
      // handling is transparent to them. Drop ids with no matching PipelineNode.
      const validIds = selectedNodeIds.filter((id) => currentPipeline.nodes.some((n) => n.id === id))
      if (validIds.length < 2) return
      const cleanIds = validIds

      const selectedSet = new Set(cleanIds)
      const allEdges = currentPipeline.edges

      // ── Classify every edge ──────────────────────────────────────────────
      const internalEdgeIds   = new Set<string>()
      const externalEdges: PipelineEdge[] = []
      const hasInternalOutgoing = new Set<string>()  // node-level: has an outgoing edge inside the selection
      const portHasInternalIn = new Set<string>()    // "nodeId__port": target port has an internal upstream
      const portHasAnyEdge    = new Set<string>()    // "nodeId__port": target port has any edge

      for (const edge of allEdges) {
        const srcIn = selectedSet.has(edge.source.nodeId)
        const tgtIn = selectedSet.has(edge.target.nodeId)

        if (srcIn && tgtIn) {
          internalEdgeIds.add(edge.id)
          hasInternalOutgoing.add(edge.source.nodeId)
          const tgtKey = `${edge.target.nodeId}__${edge.target.port}`
          portHasInternalIn.add(tgtKey)
          portHasAnyEdge.add(tgtKey)
        } else if (!srcIn && tgtIn) {
          externalEdges.push(edge)
          portHasAnyEdge.add(`${edge.target.nodeId}__${edge.target.port}`)
        } else if (srcIn && !tgtIn) {
          externalEdges.push(edge)
        }
      }

      // Sink nodes (no outgoing edge inside the selection) → output exposure.
      const sinkNodes = cleanIds.filter((id) => !hasInternalOutgoing.has(id))

      // Node meta (ordinary batteries from the catalog; nested __group__ nodes
      // get a derived virtual meta).
      const getBatteryMeta = (nodeId: string) => getNodeMeta(nodeId)

      const resolveExposedPortLabels = (
        nodeId: string,
        direction: 'input' | 'output',
        portName: string,
        fallbackLabel?: string,
      ): { portLabel: string; portLabelEn: string } => {
        const pNode = currentPipeline.nodes.find((n) => n.id === nodeId)
        if (pNode?.batteryId === '__group__') {
          const childGroupId = typeof pNode.params?.groupId === 'string' ? pNode.params.groupId : ''
          const childGroup = (currentPipeline.groups ?? []).find((g) => g.id === childGroupId)
          const childPort = (direction === 'input' ? childGroup?.exposedInputs : childGroup?.exposedOutputs)
            ?.find((port) => port.portName === portName)
          if (childPort) {
            return {
              portLabel: getGroupPortDisplayLabel(childPort, false),
              portLabelEn: getGroupPortDisplayLabel(childPort, true),
            }
          }
        }
        return {
          portLabel: fallbackLabel || portName,
          portLabelEn: formatIdAsLabel(portName),
        }
      }

      // ── Build exposed-port maps (portKey → ExposedPort) ────────────────────
      const exposedInputsMap  = new Map<string, ExposedPort>()
      const exposedOutputsMap = new Map<string, ExposedPort>()

      // Exposed inputs: for each input port of each selected node, expose it when
      // (1) batteryId !== 'text_panel', (2) no internal upstream edge,
      // (3) if dynamic (name starts with prefix) it must be connected.
      for (const nodeId of cleanIds) {
        const pNode = currentPipeline.nodes.find((n) => n.id === nodeId)
        if (!pNode || pNode.batteryId === 'text_panel') continue
        const meta = getBatteryMeta(nodeId)
        const inputs = meta?.inputs ?? []
        const dynPrefix = meta?.dynamicInputs?.prefix
        for (const port of inputs) {
          const key = `${nodeId}__${port.name}`
          if (portHasInternalIn.has(key)) continue
          const isDynamic = !!dynPrefix && port.name.startsWith(dynPrefix)
          if (isDynamic && !portHasAnyEdge.has(key)) continue
          if (!exposedInputsMap.has(key)) {
            const labels = resolveExposedPortLabels(nodeId, 'input', port.name, port.label || port.name)
            exposedInputsMap.set(key, {
              portName: `in__${nodeId.slice(-4)}__${port.name}`,
              portType: port.type ?? 'any',
              portLabel: labels.portLabel,
              portLabelEn: labels.portLabelEn,
              sourceNodeId: nodeId,
              sourcePortName: port.name,
              ...(port.options?.length ? { options: port.options } : {}),
            })
          }
        }
      }

      // Supplement: external-input ports not declared in meta (runtime-extended
      // dynamic ports).
      for (const edge of externalEdges) {
        if (!selectedSet.has(edge.source.nodeId) && selectedSet.has(edge.target.nodeId)) {
          const tgtPNode = currentPipeline.nodes.find((n) => n.id === edge.target.nodeId)
          if (tgtPNode?.batteryId === 'text_panel') continue
          const key = `${edge.target.nodeId}__${edge.target.port}`
          if (!exposedInputsMap.has(key)) {
            const meta = getBatteryMeta(edge.target.nodeId)
            const portMeta = meta?.inputs.find((p) => p.name === edge.target.port)
            const labels = resolveExposedPortLabels(edge.target.nodeId, 'input', edge.target.port, portMeta?.label || portMeta?.name || edge.target.port)
            exposedInputsMap.set(key, {
              portName: `in__${edge.target.nodeId.slice(-4)}__${edge.target.port}`,
              portType: portMeta?.type ?? 'any',
              portLabel: labels.portLabel,
              portLabelEn: labels.portLabelEn,
              sourceNodeId: edge.target.nodeId,
              sourcePortName: edge.target.port,
              ...(portMeta?.options?.length ? { options: portMeta.options } : {}),
            })
          }
        }
      }

      // Exposed outputs: all output ports of the sink nodes.
      for (const nodeId of sinkNodes) {
        const meta = getBatteryMeta(nodeId)
        const outputs = meta?.outputs ?? []
        for (const port of outputs) {
          const key = `${nodeId}__${port.name}`
          if (!exposedOutputsMap.has(key)) {
            const labels = resolveExposedPortLabels(nodeId, 'output', port.name, port.label || port.name)
            exposedOutputsMap.set(key, {
              portName: `out__${nodeId.slice(-4)}__${port.name}`,
              portType: port.type ?? 'any',
              portLabel: labels.portLabel,
              portLabelEn: labels.portLabelEn,
              sourceNodeId: nodeId,
              sourcePortName: port.name,
            })
          }
        }
      }

      // External-output port supplement (so external edges can redirect to the
      // GroupNode's exposed ports).
      for (const edge of externalEdges) {
        if (selectedSet.has(edge.source.nodeId) && !selectedSet.has(edge.target.nodeId)) {
          const key = `${edge.source.nodeId}__${edge.source.port}`
          if (!exposedOutputsMap.has(key)) {
            const meta = getBatteryMeta(edge.source.nodeId)
            const portMeta = meta?.outputs.find((p) => p.name === edge.source.port)
            const labels = resolveExposedPortLabels(edge.source.nodeId, 'output', edge.source.port, portMeta?.label || portMeta?.name || edge.source.port)
            exposedOutputsMap.set(key, {
              portName: `out__${edge.source.nodeId.slice(-4)}__${edge.source.port}`,
              portType: portMeta?.type ?? 'any',
              portLabel: labels.portLabel,
              portLabelEn: labels.portLabelEn,
              sourceNodeId: edge.source.nodeId,
              sourcePortName: edge.source.port,
            })
          }
        }
      }

      // Input-port ordering: grid/name-list → ordinary → random seed.
      const sortExposedInputs = (ports: ExposedPort[]): ExposedPort[] => {
        const isGridOrNameList = (p: ExposedPort) => {
          const label = p.portLabel ?? ''
          const name  = p.sourcePortName ?? ''
          return label.includes('网格列表') || label.includes('名称清单') ||
                 name === 'gridList'        || name === 'nameList' ||
                 name === 'grid_list'       || name === 'name_list'
        }
        const isSeed = (p: ExposedPort) => {
          const label = p.portLabel ?? ''
          const name  = p.sourcePortName ?? ''
          return label.includes('随机种子') || label.includes('种子') || name === 'seed'
        }
        const front  = ports.filter((p) => isGridOrNameList(p))
        const middle = ports.filter((p) => !isGridOrNameList(p) && !isSeed(p))
        const back   = ports.filter((p) => isSeed(p))
        return [...front, ...middle, ...back]
      }

      const exposedInputs  = sortExposedInputs(Array.from(exposedInputsMap.values()))
      const exposedOutputs = Array.from(exposedOutputsMap.values())

      // GroupNode position = the geometric center of the selected nodes.
      const selectedRfNodes = nodes.filter((n) => selectedSet.has(n.id))
      const avgX = selectedRfNodes.reduce((s, n) => s + n.position.x, 0) / selectedRfNodes.length
      const avgY = selectedRfNodes.reduce((s, n) => s + n.position.y, 0) / selectedRfNodes.length

      const groupId = genGroupId()
      const groupName = 'Group Node'

      // Build the NodeGroup snapshot.
      const subNodes = currentPipeline.nodes.filter((n) => selectedSet.has(n.id))
      const subEdges = allEdges.filter((e) => internalEdgeIds.has(e.id))

      // Record the current RF positions to restore the layout on group entry.
      const innerLayout: Record<string, { x: number; y: number }> = {}
      for (const rfNode of selectedRfNodes) {
        innerLayout[rfNode.id] = { x: rfNode.position.x, y: rfNode.position.y }
      }

      const group: NodeGroup = {
        id: groupId,
        name: groupName,
        nodes: subNodes,
        edges: subEdges,
        position: { x: avgX, y: avgY },
        exposedInputs,
        exposedOutputs,
        innerLayout,
      }

      useHistoryStore.getState().record('group_nodes', currentPipeline, {
        label: `Group (${cleanIds.length} node(s))`,
        labelEn: `Group (${cleanIds.length} node(s))`,
        nodeIds: cleanIds,
      })

      // Remove the sub-nodes and all edges touching them from the store.
      for (const nodeId of cleanIds) removeNode(nodeId)

      // Add the GroupNode composite node to the store.
      const groupPipelineNode: PipelineNode = {
        id: groupId,
        batteryId: '__group__',
        name: groupName,
        position: { x: avgX, y: avgY },
        params: { groupId },
      }
      addGroup(group)
      addNode(groupPipelineNode)

      // Redirect external edges: endpoints become the GroupNode's exposed ports.
      for (const edge of externalEdges) {
        const srcIn = selectedSet.has(edge.source.nodeId)
        const tgtIn = selectedSet.has(edge.target.nodeId)

        if (!srcIn && tgtIn) {
          const inKey = `${edge.target.nodeId}__${edge.target.port}`
          const exposed = exposedInputsMap.get(inKey)
          if (!exposed) continue
          addEdge({
            id: `${edge.id}_redir`,
            source: edge.source,
            target: { nodeId: groupId, port: exposed.portName },
          })
        } else if (srcIn && !tgtIn) {
          const outKey = `${edge.source.nodeId}__${edge.source.port}`
          const exposed = exposedOutputsMap.get(outKey)
          if (!exposed) continue
          addEdge({
            id: `${edge.id}_redir`,
            source: { nodeId: groupId, port: exposed.portName },
            target: edge.target,
          })
        }
      }

      // Update ReactFlow local state.
      const groupRfData = buildGroupNodeData(group, onUngroup, onEnterGroup)
      const groupRfNode: Node = {
        id: groupId,
        type: 'group',
        position: { x: avgX, y: avgY },
        style: { width: estimateGroupNodeWidth(group) },
        data: groupRfData,
        selected: false,
      }

      setNodes((nds) => {
        const remaining = nds.filter((n) => !selectedSet.has(n.id))
        return [...remaining, groupRfNode]
      })

      // Rebuild ReactFlow edges:
      // - drop every edge touching a sub-node (internal + external),
      // - add the redirected external edges, inheriting color from the original
      //   edge style rather than re-deriving it.
      // NOTE: externalEdges are PipelineEdge (source/target are objects), while
      // ReactFlow Edge source/target are strings — access .nodeId accordingly.
      setEdges((eds) => {
        const kept = eds.filter((e) => !selectedSet.has(e.source) && !selectedSet.has(e.target))
        const edgeStyleMap = new Map(eds.map((e) => [e.id, e.style]))
        const redirected: Edge[] = externalEdges.flatMap((pipelineEdge) => {
          const srcIn = selectedSet.has(pipelineEdge.source.nodeId)
          const tgtIn = selectedSet.has(pipelineEdge.target.nodeId)
          const originalStyle = edgeStyleMap.get(pipelineEdge.id)
          const color = (originalStyle?.stroke as string | undefined) ?? 'var(--color-accent)'
          if (!srcIn && tgtIn) {
            const inKey = `${pipelineEdge.target.nodeId}__${pipelineEdge.target.port}`
            const exposed = exposedInputsMap.get(inKey)
            if (!exposed) return []
            return [{
              id: `${pipelineEdge.id}_redir`,
              source: pipelineEdge.source.nodeId,
              sourceHandle: pipelineEdge.source.port,
              target: groupId,
              targetHandle: exposed.portName,
              animated: false,
              style: { stroke: color, strokeWidth: 2 },
            } as Edge]
          } else if (srcIn && !tgtIn) {
            const outKey = `${pipelineEdge.source.nodeId}__${pipelineEdge.source.port}`
            const exposed = exposedOutputsMap.get(outKey)
            if (!exposed) return []
            return [{
              id: `${pipelineEdge.id}_redir`,
              source: groupId,
              sourceHandle: exposed.portName,
              target: pipelineEdge.target.nodeId,
              targetHandle: pipelineEdge.target.port,
              animated: false,
              style: { stroke: color, strokeWidth: 2 },
            } as Edge]
          }
          return []
        })
        return [...kept, ...redirected]
      })

      // After grouping: persist the session (the group snapshot is in memory via
      // addGroup; session.json will save it) and recompute. Saving to the battery
      // library is a manual action via the GroupNode "save" button.
      setTimeout(() => {
        void usePipelineStore.getState().persistSession()
        void usePipelineStore.getState().incrementalExecute(groupId, true, { persist: false })
      }, 50)
    },
    [nodes, edges, addNode, removeNode, addEdge, removeEdge, addGroup, setNodes, setEdges],
  )

  // Expand a GroupNode back into its inner sub-nodes and edges.
  const ungroupNode = useCallback(
    (groupId: string, onUngroup: (gid: string) => void) => {
      const { currentPipeline } = usePipelineStore.getState()
      if (!currentPipeline) return

      const group = (currentPipeline.groups ?? []).find((g) => g.id === groupId)
      if (!group) {
        console.warn('[Group] ungroupNode: group not found:', groupId)
        return
      }

      useHistoryStore.getState().record('ungroup_nodes', currentPipeline, {
        label: `Ungroup: ${group.name}`,
        labelEn: `Ungroup: ${group.name}`,
      })

      // External (redirected) edges currently connected to the GroupNode.
      const redirEdgesIn  = currentPipeline.edges.filter((e) => e.target.nodeId === groupId)
      const redirEdgesOut = currentPipeline.edges.filter((e) => e.source.nodeId === groupId)

      // Remove the GroupNode + its redirected edges (cascade removes groupId edges).
      removeNode(groupId)
      removeGroup(groupId)

      // Restore sub-nodes.
      for (const n of group.nodes) addNode(n)

      // Restore internal edges.
      for (const e of group.edges) addEdge(e)

      // Restore external edges (map the GroupNode exposed ports back to the
      // original sub-node ports).
      for (const rEdge of [...redirEdgesIn, ...redirEdgesOut]) {
        if (rEdge.target.nodeId === groupId) {
          const exposed = group.exposedInputs.find((p) => p.portName === rEdge.target.port)
          if (!exposed) continue
          const restoredEdge: PipelineEdge = {
            id: rEdge.id.replace('_redir', ''),
            source: rEdge.source,
            target: { nodeId: exposed.sourceNodeId, port: exposed.sourcePortName },
          }
          addEdge(restoredEdge)
        }
        if (rEdge.source.nodeId === groupId) {
          const exposed = group.exposedOutputs.find((p) => p.portName === rEdge.source.port)
          if (!exposed) continue
          const restoredEdge: PipelineEdge = {
            id: rEdge.id.replace('_redir', ''),
            source: { nodeId: exposed.sourceNodeId, port: exposed.sourcePortName },
            target: rEdge.target,
          }
          addEdge(restoredEdge)
        }
      }

      // Update ReactFlow local state. Nested case: a sub-node may itself be a
      // __group__, which must be rebuilt as a GroupNode RF node.
      setNodes((nds) => {
        const { batteries, currentPipeline: pipe } = usePipelineStore.getState()
        const without = nds.filter((n) => n.id !== groupId)
        const restoredRf = group.nodes.map((n) => {
          if (n.batteryId === '__group__') {
            const innerGroupId = typeof n.params?.groupId === 'string' ? n.params.groupId : ''
            const innerGroup = (pipe?.groups ?? []).find((g) => g.id === innerGroupId)
            if (!innerGroup) return null
            return {
              id: n.id,
              type: 'group',
              position: n.position,
              style: { width: estimateGroupNodeWidth(group, DEFAULT_GROUP_WIDTH) },
              data: buildGroupNodeData(innerGroup, onUngroup),
              selected: false,
            }
          }
          if (n.batteryId === RELAY_BATTERY_ID) {
            return {
              id: n.id,
              type: 'relay',
              position: n.position,
              style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT },
              data: { portType: typeof n.params?.portType === 'string' ? n.params.portType : 'any' },
              selected: false,
            }
          }
          const battery = batteries.find((b) => b.id === n.batteryId)
          if (!battery) return null
          const { type: nodeType, style } = resolveNodeTypeAndStyle(n.batteryId)
          return {
            id: n.id,
            type: nodeType,
            position: n.position,
            style,
            data: { battery, params: n.params || {} },
            selected: false,
          }
        }).filter(Boolean) as Node[]
        return [...without, ...restoredRf]
      })

      // Rebuild edges. Color policy:
      //   internal edges: source is a sub-node (addNode done) → derive from meta.
      //   external edges: the redir edge color was set correctly at group time →
      //     inherit it (the GroupNode has no port metadata to derive from).
      setEdges((eds) => {
        const redirStyleMap = new Map(eds.map((e) => [e.id, e.style]))
        const kept = eds.filter((e) => e.source !== groupId && e.target !== groupId)
        const restoredInternal = group.edges.map((e) => ({
          id: e.id,
          source: e.source.nodeId,
          target: e.target.nodeId,
          sourceHandle: e.source.port,
          targetHandle: e.target.port,
          animated: false,
          style: { stroke: resolveEdgeColor(e.source.nodeId, e.source.port, domainPortTypes), strokeWidth: 2 },
        }))
        const restoredExternal: Edge[] = []
        for (const rEdge of [...redirEdgesIn, ...redirEdgesOut]) {
          if (rEdge.target.nodeId === groupId) {
            const exposed = group.exposedInputs.find((p) => p.portName === rEdge.target.port)
            if (!exposed) continue
            const redirStyle = redirStyleMap.get(rEdge.id)
            const color = (redirStyle?.stroke as string | undefined) ?? resolveEdgeColor(rEdge.source.nodeId, rEdge.source.port, domainPortTypes)
            restoredExternal.push({
              id: rEdge.id.replace('_redir', ''),
              source: rEdge.source.nodeId,
              sourceHandle: rEdge.source.port,
              target: exposed.sourceNodeId,
              targetHandle: exposed.sourcePortName,
              animated: false,
              style: { stroke: color, strokeWidth: 2 },
            } as unknown as Edge)
          }
          if (rEdge.source.nodeId === groupId) {
            const exposed = group.exposedOutputs.find((p) => p.portName === rEdge.source.port)
            if (!exposed) continue
            const redirStyle = redirStyleMap.get(rEdge.id)
            const color = (redirStyle?.stroke as string | undefined) ?? resolveEdgeColor(exposed.sourceNodeId, exposed.sourcePortName, domainPortTypes)
            restoredExternal.push({
              id: rEdge.id.replace('_redir', ''),
              source: exposed.sourceNodeId,
              sourceHandle: exposed.sourcePortName,
              target: rEdge.target.nodeId,
              targetHandle: rEdge.target.port,
              animated: false,
              style: { stroke: color, strokeWidth: 2 },
            } as unknown as Edge)
          }
        }
        return [...kept, ...restoredInternal, ...restoredExternal]
      })

      // Ungroup must trigger a full recompute + persist so the renderer sees the
      // restored sub-nodes. AI nodes are run manually, so they are not auto-fired.
      const firstNodeId = group.nodes[0]?.id
      if (firstNodeId) {
        setTimeout(() => {
          void usePipelineStore.getState().persistSession()
          void usePipelineStore.getState().incrementalExecute(firstNodeId, true, { persist: false })
        }, 50)
      }
    },
    [addNode, removeNode, addEdge, removeEdge, addGroup, removeGroup, setNodes, setEdges],
  )

  return { groupSelectedNodes, ungroupNode }
}
