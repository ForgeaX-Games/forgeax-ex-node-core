// Mappers between the kernel graph model (GraphNode/GraphEdge/OpSpec/NodeGroup)
// and the editor UI model (PipelineNode/PipelineEdge/Battery/NodeGroup).
//
// The kernel is the source of truth; the editor holds a UI-superset Pipeline.
// On read we project the kernel snapshot into the editor model; on write we
// diff the editor Pipeline against the kernel snapshot and emit a minimal Op[].

import type {
  GraphEdge,
  GraphNode,
  NodeGroup as KernelNodeGroup,
  Op,
  OpSpec,
  PipelineSnapshot,
} from '@forgeax/node-runtime'

import { GROUP_BATTERY_ID } from '../types.js'
import type {
  Battery,
  BatteryPort,
  CanvasAnnotation,
  CanvasFrame,
  ExposedPort,
  NodeGroup,
  Pipeline,
  PipelineEdge,
  PipelineNode,
  Viewport,
} from '../types.js'

const KERNEL_GROUP_OP_ID = '__group__'

// ── Battery catalog (OpSpec → Battery) ───────────────────────────────────

function toBatteryPort(p: { name: string; type: string; label?: string; description?: string; descriptionEn?: string; options?: string[]; required?: boolean; default?: unknown; access?: 'item' | 'list' | 'tree' }): BatteryPort {
  return {
    name: p.name,
    type: p.type,
    label: p.label,
    description: p.description,
    descriptionEn: p.descriptionEn,
    options: p.options,
    required: p.required,
    default: p.default as unknown,
    access: p.access,
  }
}

/**
 * Project a kernel OpSpec into the editor's Battery catalog entry. The op id is
 * namespaced (e.g. 'wb-scene.csg.union'); the segment before the first dot is
 * used as the default category when the spec carries no explicit grouping.
 */
export function opSpecToBattery(spec: OpSpec): Battery {
  // The kernel OpSpec carries no UI grouping, but a domain backend may re-attach
  // `category` / `displayGroup` hints on the wire (see scene-generator's ops
  // route). Prefer those; otherwise fall back to the op-id namespace.
  const ui = spec as OpSpec & {
    category?: string
    displayGroup?: string
    type?: string
    nodeType?: string
    hideOutputs?: boolean
    iconSvg?: string
  }
  const category = ui.category ?? (spec.id.includes('.') ? spec.id.split('.')[0] : 'general')
  const displayGroup = ui.displayGroup ?? category
  return {
    id: spec.id,
    name: spec.name ?? spec.id,
    nameEn: spec.nameEn,
    type: 'ts',
    category,
    description: spec.description ?? '',
    descriptionEn: spec.descriptionEn,
    version: '1.0.0',
    // OpSpec ports/params are optional on the wire — some ops ship only inputs,
    // or omit params entirely. Guard each before mapping so one bare spec can't
    // crash the whole battery catalog load (→ an empty BatteryBar).
    inputs: (spec.inputs ?? []).map(toBatteryPort),
    outputs: (spec.outputs ?? []).map(toBatteryPort),
    params: (spec.params ?? []).map(p => ({
      name: p.name,
      // OpParam.type is a free PortType string; narrow to the UI enum, defaulting to 'string'.
      type: (['string', 'number', 'boolean', 'select'].includes(p.type) ? p.type : 'string') as Battery['params'][number]['type'],
      default: p.default as unknown,
      description: p.description,
      options: p.options,
      min: p.min,
      max: p.max,
      label: p.label,
    })),
    dynamicInputs: spec.dynamicInputs,
    dynamicOutputs: spec.dynamicOutputs,
    lacing: spec.lacing,
    principal: spec.principal,
    displayGroup,
    // UI render hints re-attached by a domain backend on the wire (e.g. from
    // meta.frontend.nodeType / .hideOutputs). Only set when present so plain
    // batteries keep their type-derived defaults.
    ...(ui.nodeType ? { nodeType: ui.nodeType } : {}),
    ...(ui.hideOutputs !== undefined ? { hideOutputs: ui.hideOutputs } : {}),
    ...(ui.iconSvg !== undefined ? { iconSvg: ui.iconSvg } : {}),
  }
}

// ── Graph nodes / edges ──────────────────────────────────────────────────

export function graphNodeToPipelineNode(n: GraphNode): PipelineNode {
  return {
    id: n.id,
    batteryId: n.opId,
    name: n.name ?? n.id,
    position: n.position,
    params: { ...n.params },
    status: n.status,
    // `previewEnabled` is a client-only editor toggle; the kernel graph never
    // carries it, so it is intentionally not mapped here (defaults to "on").
  }
}

