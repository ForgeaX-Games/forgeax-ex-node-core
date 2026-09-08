// importPipelineGraph: faithfully load a whole node-connection graph from an
// external source (a saved template file or an inline payload) and apply it as
// a SINGLE atomic batch.
//
// This is the kernel-level port of the legacy editor's "load pipeline from
// file" feature (forgeax-wb-scene pipeline.service.loadFromFile +
// normalizePipeline). Crucially, the replacement does NOT wipe the canvas
// ad-hoc: it produces an ordered Op[] (delete-all → createNode → connect →
// createGroup → setMetadata) and submits it through applyBatch, so the change
//   - is validated all-or-nothing,
//   - persists atomically (graph.json + history.jsonl),
//   - emits a single graph:applied event,
// and therefore flows through the SAME live-sync cascade every other actor
// uses: graph:applied → loadPipeline → pipelineRevision++ → canvas reconcile →
// preview refresh. The History panel shows it via the AI/CLI history bridge.
//
// Two input shapes are accepted:
//   - 'kernel-graph-v1'   — a native PipelineSnapshot-shaped graph (opId).
//   - 'legacy-pipeline-v1'— the legacy Pipeline JSON (batteryId + viewport +
//                           annotations + groups), as written by the old
//                           savePipelineAs route.
// A batteryId→opId map (opIdMap) bridges the naming divergence; every opId is
// validated against the live op registry before anything is applied (an
// unknown op yields a diagnostic, never a crash). Node-id collisions can be
// resolved with an explicit idRemap or auto-remapped in merge mode.

import type { GraphEdge, GraphNode, NodeGroup } from '../layer1/types/graph.js'
import { GROUP_OP_ID, applyBatch, type Diagnostic, type Op } from './apply-batch.js'
import { getPipeline, listGroups } from './queries.js'
import type { Runtime } from './runtime.js'

export type ImportGraphFormat = 'kernel-graph-v1' | 'legacy-pipeline-v1'

/** Native graph shape (matches a PipelineSnapshot; nodes/edges as record or array). */
export interface KernelGraphV1 {
  id?: string
  nodes: Record<string, GraphNode> | readonly GraphNode[]
  edges: Record<string, GraphEdge> | readonly GraphEdge[]
  groups?: Record<string, NodeGroup> | readonly NodeGroup[]
  metadata?: Record<string, unknown>
}

/** A node in the legacy Pipeline JSON (`batteryId` is the kernel `opId`). */
export interface LegacyPipelineNode {
  id: string
  batteryId: string
  name?: string
  position?: { x: number; y: number }
  params?: Record<string, unknown>
  /**
   * Accepted in legacy payloads for back-compat but intentionally NOT imported:
   * `previewEnabled` is a client-only editor toggle and is never persisted to
   * the kernel graph (see GraphNode — it has no such field).
   */
  previewEnabled?: boolean
}

export interface LegacyPipelineEdge {
  id: string
  source: { nodeId: string; port: string }
  target: { nodeId: string; port: string }
}

/** An exposed group port in the legacy editor NodeGroup shape. */
export interface LegacyExposedPort {
  portName: string
  portType?: string
  sourceNodeId: string
  sourcePortName: string
}

/** A composite group sub-graph in the legacy editor shape. */
export interface LegacyNodeGroup {
  id: string
  name?: string
  nameEn?: string
  nodes: LegacyPipelineNode[]
  edges: LegacyPipelineEdge[]
  position?: { x: number; y: number }
  exposedInputs?: LegacyExposedPort[]
  exposedOutputs?: LegacyExposedPort[]
}

/** The legacy Pipeline JSON written by the old savePipelineAs route. */
export interface LegacyPipelineV1 {
  id?: string
  name?: string
  description?: string
  nodes: LegacyPipelineNode[]
  edges: LegacyPipelineEdge[]
  viewport?: { x: number; y: number; zoom: number }
  groups?: LegacyNodeGroup[]
  annotations?: unknown[]
  frames?: unknown[]
}

