// applyBatch: the single atomic mutation entry-point.
//
// Every editor operation — UI drag, AI tool call, CLI command — translates
// into one or more Op records and submits them as a single batch. All-or-
// nothing semantics: validation runs over a copy of the live graph, and
// only on full success does the kernel swap graph.json + append a single
// history.jsonl entry.

import { randomUUID } from 'node:crypto'

import type { GraphFileV1 } from '../layer1/storage/types.js'
import type { OpRegistry } from '../layer1/op-registry.js'
import type { OpAccess } from '../layer1/types/op-spec.js'
import { busFor } from './event-bus.js'
import type { Runtime } from './runtime.js'

/** Op record — discriminated union over edit primitives. */
export type Op =
  | {
      type: 'createNode'
      nodeId: string
      opId: string
      position: { x: number; y: number }
      params: Record<string, unknown>
      /** Optional display name (additive; preserves labels on graph import). */
      name?: string
    }
  | { type: 'updateNode'; nodeId: string; params?: Record<string, unknown>; position?: { x: number; y: number }; name?: string }
  | { type: 'deleteNode'; nodeId: string }
  | {
      type: 'connect'
      edgeId: string
      source: { nodeId: string; port: string }
      target: { nodeId: string; port: string }
    }
  | { type: 'disconnect'; edgeId: string }
  | { type: 'setMetadata'; key: string; value: unknown }
  | {
      // Delete a composite group as a single battery: remove the shadow node,
      // its packed sub-graph entry, and all outer boundary edges. Unlike
      // `ungroup`, this intentionally does not restore inner members.
      type: 'deleteGroup'
      groupId: string
    }
  | {
      // Wraps a set of currently top-level nodes into a single composite
      // group node. The group appears in `graph.nodes` with the special
      // opId `__group__`; its sub-graph (member nodes + internal edges +
      // auto-derived exposed ports) lives in `graph.groups[groupId]`.
      // Edges that crossed the boundary are rewritten to reference the
      // group node id and a synthetic exposed-port name. v0.2.0 supports
      // single-level groups only — members must be plain nodes (not
      // already-grouped or themselves group nodes); nested groups land
      // in a follow-up.
      type: 'createGroup'
      groupId: string
      name: string
      memberNodeIds: readonly string[]
      position: { x: number; y: number }
      nameEn?: string
    }
  | {
      // Mutate an existing group's metadata. Member reshuffling is
      // intentionally out of scope for v0.2.0 — use ungroup + createGroup
      // for now. Provided fields replace; omitted fields preserve.
      type: 'updateGroup'
      groupId: string
      name?: string
      nameEn?: string
      position?: { x: number; y: number }
    }
  | {
      // Restore the group's sub-graph to the outer view. Member nodes
      // and internal edges are re-introduced into graph.nodes /
      // graph.edges; outer edges referencing the group via exposed
      // ports are rewritten back to the inner endpoints. The group
      // shadow node and graph.groups entry are deleted.
      type: 'ungroup'
      groupId: string
    }

export interface ApplyBatchOptions {
  /** Run full validation but do not write. Useful for dry-run / preview. */
  dryRun?: boolean
  /** Optimistic concurrency token. Reject if current graph hash differs. */
  expectedPrevHash?: string
  /** Audit field — who is performing this batch. Default 'unknown'. */
  actor?: string
  /**
   * Optional human-readable annotation persisted on the history entry. Lets
   * AI / CLI callers describe a batch (e.g. "AI: 创建山脉 ×2") so editors can
   * surface a meaningful history label. Additive; omit for plain audit logging.
   */
  label?: string
  /** Override the timestamp used for history.ts. Default new Date().toISOString(). */
  ts?: string
  /** Override the batchId used in history. Default random UUID. */
  batchId?: string
}

export type Diagnostic = { opIndex: number; severity: 'error' | 'warn'; message: string }

export interface ApplyBatchResult {
  status: 'ok' | 'rejected'
  /** New graph hash if status === 'ok'. */
  newHash?: string
  /** Rejection reason if status === 'rejected'. */
  reason?: string
  /** Per-op validation findings (for UI surfacing). */
  diagnostics?: ReadonlyArray<Diagnostic>
  /** History batchId on ok. */
  batchId?: string
}