export function graphEdgeToPipelineEdge(e: GraphEdge): PipelineEdge {
  return { id: e.id, source: { ...e.source }, target: { ...e.target } }
}

export function kernelGroupToEditorGroup(g: KernelNodeGroup): NodeGroup {
  return {
    id: g.id,
    name: g.name,
    nameEn: g.nameEn,
    nodes: g.nodes.map(graphNodeToPipelineNode),
    edges: g.edges.map(graphEdgeToPipelineEdge),
    position: g.position,
    exposedInputs: g.exposedInputs.map(p => ({ ...p } as ExposedPort)),
    exposedOutputs: g.exposedOutputs.map(p => ({ ...p } as ExposedPort)),
    _nestedGroups: g._nestedGroups?.map(kernelGroupToEditorGroup),
  }
}

export function pipelineNodeToGraphNode(n: PipelineNode): GraphNode {
  return {
    id: n.id,
    opId: n.batteryId,
    name: n.name,
    position: n.position,
    params: { ...n.params },
    status: n.status,
    // `previewEnabled` is client-only and never persisted to the kernel graph.
  }
}

export function pipelineEdgeToGraphEdge(e: PipelineEdge): GraphEdge {
  return { id: e.id, source: { ...e.source }, target: { ...e.target } }
}

export function editorGroupToKernelGroup(g: NodeGroup): KernelNodeGroup {
  return {
    id: g.id,
    name: g.name,
    nameEn: g.nameEn,
    nodes: g.nodes.map(pipelineNodeToGraphNode),
    edges: g.edges.map(pipelineEdgeToGraphEdge),
    position: g.position,
    exposedInputs: g.exposedInputs.map((p) => ({ ...p })),
    exposedOutputs: g.exposedOutputs.map((p) => ({ ...p })),
    _nestedGroups: g._nestedGroups?.map(editorGroupToKernelGroup),
  }
}

/**
 * Build the editor Pipeline from a kernel snapshot (+ optional resolved
 * groups). Preserves identity of the supplied id/name where the caller has a
 * richer prior pipeline.
 */
export function snapshotToPipeline(
  snap: PipelineSnapshot,
  opts: { name?: string; description?: string; groups?: readonly KernelNodeGroup[] } = {},
): Pipeline {
  const nodes = Object.values(snap.nodes).map(graphNodeToPipelineNode)
  const edges = Object.values(snap.edges).map(graphEdgeToPipelineEdge)
  // Layout metadata (viewport / annotations / frames) round-trips through
  // graph.metadata — written by importPipelineGraph / persistViewport, read
  // here so the editor restores the imported canvas exactly (faithful to the
  // legacy normalizePipeline, which preserved these UI-only fields).
  const meta = (snap.metadata ?? {}) as {
    viewport?: Viewport
    annotations?: CanvasAnnotation[]
    frames?: CanvasFrame[]
  }
  return {
    id: snap.id,
    name: opts.name ?? snap.id,
    description: opts.description ?? '',
    nodes,
    edges,
    viewport: meta.viewport ?? { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
    groups: opts.groups?.map(kernelGroupToEditorGroup),
    ...(meta.annotations !== undefined ? { annotations: meta.annotations } : {}),
    ...(meta.frames !== undefined ? { frames: meta.frames } : {}),
  }
}

// ── Diff (editor Pipeline → Op[]) ────────────────────────────────────────

function paramsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.is(a[k], b[k])) {
      // Fall back to structural compare for nested values.
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false
    }
  }
  return true
}

/**
 * Diff a desired editor Pipeline against the current kernel snapshot and emit
 * a minimal Op[] that transforms the kernel graph into the desired state.
 *
 * Covers plain nodes/edges (create/update/delete/connect/disconnect). Group
 * shadow nodes (batteryId === '__group__') are skipped here — group structure
 * is mutated through dedicated group ops (see apiAdapter.saveGroup).
 */