export type ImportGraphInput =
  | { format: 'kernel-graph-v1'; graph: KernelGraphV1 }
  | { format: 'legacy-pipeline-v1'; graph: LegacyPipelineV1 }

export interface ImportGraphOptions {
  /** 'replace' (default): delete the live graph first. 'merge': additive. */
  mode?: 'replace' | 'merge'
  /** Explicit incoming-node-id → new-id remap, applied before collision handling. */
  idRemap?: Record<string, string>
  /** In merge mode, auto-remap incoming ids that collide with the live graph. Default true. */
  remapNodeIds?: boolean
  /** Legacy `batteryId` → kernel `opId` map; identity when a key is absent. */
  opIdMap?: Record<string, string>
  /** History actor. Default 'import'. */
  actor?: string
  /** Human-readable history label (surfaced in the editor History panel). */
  label?: string
  /** Override the batch id (tests). */
  batchId?: string
}

export interface ImportGraphResult {
  status: 'ok' | 'rejected'
  batchId?: string
  newHash?: string
  /** Incoming node id → final (possibly remapped) node id. */
  nodeIdMap?: Record<string, string>
  diagnostics?: Diagnostic[]
  reason?: string
}

/** Post-import execution policy (app-level; surfaced here so all layers share it). */
export type ImportExecuteAfter = 'none' | 'downstream' | 'full'

/** Options for the app import route — the graph options plus a post-import execute policy. */
export interface ImportPipelineExecuteOptions extends ImportGraphOptions {
  executeAfter?: ImportExecuteAfter
}

/** A listable graph template discovered under the app's templates directory. */
export interface ImportTemplate {
  /** File name relative to its source dir (the import route key). */
  path: string
  /** Human-readable name (from the file's `name`, else the file stem). */
  name: string
  /** Source bucket (e.g. 'templates'); apps may scan more than one dir. */
  source?: string
  /** Detected input format. */
  format?: ImportGraphFormat
}

/** Response of the app import route (the graph result plus whether it executed). */
export interface ImportPipelineResponse extends ImportGraphResult {
  executed?: boolean
}

// ── Internal normalized model ──────────────────────────────────────────────

interface NormNode {
  id: string
  opId: string
  name?: string
  position: { x: number; y: number }
  params: Record<string, unknown>
}
interface NormEdge {
  id: string
  source: { nodeId: string; port: string }
  target: { nodeId: string; port: string }
}
interface NormGroup {
  id: string
  name: string
  nameEn?: string
  position: { x: number; y: number }
  memberNodeIds: string[]
}
interface NormMetadata {
  viewport?: unknown
  annotations?: unknown
  frames?: unknown
}
interface NormalizedGraph {
  nodes: NormNode[]
  edges: NormEdge[]
  groups: NormGroup[]
  metadata: NormMetadata
}

function toArray<T>(v: Record<string, T> | readonly T[] | undefined): T[] {
  if (!v) return []
  return Array.isArray(v) ? [...(v as readonly T[])] : Object.values(v as Record<string, T>)
}

/**
 * Reverse the apply-batch group encoding so a packed sub-graph can be replayed
 * as plain nodes + their original edges + a `createGroup`. Boundary edges that
 * reference the group shadow node via a synthetic exposed-port name are
 * rewritten back to the inner (node, port) endpoint they came from.
 */
