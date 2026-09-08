// Shared helpers for grouping / group-view (decoupling the duplicated dependency
// between the group-collapse and group-view canvas wiring). Ported from the
// legacy editor (components/canvas/groupViewUtils.ts) with imports retargeted
// onto the editor stores + sibling utils. Pure functions; no app coupling.
import { usePipelineStore } from '../../stores/index.js'
import { getPortTypeColor, type DomainPortTypes } from '../../utils/portTypes.js'
import { resolveNodeType, DEFAULT_BATTERY_WIDTH, estimateBatteryNodeWidth } from './canvasConstants.js'
import { RELAY_BATTERY_ID, RELAY_INPUT_PORT, RELAY_NODE_HEIGHT, RELAY_NODE_WIDTH, RELAY_OUTPUT_PORT } from './RelayNode.js'
import type { Battery, NodeGroup, PipelineNode, PipelineEdge, ExposedPort } from '../../types.js'

/**
 * Generic node-meta shape: port exposure / tooltip / nested grouping logic all
 * operate on this shape. Plain batteries are full Battery; `__group__` nodes are
 * derived into the same shape (without dynamicInputs/Outputs).
 */
export type NodeMeta = Pick<Battery, 'inputs' | 'outputs'> & {
  dynamicInputs?: Battery['dynamicInputs']
  dynamicOutputs?: Battery['dynamicOutputs']
}

export type GroupPortDirection = 'input' | 'output'

export function sortGroupPorts<T extends ExposedPort>(ports: T[]): T[] {
  return [...ports].sort((a, b) => {
    const orderA = typeof a.order === 'number' ? a.order : ports.indexOf(a)
    const orderB = typeof b.order === 'number' ? b.order : ports.indexOf(b)
    return orderA - orderB
  })
}

export function getVisibleGroupPorts<T extends ExposedPort>(ports: T[]): T[] {
  return sortGroupPorts(ports).filter(port => !port.hidden)
}

function stripGeneratedGroupPortName(name: string | undefined): string {
  if (!name) return ''
  return name.replace(/^(in|out)__[^_]+__/, '')
}

function isGeneratedGroupPortLabel(port: ExposedPort, label: string | undefined): boolean {
  if (!label) return false
  const sourceName = port.sourcePortName || port.portName
  const hasGeneratedName = /^(in|out)__[^_]+__/.test(sourceName) || /^(in|out)__[^_]+__/.test(port.portName)
  return hasGeneratedName && /^(In|Out) [A-Za-z0-9]{3,}\b/.test(label)
}

export function getGroupPortDisplayLabel(port: ExposedPort, en: boolean): string {
  if (en) {
    const explicitEn = port.customLabelEn?.trim()
    if (explicitEn) return explicitEn
    if (port.portLabelEn && !isGeneratedGroupPortLabel(port, port.portLabelEn)) return port.portLabelEn
    return port.customLabel?.trim()
      || port.portLabel
      || stripGeneratedGroupPortName(port.sourcePortName)
      || stripGeneratedGroupPortName(port.portName)
      || port.sourcePortName
      || port.portName
  }
  return port.customLabel?.trim() || port.portLabel || port.portName
}

export function getGroupPortsForDirection(group: NodeGroup, direction: GroupPortDirection, visibleOnly = false): ExposedPort[] {
  const ports = direction === 'input' ? group.exposedInputs : group.exposedOutputs
  return visibleOnly ? getVisibleGroupPorts(ports) : sortGroupPorts(ports)
}

/**
 * Derive a virtual Battery meta from a NodeGroup: map exposedInputs/Outputs
 * directly into BatteryInput/Output shape. Exposed ports already carry
 * portName/portType/portLabel/options, so no extra inference is needed. Group
 * nodes have no dynamic-port configuration.
 */
export function deriveGroupVirtualMeta(group: NodeGroup): NodeMeta {
  return {
    inputs: getVisibleGroupPorts(group.exposedInputs).map(ep => ({
      name: ep.portName,
      type: ep.portType,
      required: false,
      description: '',
      label: ep.customLabel?.trim() || ep.portLabel,
      ...(ep.options?.length ? { options: ep.options } : {}),
    })),
    outputs: getVisibleGroupPorts(group.exposedOutputs).map(ep => ({
      name: ep.portName,
      type: ep.portType,
      description: '',
      label: ep.customLabel?.trim() || ep.portLabel,
    })),
  }
}