export function diffPipelineToOps(
  desired: Pipeline,
  current: PipelineSnapshot | null,
): Op[] {
  const ops: Op[] = []
  const curNodes = current?.nodes ?? {}
  const curEdges = current?.edges ?? {}
  const newGroups: Array<{ shadowId: string; group: NodeGroup; position: { x: number; y: number }; name: string; nameEn?: string }> = []
  const existingGroups: Array<{ shadowId: string; group: NodeGroup; position: { x: number; y: number }; name: string; nameEn?: string }> = []
  const deletedGroupIds = new Set<string>()
  const deletedNodeIds = new Set<string>()

  for (const node of desired.nodes) {
    if (node.batteryId !== GROUP_BATTERY_ID) continue
    const groupId = typeof node.params?.groupId === 'string' ? node.params.groupId : node.id
    const group = (desired.groups ?? []).find((g) => g.id === groupId)
    if (!group) continue
    const entry = {
      shadowId: node.id,
      group,
      position: node.position ?? group.position,
      name: node.name || group.name,
      nameEn: group.nameEn,
    }
    if (curNodes[node.id]?.opId === KERNEL_GROUP_OP_ID) existingGroups.push(entry)
    else newGroups.push(entry)
  }
  const newGroupIds = new Set(newGroups.map((g) => g.shadowId))
  const newGroupMemberIds = new Set(newGroups.flatMap((g) => g.group.nodes.map((n) => n.id)))

  const desiredNodeIds = new Set<string>()
  for (const node of desired.nodes) {
    if (node.batteryId === GROUP_BATTERY_ID) {
      // Group shadow nodes are owned by group ops; still track id so we don't delete them.
      desiredNodeIds.add(node.id)
      continue
    }
    desiredNodeIds.add(node.id)
    const existing = curNodes[node.id]
    if (!existing) {
      ops.push({
        type: 'createNode',
        nodeId: node.id,
        opId: node.batteryId,
        position: node.position,
        params: { ...node.params },
      })
    } else {
      const positionChanged =
        existing.position.x !== node.position.x || existing.position.y !== node.position.y
      const paramsChanged = !paramsEqual(existing.params, node.params)
      if (positionChanged || paramsChanged) {
        const op: Extract<Op, { type: 'updateNode' }> = { type: 'updateNode', nodeId: node.id }
        if (paramsChanged) op.params = { ...node.params }
        if (positionChanged) op.position = node.position
        ops.push(op)
      }
    }
  }

  // Deleted groups (present in kernel, absent in desired). A root-level delete
  // of a group battery means deleting the composite, not ungrouping it.
  for (const [id, kn] of Object.entries(curNodes)) {
    if (kn.opId !== KERNEL_GROUP_OP_ID) continue
    if (!desiredNodeIds.has(id)) {
      deletedGroupIds.add(id)
      ops.push({ type: 'deleteGroup', groupId: id })
    }
  }

  // Deleted nodes (present in kernel, absent in desired). Skip kernel group
  // shadow nodes — those are handled by deleteGroup above.
  for (const [id, kn] of Object.entries(curNodes)) {
    if (kn.opId === KERNEL_GROUP_OP_ID) continue
    if (newGroupMemberIds.has(id)) continue
    if (!desiredNodeIds.has(id)) {
      deletedNodeIds.add(id)
      ops.push({ type: 'deleteNode', nodeId: id })
    }
  }

  // Edges.
  const desiredEdgeIds = new Set<string>()
  for (const edge of desired.edges) {
    desiredEdgeIds.add(edge.id)
    if (newGroupIds.has(edge.source.nodeId) || newGroupIds.has(edge.target.nodeId)) continue
    if (!curEdges[edge.id]) {
      ops.push({
        type: 'connect',
        edgeId: edge.id,
        source: { ...edge.source },
        target: { ...edge.target },
      })
    }
  }
  for (const id of Object.keys(curEdges)) {
    const edge = curEdges[id]
    if (edge && (deletedGroupIds.has(edge.source.nodeId) || deletedGroupIds.has(edge.target.nodeId))) continue
    if (edge && (deletedNodeIds.has(edge.source.nodeId) || deletedNodeIds.has(edge.target.nodeId))) continue
    if (edge && (newGroupMemberIds.has(edge.source.nodeId) || newGroupMemberIds.has(edge.target.nodeId))) continue
    if (!desiredEdgeIds.has(id)) ops.push({ type: 'disconnect', edgeId: id })
  }

  // Newly-created group shadows in the editor need to become real kernel groups.
  // If the group came from a template, its inner nodes/edges may not exist in
  // the current kernel graph yet, so create them first, then collapse via
  // createGroup. For ordinary "select nodes -> group", these are already
  // present and this prelude is empty.
  for (const { group } of newGroups) {
    for (const n of group.nodes) {
      if (curNodes[n.id]) continue
      ops.push({
        type: 'createNode',
        nodeId: n.id,
        opId: n.batteryId,
        position: n.position,
        params: { ...n.params },
        ...(n.name !== undefined ? { name: n.name } : {}),
      })
    }
    for (const e of group.edges) {
      if (curEdges[e.id]) continue
      ops.push({
        type: 'connect',
        edgeId: e.id,
        source: { ...e.source },
        target: { ...e.target },
      })
    }
  }

  for (const { shadowId, group, position, name, nameEn } of newGroups) {
    ops.push({
      type: 'createGroup',
      groupId: shadowId,
      name,
      nameEn,
      position,
      memberNodeIds: group.nodes.map((n) => n.id),
    })
  }

  for (const { shadowId, position, name, nameEn } of existingGroups) {
    const currentNode = curNodes[shadowId]
    if (!currentNode) continue
    const positionChanged =
      currentNode.position.x !== position.x || currentNode.position.y !== position.y
    const nameChanged = currentNode.name !== name
    if (positionChanged || nameChanged || nameEn !== undefined) {
      ops.push({
        type: 'updateGroup',
        groupId: shadowId,
        ...(nameChanged ? { name } : {}),
        ...(nameEn !== undefined ? { nameEn } : {}),
        ...(positionChanged ? { position } : {}),
      })
    }
  }

  return ops
}