/**
 * A batch that only repositions things or updates presentation metadata
 * (viewport / frames / annotations) changes nothing the executor or renderer
 * depends on. It is still persisted + recorded in history, but it must NOT
 * announce a `graph:applied` data-change event — otherwise every live client
 * re-pulls the snapshot and rebuilds previews on each node drag (the drag event
 * storm + preview reset). Mirrors the legacy model where moving a node was a
 * plain position save, never a re-exec/re-pull trigger.
 */
function isLayoutOnlyBatch(ops: readonly Op[]): boolean {
  if (ops.length === 0) return false
  return ops.every((op) => {
    switch (op.type) {
      case 'updateNode':
        return op.position !== undefined && op.params === undefined && op.name === undefined
      case 'updateGroup':
        return op.position !== undefined && op.name === undefined && op.nameEn === undefined
      case 'setMetadata':
        return op.key === 'viewport' || op.key === 'frames' || op.key === 'annotations'
      default:
        return false
    }
  })
}

/** Bootstrap an empty graph file — used by the first applyBatch on a fresh project. */
function emptyGraph(pipelineId: string, ts: string): Omit<GraphFileV1, 'hash'> {
  return {
    schemaVersion: 1,
    id: pipelineId,
    createdAt: ts,
    updatedAt: ts,
    nodes: {},
    edges: {},
  }
}

function applyOps(
  graph: GraphFileV1,
  ops: readonly Op[],
  registry?: OpRegistry,
): { ok: true } | { ok: false; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    switch (op.type) {
      case 'createNode': {
        if (graph.nodes[op.nodeId]) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `node ${op.nodeId} already exists` })
          break
        }
        graph.nodes[op.nodeId] = {
          id: op.nodeId,
          opId: op.opId,
          position: op.position,
          params: op.params,
          ...(op.name !== undefined ? { name: op.name } : {}),
        }
        break
      }
      case 'updateNode': {
        const node = graph.nodes[op.nodeId]
        if (!node) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `node ${op.nodeId} does not exist` })
          break
        }
        if (op.params !== undefined) node.params = { ...node.params, ...op.params }
        if (op.position !== undefined) node.position = op.position
        if (op.name !== undefined) node.name = op.name
        break
      }
      case 'deleteNode': {
        if (!graph.nodes[op.nodeId]) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `node ${op.nodeId} does not exist` })
          break
        }
        delete graph.nodes[op.nodeId]
        // Cascade-remove edges that referenced this node.
        for (const [edgeId, edge] of Object.entries(graph.edges)) {
          if (edge.source.nodeId === op.nodeId || edge.target.nodeId === op.nodeId) {
            delete graph.edges[edgeId]
          }
        }
        break
      }
      case 'connect': {
        if (graph.edges[op.edgeId]) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `edge ${op.edgeId} already exists` })
          break
        }
        if (!graph.nodes[op.source.nodeId]) {
          diagnostics.push({
            opIndex: i,
            severity: 'error',
            message: `connect.source.nodeId ${op.source.nodeId} does not exist`,
          })
          break
        }
        if (!graph.nodes[op.target.nodeId]) {
          diagnostics.push({
            opIndex: i,
            severity: 'error',
            message: `connect.target.nodeId ${op.target.nodeId} does not exist`,
          })
          break
        }
        graph.edges[op.edgeId] = { id: op.edgeId, source: op.source, target: op.target }
        break
      }
      case 'disconnect': {
        if (!graph.edges[op.edgeId]) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `edge ${op.edgeId} does not exist` })
          break
        }
        delete graph.edges[op.edgeId]
        break
      }
      case 'setMetadata': {
        graph.metadata = { ...(graph.metadata ?? {}), [op.key]: op.value }
        break
      }
      case 'deleteGroup': {
        const result = applyDeleteGroup(graph, op, i)
        if (result.error) diagnostics.push(result.error)
        break
      }
      case 'createGroup': {
        const result = applyCreateGroup(graph, op, i, registry)
        if (result.error) diagnostics.push(result.error)
        break
      }
      case 'updateGroup': {
        const result = applyUpdateGroup(graph, op, i)
        if (result.error) diagnostics.push(result.error)
        break
      }
      case 'ungroup': {
        const result = applyUngroup(graph, op, i)
        if (result.error) diagnostics.push(result.error)
        break
      }
    }
  }
  if (diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics }
  return { ok: true }
}