function flattenGroups(
  topNodes: GraphNode[],
  topEdges: GraphEdge[],
  groups: NodeGroup[],
): { nodes: NormNode[]; edges: NormEdge[]; groups: NormGroup[] } {
  const shadowIds = new Set(groups.map((g) => g.id))
  // shadow group id → exposed-port maps (portName → inner endpoint).
  const exposedIn = new Map<string, Map<string, { nodeId: string; port: string }>>()
  const exposedOut = new Map<string, Map<string, { nodeId: string; port: string }>>()
  for (const g of groups) {
    exposedIn.set(
      g.id,
      new Map(g.exposedInputs.map((p) => [p.portName, { nodeId: p.sourceNodeId, port: p.sourcePortName }])),
    )
    exposedOut.set(
      g.id,
      new Map(g.exposedOutputs.map((p) => [p.portName, { nodeId: p.sourceNodeId, port: p.sourcePortName }])),
    )
  }

  const nodes: NormNode[] = []
  for (const n of topNodes) {
    if (n.opId === GROUP_OP_ID) continue // shadow node — recreated by createGroup
    nodes.push(toNormNode(n))
  }
  for (const g of groups) for (const n of g.nodes) nodes.push(toNormNode(n))

  const edges: NormEdge[] = []
  for (const e of topEdges) {
    let source = { ...e.source }
    let target = { ...e.target }
    if (shadowIds.has(e.source.nodeId)) {
      const inner = exposedOut.get(e.source.nodeId)?.get(e.source.port)
      if (inner) source = { ...inner }
    }
    if (shadowIds.has(e.target.nodeId)) {
      const inner = exposedIn.get(e.target.nodeId)?.get(e.target.port)
      if (inner) target = { ...inner }
    }
    edges.push({ id: e.id, source, target })
  }
  for (const g of groups) for (const e of g.edges) edges.push({ id: e.id, source: { ...e.source }, target: { ...e.target } })

  const normGroups: NormGroup[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    nameEn: g.nameEn,
    position: g.position ?? { x: 0, y: 0 },
    memberNodeIds: g.nodes.map((n) => n.id),
  }))

  return { nodes, edges, groups: normGroups }
}

function toNormNode(n: GraphNode): NormNode {
  return {
    id: n.id,
    opId: n.opId,
    name: n.name,
    position: n.position ?? { x: 0, y: 0 },
    params: { ...(n.params ?? {}) },
  }
}

function normalizeKernelGraph(graph: KernelGraphV1): NormalizedGraph {
  const topNodes = toArray<GraphNode>(graph.nodes)
  const topEdges = toArray<GraphEdge>(graph.edges)
  const groups = toArray<NodeGroup>(graph.groups)
  const { nodes, edges, groups: normGroups } = flattenGroups(topNodes, topEdges, groups)
  return { nodes, edges, groups: normGroups, metadata: readMetadata(graph.metadata) }
}

function normalizeLegacyPipeline(pipeline: LegacyPipelineV1, opIdMap: Record<string, string>): NormalizedGraph {
  const mapOp = (batteryId: string): string => opIdMap[batteryId] ?? batteryId
  // Project legacy nodes/edges/groups onto the kernel shape, then reuse the
  // same flatten routine. A legacy canvas group is a __group__ shadow node
  // (its params.groupId points at a NodeGroup); we key the recreated group on
  // the shadow node id so top-level edge references stay valid.
  const legacyGroups = pipeline.groups ?? []
  const groupById = new Map(legacyGroups.map((g) => [g.id, g] as const))

  const topNodes: GraphNode[] = []
  const matchedGroups: NodeGroup[] = []
  for (const n of pipeline.nodes) {
    if (n.batteryId === GROUP_OP_ID) {
      const groupId = typeof n.params?.groupId === 'string' ? (n.params.groupId as string) : n.id
      const g = groupById.get(groupId)
      if (g) {
        matchedGroups.push({
          id: n.id, // key the kernel group on the shadow node id
          name: g.name ?? n.name ?? n.id,
          nameEn: g.nameEn,
          nodes: g.nodes.map((m) => legacyToGraphNode(m, mapOp)),
          edges: g.edges.map(legacyToGraphEdge),
          position: n.position ?? g.position ?? { x: 0, y: 0 },
          exposedInputs: (g.exposedInputs ?? []).map((p) => ({
            portName: p.portName,
            portType: p.portType ?? 'any',
            sourceNodeId: p.sourceNodeId,
            sourcePortName: p.sourcePortName,
          })),
          exposedOutputs: (g.exposedOutputs ?? []).map((p) => ({
            portName: p.portName,
            portType: p.portType ?? 'any',
            sourceNodeId: p.sourceNodeId,
            sourcePortName: p.sourcePortName,
          })),
        })
        // shadow node represented via the group; still add it so flatten skips it.
        topNodes.push({ id: n.id, opId: GROUP_OP_ID, name: n.name, position: n.position ?? { x: 0, y: 0 }, params: {} })
        continue
      }
    }
    topNodes.push(legacyToGraphNode(n, mapOp))
  }
  const topEdges: GraphEdge[] = pipeline.edges.map(legacyToGraphEdge)
  const { nodes, edges, groups } = flattenGroups(topNodes, topEdges, matchedGroups)
  return {
    nodes,
    edges,
    groups,
    metadata: {
      ...(pipeline.viewport !== undefined ? { viewport: pipeline.viewport } : {}),
      ...(pipeline.annotations !== undefined ? { annotations: pipeline.annotations } : {}),
      ...(pipeline.frames !== undefined ? { frames: pipeline.frames } : {}),
    },
  }
}