/**
 * Generic node-meta resolution: plain batteries are looked up in the battery
 * library; `__group__` nodes derive a virtual meta from pipeline.groups. Port
 * exposure / tooltip logic obtains a node's inputs/outputs through this function
 * uniformly, transparent to nested groups.
 */
export function getNodeMeta(nodeId: string): NodeMeta | undefined {
  const { currentPipeline, batteries } = usePipelineStore.getState()
  const pNode = currentPipeline?.nodes.find(n => n.id === nodeId)
  if (!pNode) return undefined
  if (pNode.batteryId === RELAY_BATTERY_ID) {
    const portType = typeof pNode.params?.portType === 'string' ? pNode.params.portType : 'any'
    return {
      inputs: [{ name: RELAY_INPUT_PORT, type: portType, required: false, description: '', label: 'input' }],
      outputs: [{ name: RELAY_OUTPUT_PORT, type: portType, description: '', label: 'output' }],
    }
  }
  if (pNode.batteryId === '__group__') {
    const groupId = pNode.params?.groupId
    if (typeof groupId !== 'string') return undefined
    const group = (currentPipeline?.groups ?? []).find(g => g.id === groupId)
    return group ? deriveGroupVirtualMeta(group) : undefined
  }
  return batteries.find(b => b.id === pNode.batteryId)
}

/** Generate a unique id (prefix + timestamp + random suffix). */
function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Deep-clone a NodeGroup and remap all internal ids to avoid collisions between
 * multiple instances. Also updates position to the supplied new position.
 *
 * groupIdMap covers the nested case: a parent group's `__group__` child nodes
 * carry params.groupId which must also be remapped to the new groupId (otherwise
 * the parent -> child reference breaks).
 */
export function remapGroupIds(
  group: NodeGroup,
  newPosition: { x: number; y: number },
  groupIdMap?: Record<string, string>,
): NodeGroup {
  const newGroupId = groupIdMap?.[group.id] ?? `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const nodeIdMap: Record<string, string> = {}

  const newNodes: PipelineNode[] = group.nodes.map(n => {
    const newId = genId('node')
    nodeIdMap[n.id] = newId
    // When a child node is a nested `__group__`, params.groupId must be remapped
    // to the new id (if present in the map).
    const params = n.batteryId === '__group__' && groupIdMap
      ? (() => {
          const old = typeof n.params?.groupId === 'string' ? n.params.groupId : ''
          const replaced = groupIdMap[old]
          return replaced ? { ...n.params, groupId: replaced } : n.params
        })()
      : n.params
    return { ...n, id: newId, params }
  })

  const newEdges: PipelineEdge[] = group.edges.map(e => ({
    ...e,
    id: genId('edge'),
    source: { ...e.source, nodeId: nodeIdMap[e.source.nodeId] ?? e.source.nodeId },
    target: { ...e.target, nodeId: nodeIdMap[e.target.nodeId] ?? e.target.nodeId },
  }))

  const remapPorts = (ports: ExposedPort[]): ExposedPort[] =>
    ports.map(p => ({ ...p, sourceNodeId: nodeIdMap[p.sourceNodeId] ?? p.sourceNodeId }))

  const newInnerLayout: Record<string, { x: number; y: number }> = {}
  if (group.innerLayout) {
    for (const [oldId, pos] of Object.entries(group.innerLayout)) {
      newInnerLayout[nodeIdMap[oldId] ?? oldId] = pos
    }
  }

  return {
    ...group,
    id: newGroupId,
    position: newPosition,
    nodes: newNodes,
    edges: newEdges,
    exposedInputs: remapPorts(group.exposedInputs),
    exposedOutputs: remapPorts(group.exposedOutputs),
    innerLayout: newInnerLayout,
  }
}

/**
 * Collect a group's nested dependency snapshot (recursively find all `__group__`
 * child nodes' groupId, look up the corresponding NodeGroup, dedupe and flatten).
 * Used when saving a parent group to bundle its dependencies.
 *
 * @param root   parent group
 * @param lookup resolve a NodeGroup by groupId (usually pipeline.groups find closure)
 * @returns      unique nested dependency snapshots (excluding root itself)
 */
export function collectNestedDependencies(
  root: NodeGroup,
  lookup: (groupId: string) => NodeGroup | undefined,
): NodeGroup[] {
  const seen = new Set<string>([root.id])
  const out: NodeGroup[] = []
  const visit = (g: NodeGroup) => {
    for (const n of g.nodes) {
      if (n.batteryId !== '__group__') continue
      const gid = typeof n.params?.groupId === 'string' ? n.params.groupId : ''
      if (!gid || seen.has(gid)) continue
      const child = lookup(gid)
      if (!child) continue
      seen.add(gid)
      out.push(child)
      visit(child)
    }
  }
  visit(root)
  return out
}

/**
 * Expand a NodeGroup loaded from disk into an array ready to splice into
 * pipeline.groups: [root (with _nestedGroups stripped), ...nested deps]. Used by
 * both session restore and opening a pipeline file to restore nested deps.
 */
export function expandLoadedGroupBundle(loaded: NodeGroup): NodeGroup[] {
  const deps = loaded._nestedGroups ?? []
  const { _nestedGroups: _omit, ...rest } = loaded
  void _omit
  return [rest as NodeGroup, ...deps]
}

/**
 * When dropping a group with nested dependencies, remap the whole dependency
 * tree (root + _nestedGroups) to fresh ids consistently. The parent group's
 * `__group__` child nodes' params.groupId auto-point to the new ids (via
 * groupIdMap).
 *
 * Returns { root, deps }: root is the remapped parent group (bound to
 * newPosition); deps are the remapped dependencies (each keeping its original
 * position; layout inside group view is decided by innerLayout).
 */
export function remapGroupBundle(
  root: NodeGroup,
  deps: NodeGroup[],
  newPosition: { x: number; y: number },
): { root: NodeGroup; deps: NodeGroup[] } {
  const groupIdMap: Record<string, string> = {}
  const allOldIds = [root.id, ...deps.map(d => d.id)]
  for (const oldId of allOldIds) {
    groupIdMap[oldId] = `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  }
  const newRoot = remapGroupIds(root, newPosition, groupIdMap)
  const newDeps = deps.map(d => remapGroupIds(d, d.position, groupIdMap))
  return { root: newRoot, deps: newDeps }
}