/** Sentinel opId used by group "shadow nodes" in graph.nodes. */
export const GROUP_OP_ID = '__group__'

type CreateGroupOp = Extract<Op, { type: 'createGroup' }>
type UpdateGroupOp = Extract<Op, { type: 'updateGroup' }>
type DeleteGroupOp = Extract<Op, { type: 'deleteGroup' }>
type UngroupOp = Extract<Op, { type: 'ungroup' }>

/**
 * Synthetic exposed-port name. The group's outer edge endpoint uses
 * this name, while the inner edge keeps the original port. Format:
 *   in:<sourceNodeId>:<sourcePortName>
 *   out:<sourceNodeId>:<sourcePortName>
 * Stable across batches as long as inner topology is stable.
 */
function exposedPortName(direction: 'in' | 'out', sourceNodeId: string, sourcePortName: string): string {
  return `${direction}:${sourceNodeId}:${sourcePortName}`
}

/**
 * Resolve the real `{ type, access }` of a member node's port from its OpSpec,
 * so the group boundary mirrors the inner tier instead of a hardcoded `any`.
 * Falls back to `{ type: 'any' }` (access undefined) when the registry or the
 * port/op is unknown — e.g. a member whose plugin op isn't registered in this
 * process, or a graph mutated without a registry.
 */
function resolveBoundaryPort(
  registry: OpRegistry | undefined,
  node: GraphFileV1['nodes'][string] | undefined,
  portName: string,
  direction: 'in' | 'out',
): { portType: string; access?: OpAccess } {
  if (!registry || !node) return { portType: 'any' }
  const spec = registry.get(node.opId)
  if (!spec) return { portType: 'any' }
  const ports = direction === 'in' ? spec.inputs : spec.outputs
  const port = ports.find((p) => p.name === portName)
  if (port) {
    return port.access !== undefined ? { portType: port.type, access: port.access } : { portType: port.type }
  }
  // Dynamic ports (e.g. tree_merge's `item_0`) aren't enumerated statically;
  // derive their tier from the dynamic-port template instead.
  const dyn = direction === 'in' ? spec.dynamicInputs : spec.dynamicOutputs
  if (dyn && portName.startsWith(dyn.prefix)) {
    return dyn.access !== undefined ? { portType: dyn.type, access: dyn.access } : { portType: dyn.type }
  }
  return { portType: 'any' }
}