// ── Import (whole editor Pipeline → ordered Op[]) ─────────────────────────
//
// The browser-side counterpart of the kernel `importPipelineGraph`: turns a
// whole legacy-shaped editor Pipeline into a single ordered Op[] the editor can
// submit through applyBatch (which then flows through the standard live-sync
// cascade). Use this for an inline graph chosen in the editor; the server route
// (importPipelineFile) is preferred when loading a template file headlessly.

export interface LegacyPipelineToOpsOptions {
  /** 'replace' (default): delete the current graph first. 'merge': additive. */
  mode?: 'replace' | 'merge'
  /** Current kernel snapshot — required to emit deletes (replace) / detect collisions (merge). */
  current?: PipelineSnapshot | null
  /** Auto-remap incoming ids that collide with the current graph (merge). Default: mode === 'merge'. */
  remapIds?: boolean
  /** Explicit incoming-id → new-id map, applied before collision handling. */
  idRemap?: Record<string, string>
  /** opId validator (e.g. against the loaded battery catalog). Unknown ids become diagnostics. */
  validateOps?: (opId: string) => boolean
}

export interface LegacyPipelineToOpsResult {
  ops: Op[]
  /** Incoming node id → final (possibly remapped) node id. */
  nodeIdMap: Record<string, string>
  diagnostics: Array<{ nodeId: string; opId: string; message: string }>
}

/** Flatten editor group shadow nodes + their sub-graphs into plain nodes/edges + group specs. */
function flattenEditorGroups(pipeline: Pipeline): {
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  groups: Array<{ id: string; name: string; nameEn?: string; position: { x: number; y: number }; memberNodeIds: string[] }>
} {
  const groupsById = new Map((pipeline.groups ?? []).map((g) => [g.id, g] as const))
  const shadowToGroup = new Map<string, NodeGroup>()
  const plainNodes: PipelineNode[] = []
  for (const n of pipeline.nodes) {
    if (n.batteryId === GROUP_BATTERY_ID) {
      const groupId = typeof n.params?.groupId === 'string' ? (n.params.groupId as string) : n.id
      const g = groupsById.get(groupId)
      if (g) {
        shadowToGroup.set(n.id, g)
        continue
      }
    }
    plainNodes.push(n)
  }

  const nodes: PipelineNode[] = [...plainNodes]
  for (const g of shadowToGroup.values()) for (const m of g.nodes) nodes.push(m)

  const exposedIn = new Map<string, Map<string, { nodeId: string; port: string }>>()
  const exposedOut = new Map<string, Map<string, { nodeId: string; port: string }>>()
  for (const [shadowId, g] of shadowToGroup) {
    exposedIn.set(shadowId, new Map(g.exposedInputs.map((p) => [p.portName, { nodeId: p.sourceNodeId, port: p.sourcePortName }])))
    exposedOut.set(shadowId, new Map(g.exposedOutputs.map((p) => [p.portName, { nodeId: p.sourceNodeId, port: p.sourcePortName }])))
  }

  const edges: PipelineEdge[] = []
  for (const e of pipeline.edges) {
    let source = { ...e.source }
    let target = { ...e.target }
    if (shadowToGroup.has(e.source.nodeId)) {
      const inner = exposedOut.get(e.source.nodeId)?.get(e.source.port)
      if (inner) source = { ...inner }
    }
    if (shadowToGroup.has(e.target.nodeId)) {
      const inner = exposedIn.get(e.target.nodeId)?.get(e.target.port)
      if (inner) target = { ...inner }
    }
    edges.push({ id: e.id, source, target })
  }
  for (const g of shadowToGroup.values()) for (const e of g.edges) edges.push({ id: e.id, source: { ...e.source }, target: { ...e.target } })

  const groups = Array.from(shadowToGroup.entries()).map(([shadowId, g]) => ({
    id: shadowId,
    name: g.name,
    nameEn: g.nameEn,
    position: pipeline.nodes.find((n) => n.id === shadowId)?.position ?? g.position,
    memberNodeIds: g.nodes.map((m) => m.id),
  }))

  return { nodes, edges, groups }
}

