// Read-only queries over the editing API.
//
// Every query reads from layer1 storage; nothing here mutates state. UI /
// AI / CLI consumers should prefer these to direct GraphStore.load() so
// that the kernel can later swap in caching, projection, or auth without
// touching call-sites.

import type { GraphEdge, GraphNode, NodeGroup } from '../layer1/types/graph.js'
import type { OpSpec } from '../layer1/types/op-spec.js'
import type { HistoryEntryV1 } from '../layer1/storage/types.js'
import type { Runtime } from './runtime.js'

export interface NodeFilter {
  /** Match by op id. */
  opId?: string
  /** Match by explicit node id list. */
  ids?: readonly string[]
}

export interface HistoryQuery {
  sinceBatchId?: string
  limit?: number
}

export interface PipelineSnapshot {
  id: string
  hash: string
  createdAt: string
  updatedAt: string
  nodes: Record<string, GraphNode>
  edges: Record<string, GraphEdge>
  metadata?: Record<string, unknown>
}

export function getPipeline(runtime: Runtime): PipelineSnapshot | null {
  const g = runtime.graph.load()
  if (!g) return null
  return {
    id: g.id,
    hash: g.hash,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    nodes: g.nodes,
    edges: g.edges,
    metadata: g.metadata,
  }
}

export function getNode(runtime: Runtime, nodeId: string): GraphNode | null {
  const g = runtime.graph.load()
  return g?.nodes[nodeId] ?? null
}

export function listNodes(runtime: Runtime, filter?: NodeFilter): readonly GraphNode[] {
  const g = runtime.graph.load()
  if (!g) return []
  const all = Object.values(g.nodes)
  if (!filter) return all
  return all.filter((n) => {
    if (filter.opId !== undefined && n.opId !== filter.opId) return false
    if (filter.ids !== undefined && !filter.ids.includes(n.id)) return false
    return true
  })
}

export function listEdges(runtime: Runtime): readonly GraphEdge[] {
  const g = runtime.graph.load()
  if (!g) return []
  return Object.values(g.edges)
}

export function getNodeOutput(runtime: Runtime, nodeId: string, portId: string): unknown {
  const cached = runtime.outputs.read(nodeId, portId)
  return cached?.data
}

export function getHistory(runtime: Runtime, opts: HistoryQuery = {}): readonly HistoryEntryV1[] {
  const all = runtime.history.readAll()
  let start = 0
  if (opts.sinceBatchId !== undefined) {
    const idx = all.findIndex((e) => e.batchId === opts.sinceBatchId)
    if (idx >= 0) start = idx + 1
  }
  const slice = all.slice(start)
  return opts.limit !== undefined ? slice.slice(0, opts.limit) : slice
}

/**
 * Read a single group's sub-graph (member nodes, internal edges,
 * exposed input/output ports, name, position). Returns null if the
 * group does not exist or no graph is loaded.
 */
export function getGroup(runtime: Runtime, groupId: string): NodeGroup | null {
  const g = runtime.graph.load()
  if (!g?.groups) return null
  return g.groups[groupId] ?? null
}

/**
 * List every group at the top level. v0.2.0 ships single-level groups
 * only; nested groups (NodeGroup._nestedGroups) are not yet returned.
 */
export function listGroups(runtime: Runtime): readonly NodeGroup[] {
  const g = runtime.graph.load()
  if (!g?.groups) return []
  return Object.values(g.groups)
}

/**
 * Serialisable projection of an OpSpec: every field the editor / CLI needs,
 * minus the `execute` closure (and other engine-only fields). Derived from
 * OpSpec via Pick so the shape can never drift from the source of truth.
 */
export type OpSummary = Pick<
  OpSpec,
  | 'id'
  | 'name'
  | 'nameEn'
  | 'description'
  | 'descriptionEn'
  | 'inputs'
  | 'outputs'
  | 'params'
  | 'dynamicInputs'
  | 'dynamicOutputs'
  | 'lacing'
  | 'principal'
>

/**
 * Stable read-only projection of every op currently registered. Useful
 * for UI palettes and CLI auto-completion. Returns the OpSpec without the
 * execute closure to keep the result safely serialisable.
 */
export function listOps(runtime: Runtime): ReadonlyArray<OpSummary> {
  return runtime.registry
    .list()
    .map((spec) => ({
      id: spec.id,
      name: spec.name,
      nameEn: spec.nameEn,
      description: spec.description,
      descriptionEn: spec.descriptionEn,
      inputs: spec.inputs.map((i) => ({ ...i })),
      outputs: spec.outputs.map((o) => ({ ...o })),
      params: spec.params.map((p) => ({ ...p })),
      dynamicInputs: spec.dynamicInputs ? { ...spec.dynamicInputs } : undefined,
      dynamicOutputs: spec.dynamicOutputs ? { ...spec.dynamicOutputs } : undefined,
      lacing: spec.lacing,
      principal: spec.principal,
    }))
}