function applyCreateGroup(
  graph: GraphFileV1,
  op: CreateGroupOp,
  opIndex: number,
  registry?: OpRegistry,
): { error?: Diagnostic } {
  if (graph.nodes[op.groupId]) {
    return { error: { opIndex, severity: 'error', message: `node ${op.groupId} already exists` } }
  }
  if (graph.groups?.[op.groupId]) {
    return { error: { opIndex, severity: 'error', message: `group ${op.groupId} already exists` } }
  }
  if (op.memberNodeIds.length === 0) {
    return { error: { opIndex, severity: 'error', message: 'createGroup requires at least one member' } }
  }
  const members = new Set(op.memberNodeIds)
  for (const id of op.memberNodeIds) {
    const node = graph.nodes[id]
    if (!node) {
      return { error: { opIndex, severity: 'error', message: `member ${id} does not exist` } }
    }
    if (node.opId === GROUP_OP_ID) {
      return { error: { opIndex, severity: 'error', message: `member ${id} is itself a group; nested groups land in a follow-up` } }
    }
  }

  // Move members out of graph.nodes. Keep a lookup so boundary-port type/access
  // can still be resolved from the inner OpSpec after deletion.
  const memberById = new Map<string, GraphFileV1['nodes'][string]>()
  const innerNodes = op.memberNodeIds.map((id) => {
    const n = graph.nodes[id]!
    memberById.set(id, n)
    delete graph.nodes[id]
    return n
  })

  // Partition edges by boundary.
  const innerEdges: GraphFileV1['edges'][string][] = []
  const exposedInputs: Array<{
    portName: string
    portType: string
    access?: OpAccess
    sourceNodeId: string
    sourcePortName: string
  }> = []
  const exposedOutputs: typeof exposedInputs = []
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    const sourceIn = members.has(edge.source.nodeId)
    const targetIn = members.has(edge.target.nodeId)
    if (sourceIn && targetIn) {
      // Internal edge — moves into the group.
      innerEdges.push(edge)
      delete graph.edges[edgeId]
    } else if (sourceIn && !targetIn) {
      // Boundary edge: source is inside, target is outside. Group exposes an output.
      const portName = exposedPortName('out', edge.source.nodeId, edge.source.port)
      if (!exposedOutputs.some((p) => p.portName === portName)) {
        const resolved = resolveBoundaryPort(registry, memberById.get(edge.source.nodeId), edge.source.port, 'out')
        exposedOutputs.push({
          portName,
          portType: resolved.portType,
          ...(resolved.access !== undefined ? { access: resolved.access } : {}),
          sourceNodeId: edge.source.nodeId,
          sourcePortName: edge.source.port,
        })
      }
      // Rewrite outer edge to reference the group.
      graph.edges[edgeId] = {
        ...edge,
        source: { nodeId: op.groupId, port: portName },
      }
    } else if (!sourceIn && targetIn) {
      const portName = exposedPortName('in', edge.target.nodeId, edge.target.port)
      if (!exposedInputs.some((p) => p.portName === portName)) {
        const resolved = resolveBoundaryPort(registry, memberById.get(edge.target.nodeId), edge.target.port, 'in')
        exposedInputs.push({
          portName,
          portType: resolved.portType,
          ...(resolved.access !== undefined ? { access: resolved.access } : {}),
          sourceNodeId: edge.target.nodeId,
          sourcePortName: edge.target.port,
        })
      }
      graph.edges[edgeId] = {
        ...edge,
        target: { nodeId: op.groupId, port: portName },
      }
    }
  }

  // Create the group shadow node + sub-graph entry.
  graph.nodes[op.groupId] = {
    id: op.groupId,
    opId: GROUP_OP_ID,
    name: op.name,
    position: op.position,
    params: { groupId: op.groupId },
  }
  if (!graph.groups) graph.groups = {}
  graph.groups[op.groupId] = {
    id: op.groupId,
    name: op.name,
    nameEn: op.nameEn,
    nodes: innerNodes,
    edges: innerEdges,
    position: op.position,
    exposedInputs,
    exposedOutputs,
  }
  return {}
}

function applyUpdateGroup(graph: GraphFileV1, op: UpdateGroupOp, opIndex: number): { error?: Diagnostic } {
  const group = graph.groups?.[op.groupId]
  if (!group) {
    return { error: { opIndex, severity: 'error', message: `group ${op.groupId} does not exist` } }
  }
  const node = graph.nodes[op.groupId]
  if (!node) {
    return { error: { opIndex, severity: 'error', message: `group shadow node ${op.groupId} missing — graph corrupt` } }
  }
  if (op.name !== undefined) {
    group.name = op.name
    node.name = op.name
  }
  if (op.nameEn !== undefined) {
    group.nameEn = op.nameEn
  }
  if (op.position !== undefined) {
    group.position = op.position
    node.position = op.position
  }
  return {}
}

function applyDeleteGroup(graph: GraphFileV1, op: DeleteGroupOp, opIndex: number): { error?: Diagnostic } {
  const group = graph.groups?.[op.groupId]
  const node = graph.nodes[op.groupId]
  if (!group && !node) {
    return { error: { opIndex, severity: 'error', message: `group ${op.groupId} does not exist` } }
  }
  if (node && node.opId !== GROUP_OP_ID) {
    return { error: { opIndex, severity: 'error', message: `node ${op.groupId} is not a group` } }
  }

  delete graph.nodes[op.groupId]
  if (graph.groups) delete graph.groups[op.groupId]
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (edge.source.nodeId === op.groupId || edge.target.nodeId === op.groupId) {
      delete graph.edges[edgeId]
    }
  }
  return {}
}