function legacyToGraphNode(n: LegacyPipelineNode, mapOp: (b: string) => string): GraphNode {
  return {
    id: n.id,
    opId: mapOp(n.batteryId),
    name: n.name,
    position: n.position ?? { x: 0, y: 0 },
    params: { ...(n.params ?? {}) },
  }
}

function legacyToGraphEdge(e: LegacyPipelineEdge): GraphEdge {
  return { id: e.id, source: { ...e.source }, target: { ...e.target } }
}

function readMetadata(metadata: Record<string, unknown> | undefined): NormMetadata {
  if (!metadata) return {}
  return {
    ...(metadata.viewport !== undefined ? { viewport: metadata.viewport } : {}),
    ...(metadata.annotations !== undefined ? { annotations: metadata.annotations } : {}),
    ...(metadata.frames !== undefined ? { frames: metadata.frames } : {}),
  }
}

// ── Import ──────────────────────────────────────────────────────────────────

/**
 * Import a whole graph and apply it atomically. See file header for the live-
 * sync guarantee. Returns the committed batch id + new hash on success, or a
 * diagnostics list (and no mutation) when validation fails.
 */
export async function importPipelineGraph(
  runtime: Runtime,
  input: ImportGraphInput,
  options: ImportGraphOptions = {},
): Promise<ImportGraphResult> {
  const mode = options.mode ?? 'replace'
  const opIdMap = options.opIdMap ?? {}

  const norm =
    input.format === 'legacy-pipeline-v1'
      ? normalizeLegacyPipeline(input.graph, opIdMap)
      : normalizeKernelGraph(input.graph)

  // 1) Validate every opId against the live registry (group sentinel exempt).
  const diagnostics: Diagnostic[] = []
  norm.nodes.forEach((n, i) => {
    if (n.opId === GROUP_OP_ID) return
    if (!runtime.registry.has(n.opId)) {
      diagnostics.push({ opIndex: i, severity: 'error', message: `unknown opId '${n.opId}' for node '${n.id}'` })
    }
  })
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { status: 'rejected', reason: 'unknown opId(s) — not present in the op registry', diagnostics }
  }

  // 2) Resolve node-id remapping (explicit idRemap, then merge-collision auto-remap).
  const snapshot = getPipeline(runtime)
  const existingGroups = listGroups(runtime)
  const existingTopIds = snapshot ? Object.keys(snapshot.nodes) : []
  const existingInnerIds = existingGroups.flatMap((g) => g.nodes.map((n) => n.id))
  const existingEdgeIds = new Set(snapshot ? Object.keys(snapshot.edges) : [])
  for (const g of existingGroups) for (const e of g.edges) existingEdgeIds.add(e.id)

  // In replace mode every existing node is deleted first, so collisions with
  // the live graph cannot occur; in merge mode they can.
  const reserved = new Set<string>(mode === 'merge' ? [...existingTopIds, ...existingInnerIds] : [])
  const idRemap = options.idRemap ?? {}
  const autoRemap = options.remapNodeIds ?? mode === 'merge'

  const nodeIdMap: Record<string, string> = {}
  const allIncomingNodeIds = [...norm.nodes.map((n) => n.id), ...norm.groups.map((g) => g.id)]
  for (const incoming of allIncomingNodeIds) {
    if (nodeIdMap[incoming] !== undefined) continue
    let desired = idRemap[incoming] ?? incoming
    if (reserved.has(desired)) {
      if (!autoRemap) {
        return {
          status: 'rejected',
          reason: `node id collision: '${desired}' already exists (pass remapNodeIds or an idRemap)`,
        }
      }
      desired = uniqueId(desired, reserved)
    }
    reserved.add(desired)
    nodeIdMap[incoming] = desired
  }

  const edgeIdReserved = new Set<string>(mode === 'merge' ? existingEdgeIds : [])
  const remapNode = (id: string): string => nodeIdMap[id] ?? id
  const remapEdgeId = (id: string): string => {
    let desired = id
    if (edgeIdReserved.has(desired)) desired = uniqueId(desired, edgeIdReserved)
    edgeIdReserved.add(desired)
    return desired
  }

  // 3) Build the ordered Op[]: (replace) ungroup + delete-all → createNode →
  //    connect → createGroup → setMetadata.
  const ops: Op[] = []

  if (mode === 'replace') {
    for (const g of existingGroups) ops.push({ type: 'ungroup', groupId: g.id })
    const toDelete = new Set<string>()
    for (const id of existingTopIds) {
      // group shadow nodes are removed by ungroup above — don't double-delete.
      if (snapshot && snapshot.nodes[id]?.opId === GROUP_OP_ID) continue
      toDelete.add(id)
    }
    for (const id of existingInnerIds) toDelete.add(id)
    for (const id of toDelete) ops.push({ type: 'deleteNode', nodeId: id })
  }

  for (const n of norm.nodes) {
    ops.push({
      type: 'createNode',
      nodeId: remapNode(n.id),
      opId: n.opId,
      position: n.position,
      params: { ...n.params },
      ...(n.name !== undefined ? { name: n.name } : {}),
    })
  }

  for (const e of norm.edges) {
    ops.push({
      type: 'connect',
      edgeId: remapEdgeId(e.id),
      source: { nodeId: remapNode(e.source.nodeId), port: e.source.port },
      target: { nodeId: remapNode(e.target.nodeId), port: e.target.port },
    })
  }

  for (const g of norm.groups) {
    ops.push({
      type: 'createGroup',
      groupId: remapNode(g.id),
      name: g.name,
      nameEn: g.nameEn,
      position: g.position,
      memberNodeIds: g.memberNodeIds.map(remapNode),
    })
  }

  // Metadata round-trip (viewport / annotations / frames). Replace mode swaps
  // the editor layout wholesale; merge keeps the live layout untouched.
  if (mode === 'replace') {
    if (norm.metadata.viewport !== undefined) ops.push({ type: 'setMetadata', key: 'viewport', value: norm.metadata.viewport })
    if (norm.metadata.annotations !== undefined) ops.push({ type: 'setMetadata', key: 'annotations', value: norm.metadata.annotations })
    if (norm.metadata.frames !== undefined) ops.push({ type: 'setMetadata', key: 'frames', value: norm.metadata.frames })
  }

  if (ops.length === 0) {
    return { status: 'ok', newHash: snapshot?.hash, nodeIdMap }
  }

  const result = await applyBatch(runtime, ops, {
    actor: options.actor ?? 'import',
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(options.batchId !== undefined ? { batchId: options.batchId } : {}),
  })

  if (result.status !== 'ok') {
    return {
      status: 'rejected',
      reason: result.reason ?? 'applyBatch rejected the import',
      diagnostics: result.diagnostics ? [...result.diagnostics] : undefined,
    }
  }
  return { status: 'ok', batchId: result.batchId, newHash: result.newHash, nodeIdMap }
}

function uniqueId(base: string, reserved: ReadonlySet<string>): string {
  let i = 2
  let candidate = `${base}-${i}`
  while (reserved.has(candidate)) {
    i += 1
    candidate = `${base}-${i}`
  }
  return candidate
}