/**
 * Resolve an edge color from a source node id + source port name, using node
 * snapshots or battery metadata. contextNodes is for group view: inner nodes are
 * not at the currentPipeline.nodes root level and must be resolved from the
 * group.nodes snapshot.
 */
export function resolveEdgeColorFromStore(
  sourceNodeId: string,
  sourcePort: string,
  contextNodes?: PipelineNode[],
  domainPortTypes?: DomainPortTypes,
): string {
  const { currentPipeline, batteries } = usePipelineStore.getState()
  const pNode = contextNodes?.find(n => n.id === sourceNodeId)
    ?? currentPipeline?.nodes.find(n => n.id === sourceNodeId)
  if (pNode?.batteryId === RELAY_BATTERY_ID) {
    const portType = typeof pNode.params?.portType === 'string' ? pNode.params.portType : 'any'
    return portType === 'any' ? 'var(--color-accent)' : getPortTypeColor(portType, domainPortTypes)
  }
  if (pNode?.batteryId === '__group__') {
    const groupId = typeof pNode.params?.groupId === 'string' ? pNode.params.groupId : ''
    const group = (currentPipeline?.groups ?? []).find(g => g.id === groupId)
    const exposed = group?.exposedOutputs.find(p => p.portName === sourcePort)
    if (exposed) return getPortTypeColor(exposed.portType, domainPortTypes)
  }
  const battery = batteries.find(b => b.id === pNode?.batteryId)
  const port = battery?.outputs?.find(o => o.name === sourcePort)
  return port ? getPortTypeColor(port.type, domainPortTypes) : 'var(--color-accent)'
}

/**
 * Determine a node's ReactFlow nodeType and style from battery metadata,
 * consistent with session restore.
 */
export function resolveNodeTypeAndStyleFromStore(batteryId: string): { type: string; style: Record<string, number> } {
  if (batteryId === RELAY_BATTERY_ID) {
    return { type: 'relay', style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT } }
  }

  const { batteries } = usePipelineStore.getState()
  const battery = batteries.find(b => b.id === batteryId)
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