function applyUngroup(graph: GraphFileV1, op: UngroupOp, opIndex: number): { error?: Diagnostic } {
  const group = graph.groups?.[op.groupId]
  if (!group) {
    return { error: { opIndex, severity: 'error', message: `group ${op.groupId} does not exist` } }
  }
  // Restore inner nodes.
  for (const inner of group.nodes) {
    if (graph.nodes[inner.id]) {
      return { error: { opIndex, severity: 'error', message: `cannot ungroup: node ${inner.id} re-introduced collides with existing top-level node` } }
    }
    graph.nodes[inner.id] = inner
  }
  // Restore inner edges.
  for (const inner of group.edges) {
    if (graph.edges[inner.id]) {
      return { error: { opIndex, severity: 'error', message: `cannot ungroup: edge ${inner.id} collides` } }
    }
    graph.edges[inner.id] = inner
  }
  // Rewrite outer edges that referenced the group via exposed ports.
  const inMap = new Map(group.exposedInputs.map((p) => [p.portName, p] as const))
  const outMap = new Map(group.exposedOutputs.map((p) => [p.portName, p] as const))
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (edge.source.nodeId === op.groupId) {
      const exposed = outMap.get(edge.source.port)
      if (exposed) {
        graph.edges[edgeId] = {
          ...edge,
          source: { nodeId: exposed.sourceNodeId, port: exposed.sourcePortName },
        }
      }
    }
    if (edge.target.nodeId === op.groupId) {
      const exposed = inMap.get(edge.target.port)
      if (exposed) {
        graph.edges[edgeId] = {
          ...edge,
          target: { nodeId: exposed.sourceNodeId, port: exposed.sourcePortName },
        }
      }
    }
  }
  // Delete the group shadow node + entry.
  delete graph.nodes[op.groupId]
  if (graph.groups) delete graph.groups[op.groupId]
  return {}
}

/**
 * Apply a batch of ops atomically to a pipeline. Runs every op against an
 * in-memory copy first; only on full success does the kernel write
 * graph.json and append the history entry.
 */
export async function applyBatch(
  runtime: Runtime,
  ops: readonly Op[],
  opts: ApplyBatchOptions = {},
): Promise<ApplyBatchResult> {
  const ts = opts.ts ?? new Date().toISOString()
  const batchId = opts.batchId ?? randomUUID()
  const actor = opts.actor ?? 'unknown'

  // Load existing graph or bootstrap.
  let current: GraphFileV1
  let prevHash: string
  if (runtime.graph.exists()) {
    const loaded = runtime.graph.load()
    if (!loaded) {
      return { status: 'rejected', reason: 'graph.json exists but failed to load' }
    }
    current = loaded
    prevHash = loaded.hash
  } else {
    const seed = emptyGraph(runtime.config.pipelineId, ts)
    current = { ...(seed as GraphFileV1), hash: 'EMPTY' }
    prevHash = 'EMPTY'
  }

  if (opts.expectedPrevHash !== undefined && opts.expectedPrevHash !== prevHash) {
    return {
      status: 'rejected',
      reason: `concurrent-write: expected prevHash=${opts.expectedPrevHash}, current=${prevHash}`,
    }
  }

  // Deep-clone via JSON round-trip so failed ops do not corrupt the live in-memory graph.
  const next = JSON.parse(JSON.stringify(current)) as GraphFileV1
  next.updatedAt = ts

  const apply = applyOps(next, ops, runtime.registry)
  if (!apply.ok) {
    return {
      status: 'rejected',
      reason: 'op validation failed',
      diagnostics: apply.diagnostics,
    }
  }

  if (opts.dryRun) {
    // No write. Caller gets a hypothetical newHash for preview.
    return {
      status: 'ok',
      diagnostics: [],
      batchId,
    }
  }

  // Persist: GraphStore.save handles canonical-hash + atomic rename.
  const written = runtime.graph.save(
    { ...next, hash: undefined as unknown as string },
    { expectedPrevHash: prevHash === 'EMPTY' ? undefined : prevHash },
  )

  runtime.history.append({
    schemaVersion: 1,
    ts,
    actor,
    batchId,
    prevHash,
    newHash: written.hash,
    ops: ops as ReadonlyArray<Record<string, unknown>>,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
  })

  // Announce the mutation so consumers on the 'graph' channel learn about it —
  // except for layout-only batches (reposition / viewport / frames), which are
  // not data changes and must not drive a re-pull / preview rebuild.
  if (!isLayoutOnlyBatch(ops)) {
    busFor(runtime).emit({
      kind: 'graph:applied',
      pipelineId: runtime.config.pipelineId,
      batchId,
      newHash: written.hash,
    })
  }

  return { status: 'ok', newHash: written.hash, batchId }
}