function uniqueId(base: string, reserved: ReadonlySet<string>): string {
  let i = 2
  let candidate = `${base}-${i}`
  while (reserved.has(candidate)) candidate = `${base}-${++i}`
  return candidate
}

export function legacyPipelineToOps(
  pipeline: Pipeline,
  opts: LegacyPipelineToOpsOptions = {},
): LegacyPipelineToOpsResult {
  const mode = opts.mode ?? 'replace'
  const { nodes, edges, groups } = flattenEditorGroups(pipeline)
  const diagnostics: Array<{ nodeId: string; opId: string; message: string }> = []

  if (opts.validateOps) {
    for (const n of nodes) {
      if (!opts.validateOps(n.batteryId)) {
        diagnostics.push({ nodeId: n.id, opId: n.batteryId, message: `unknown opId '${n.batteryId}'` })
      }
    }
  }
  if (diagnostics.length > 0) return { ops: [], nodeIdMap: {}, diagnostics }

  const curNodes = opts.current?.nodes ?? {}
  const curEdges = opts.current?.edges ?? {}
  const reserved = new Set<string>(mode === 'merge' ? Object.keys(curNodes) : [])
  const autoRemap = opts.remapIds ?? mode === 'merge'
  const idRemap = opts.idRemap ?? {}

  const nodeIdMap: Record<string, string> = {}
  for (const incoming of [...nodes.map((n) => n.id), ...groups.map((g) => g.id)]) {
    if (nodeIdMap[incoming] !== undefined) continue
    let desired = idRemap[incoming] ?? incoming
    if (reserved.has(desired) && autoRemap) desired = uniqueId(desired, reserved)
    reserved.add(desired)
    nodeIdMap[incoming] = desired
  }
  const remapNode = (id: string): string => nodeIdMap[id] ?? id

  const edgeReserved = new Set<string>(mode === 'merge' ? Object.keys(curEdges) : [])
  const remapEdge = (id: string): string => {
    let desired = id
    if (edgeReserved.has(desired)) desired = uniqueId(desired, edgeReserved)
    edgeReserved.add(desired)
    return desired
  }

  const ops: Op[] = []
  if (mode === 'replace') {
    for (const [id, kn] of Object.entries(curNodes)) {
      if (kn.opId === KERNEL_GROUP_OP_ID) continue
      ops.push({ type: 'deleteNode', nodeId: id })
    }
  }
  for (const n of nodes) {
    ops.push({
      type: 'createNode',
      nodeId: remapNode(n.id),
      opId: n.batteryId,
      position: n.position,
      params: { ...n.params },
      ...(n.name !== undefined ? { name: n.name } : {}),
    })
  }
  for (const e of edges) {
    ops.push({
      type: 'connect',
      edgeId: remapEdge(e.id),
      source: { nodeId: remapNode(e.source.nodeId), port: e.source.port },
      target: { nodeId: remapNode(e.target.nodeId), port: e.target.port },
    })
  }
  for (const g of groups) {
    ops.push({
      type: 'createGroup',
      groupId: remapNode(g.id),
      name: g.name,
      nameEn: g.nameEn,
      position: g.position,
      memberNodeIds: g.memberNodeIds.map(remapNode),
    })
  }
  if (mode === 'replace') {
    ops.push({ type: 'setMetadata', key: 'viewport', value: pipeline.viewport })
    if (pipeline.annotations !== undefined) ops.push({ type: 'setMetadata', key: 'annotations', value: pipeline.annotations })
    if (pipeline.frames !== undefined) ops.push({ type: 'setMetadata', key: 'frames', value: pipeline.frames })
  }

  return { ops, nodeIdMap, diagnostics }
}
