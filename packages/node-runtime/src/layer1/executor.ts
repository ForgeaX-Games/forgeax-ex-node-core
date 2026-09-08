// Pipeline executor.
//
// Walks a graph in topological order, calls each op via the dispatcher, and
// caches outputs. Plugin-aware concerns (dynamic op imports, type-specific
// invocation, plugin service ctx construction) are not the kernel's job —
// the plugin attaches its `execute` closure to OpSpec at registerOp() time.
//
// The executor only knows OpSpec, GraphNode, GraphEdge, NodeGroup. It does
// not know Battery, sourcePath, JSON / TS / AI distinctions, or any concrete
// service shape.

import { DataTree, type DataTreeEntry } from './datatree/index.js'
import { executeWithDataTreeDispatch } from './dispatcher.js'
import type { OpRegistry } from './op-registry.js'
import type { ExecutionContext, OpAccess } from './types/op-spec.js'
import type { GraphEdge, GraphNode, NodeGroup } from './types/graph.js'

const RELAY_OP_ID = '__relay__'
const RELAY_INPUT_PORT = 'input'
const RELAY_OUTPUT_PORT = 'output'
const GROUP_OP_ID = '__group__'

/** Per-node execution result returned from the executor. */
export interface NodeExecutionResult {
  nodeId: string
  /** Per-port output bag. Data ports hold DataTreeEntry<unknown>[] (toJSON form). */
  outputs: Record<string, unknown>
  durationMs: number
  error?: string
  /** Dynamic-output op only: actual output port descriptors after execution. */
  dynamicOutputPorts?: Array<{ name: string; type: string; label: string; access?: OpAccess }>
  /** loopUnpack engineBehavior payload (the unpacked batch). */
  loopBatch?: unknown[]
  /** loopUnpack engineBehavior payload (collector id pairing list_unpack with list_collect). */
  loopCollectorId?: string
}

/** Inputs to a single node call: upstream wire values keyed by target port name. */
export type NodeInputValues = Record<string, unknown>

/** Snapshot of cached outputs for one node, keyed by port name. */
export type NodeOutputCache = Record<string, Record<string, unknown>>

/**
 * Execute one node by op id. The plugin pre-registered the OpSpec with its
 * execute closure; the kernel resolves the spec and dispatches.
 */
export async function executeNode(
  registry: OpRegistry,
  node: GraphNode,
  inputValues: NodeInputValues,
  ctx: ExecutionContext,
): Promise<NodeExecutionResult> {
  const start = Date.now()
  const op = registry.get(node.opId)
  if (!op) {
    return {
      nodeId: node.id,
      outputs: {},
      durationMs: 0,
      error: `Op not registered: ${node.opId}`,
    }
  }

  // Split incoming values into wire-borne (dataInputs) and panel/default
  // (controlInputs). dataInputs precedence overrides node.params overrides
  // op input defaults.
  const dataInputs: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(inputValues)) {
    if (val !== undefined) dataInputs[key] = val
  }
  const controlInputs: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(node.params)) {
    if (val !== undefined && !(key in dataInputs)) controlInputs[key] = val
  }
  for (const inp of op.inputs) {
    if (
      controlInputs[inp.name] === undefined &&
      !(inp.name in dataInputs) &&
      inp.default !== undefined
    ) {
      controlInputs[inp.name] = inp.default
    }
  }

  // Engine-derived connection inference (carried on the context, not node.params)
  // is surfaced to adaptive ops via the args bag at execution time only — and
  // never overrides a value the node already locked in params / wired inputs.
  const inference = ctx.connectionInference
  if (inference) {
    if (
      inference.access !== undefined &&
      controlInputs.inferredAccess === undefined &&
      !('inferredAccess' in dataInputs)
    ) {
      controlInputs.inferredAccess = inference.access
    }
    if (
      inference.type !== undefined &&
      controlInputs.inferredType === undefined &&
      !('inferredType' in dataInputs)
    ) {
      controlInputs.inferredType = inference.type
    }
  }

  try {
    const fnWithCtx = (input: Record<string, unknown>): unknown | Promise<unknown> =>
      op.execute(ctx, input)

    const dispatched = await executeWithDataTreeDispatch(
      op,
      dataInputs,
      controlInputs,
      fnWithCtx as (i: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
    )

    // Pull engineBehavior signals out of the dispatched result.
    let loopBatch: unknown[] | undefined
    let loopCollectorId: string | undefined
    if (op.engineBehavior === 'loopUnpack' && Array.isArray(dispatched._loopBatch)) {
      loopBatch = dispatched._loopBatch as unknown[]
      loopCollectorId =
        typeof dispatched._loopCollectorId === 'string' ? dispatched._loopCollectorId : 'default'
      ctx.log('debug', `Loop signal: op=${op.id} collectorId=${loopCollectorId} batch.length=${loopBatch.length}`)
    }

    // Wire payload normalisation: every data port is serialised as
    // DataTreeEntry<unknown>[] (the toJSON form). Non-DataTree returns
    // become an empty entries array.
    const toJsonEntries = (v: unknown): DataTreeEntry<unknown>[] =>
      v instanceof DataTree ? (v.toJSON() as DataTreeEntry<unknown>[]) : []

    const outputs: Record<string, unknown> = {}
    for (const out of op.outputs) {
      const v = dispatched[out.name]
      if (v === undefined) continue
      outputs[out.name] = toJsonEntries(v)
    }

    const fnError = dispatched.error !== undefined ? String(dispatched.error) : undefined

    if (op.dynamicOutputs) {
      if (dispatched.error !== undefined) {
        return {
          nodeId: node.id,
          outputs,
          durationMs: Date.now() - start,
          loopBatch,
          loopCollectorId,
          error: fnError,
        }
      }

      const { prefix, labelTemplate, type, access } = op.dynamicOutputs
      const dynamicOutputPorts: Array<{
        name: string
        type: string
        label: string
        access?: OpAccess
      }> = []

      const dynKeys = Object.keys(dispatched)
        .filter((k) => k.startsWith(prefix))
        .sort((a, b) => {
          const ia = parseInt(a.slice(prefix.length), 10)
          const ib = parseInt(b.slice(prefix.length), 10)
          return ia - ib
        })

      for (const key of dynKeys) {
        const v = dispatched[key]
        if (v === undefined) continue
        const idx = key.slice(prefix.length)
        outputs[key] = toJsonEntries(v)
        dynamicOutputPorts.push({
          name: key,
          type,
          label: labelTemplate.replace('$i', idx),
          access,
        })
      }

      ctx.log(
        'debug',
        `Op (dynamicOutputs) executed: ${op.id} static=${op.outputs.length} dynamic=${dynamicOutputPorts.length} (${Date.now() - start}ms)`,
      )
      return {
        nodeId: node.id,
        outputs,
        dynamicOutputPorts,
        durationMs: Date.now() - start,
        loopBatch,
        loopCollectorId,
        ...(fnError ? { error: fnError } : {}),
      }
    }

    ctx.log('debug', `Op executed: ${op.id} (${Date.now() - start}ms)`)
    return {
      nodeId: node.id,
      outputs,
      durationMs: Date.now() - start,
      loopBatch,
      loopCollectorId,
      ...(fnError ? { error: fnError } : {}),
    }
  } catch (err) {
    ctx.log('error', `Op execution error [${op.id}]: ${err instanceof Error ? err.message : String(err)}`)
    return {
      nodeId: node.id,
      outputs: {},
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Kahn topological sort: returns nodeIds in dependency order so each
 * upstream node executes before its downstream consumers.
 */
export function topologicalSort(nodeIds: readonly string[], edges: readonly GraphEdge[]): string[] {
  const nodeSet = new Set(nodeIds)
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const id of nodeIds) {
    inDegree.set(id, 0)
    adj.set(id, [])
  }

  for (const edge of edges) {
    const src = edge.source.nodeId
    const tgt = edge.target.nodeId
    if (!nodeSet.has(src) || !nodeSet.has(tgt)) continue
    adj.get(src)!.push(tgt)
    inDegree.set(tgt, (inDegree.get(tgt) ?? 0) + 1)
  }

  const queue = [...nodeIds].filter((id) => inDegree.get(id) === 0)
  const sorted: string[] = []

  while (queue.length > 0) {
    const curr = queue.shift()!
    sorted.push(curr)
    for (const next of adj.get(curr) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }

  return sorted
}

/**
 * BFS from a starting node down the graph. Used by partial execution to
 * pick the impacted node subset.
 */
export function getDownstreamNodeIds(
  startId: string,
  allNodeIds: readonly string[],
  edges: readonly GraphEdge[],
): string[] {
  const nodeSet = new Set(allNodeIds)
  const visited = new Set<string>([startId])
  const queue = [startId]

  while (queue.length > 0) {
    const curr = queue.shift()!
    for (const edge of edges) {
      const tgt = edge.target.nodeId
      if (edge.source.nodeId === curr && nodeSet.has(tgt) && !visited.has(tgt)) {
        visited.add(tgt)
        queue.push(tgt)
      }
    }
  }

  return [...visited]
}

/**
 * Execute a NodeGroup's inner sub-graph.
 *
 * Steps:
 *   1. map external inputs (keyed by exposedInputs.portName) onto the
 *      corresponding inner-node ports
 *   2. topo-sort the inner nodes; execute each in order, with internal
 *      edges feeding intermediate values
 *   3. read exposedOutputs from the inner-output cache to produce the
 *      group's external output bag
 *
 * Cycle detection: a group whose id is already in the `visiting` set throws.
 */
export async function executeGroupSubgraph(
  group: NodeGroup,
  externalInputs: NodeInputValues,
  registry: OpRegistry,
  ctx: ExecutionContext,
  options: {
    /** Resolver for nested __group__ inner nodes. Without it, nesting is unsupported. */
    getNestedGroup?: (groupId: string) => NodeGroup | undefined
    /** Cycle detection state. */
    visiting?: ReadonlySet<string>
  } = {},
): Promise<Record<string, unknown>> {
  const { getNestedGroup, visiting = new Set() } = options

  if (visiting.has(group.id)) {
    throw new Error(`Group cycle detected: ${[...visiting, group.id].join(' → ')}`)
  }
  const nextVisiting = new Set(visiting)
  nextVisiting.add(group.id)

  const innerNodeMap = new Map(group.nodes.map((n) => [n.id, n]))
  const innerEdgesByTarget = new Map<string, GraphEdge[]>()
  for (const edge of group.edges) {
    const arr = innerEdgesByTarget.get(edge.target.nodeId) ?? []
    arr.push(edge)
    innerEdgesByTarget.set(edge.target.nodeId, arr)
  }

  // External-input injection map: inner nodeId → { inner port name → value }
  const externalInjections = new Map<string, Record<string, unknown>>()
  for (const ep of group.exposedInputs) {
    const val = externalInputs[ep.portName]
    if (val !== undefined) {
      const existing = externalInjections.get(ep.sourceNodeId) ?? {}
      existing[ep.sourcePortName] = val
      externalInjections.set(ep.sourceNodeId, existing)
    }
  }

  const innerNodeIds = group.nodes.map((n) => n.id)
  const sortedIds = topologicalSort(innerNodeIds, group.edges)
  const innerOutputCache: NodeOutputCache = {}

  for (const innerNodeId of sortedIds) {
    const innerNode = innerNodeMap.get(innerNodeId)
    if (!innerNode) continue

    const innerInputValues: NodeInputValues = {}
    for (const edge of innerEdgesByTarget.get(innerNodeId) ?? []) {
      const upstream = innerOutputCache[edge.source.nodeId]
      if (upstream?.[edge.source.port] !== undefined) {
        innerInputValues[edge.target.port] = upstream[edge.source.port]
      }
    }
    const injections = externalInjections.get(innerNodeId)
    if (injections) Object.assign(innerInputValues, injections)

    // Nested __group__ inner node: recurse.
    if (innerNode.opId === GROUP_OP_ID) {
      const innerGroupId = typeof innerNode.params?.groupId === 'string' ? innerNode.params.groupId : ''
      const innerGroup = getNestedGroup ? getNestedGroup(innerGroupId) : undefined
      if (!innerGroup) {
        ctx.log('warn', `[Group ${group.id}] Nested group not found: ${innerGroupId} (node ${innerNodeId})`)
        innerOutputCache[innerNodeId] = {}
        continue
      }
      try {
        innerOutputCache[innerNodeId] = await executeGroupSubgraph(
          innerGroup,
          innerInputValues,
          registry,
          ctx,
          { getNestedGroup, visiting: nextVisiting },
        )
      } catch (e) {
        // Cycles are structural errors — propagate so callers can surface them.
        if (e instanceof Error && /cycle detected/i.test(e.message)) throw e
        ctx.log('error', `[Group ${group.id}] Nested group ${innerGroupId} failed: ${e}`)
        innerOutputCache[innerNodeId] = {}
      }
      continue
    }

    if (innerNode.opId === RELAY_OP_ID) {
      innerOutputCache[innerNodeId] = {
        [RELAY_OUTPUT_PORT]: innerInputValues[RELAY_INPUT_PORT],
      }
      continue
    }

    const result = await executeNode(registry, innerNode, innerInputValues, ctx)
    if (result.error) {
      ctx.log('error', `[Group ${group.id}] Inner node error [${innerNodeId}]: ${result.error}`)
    }
    innerOutputCache[innerNodeId] = result.outputs
  }

  const groupOutputs: Record<string, unknown> = {}
  for (const ep of group.exposedOutputs) {
    const val = innerOutputCache[ep.sourceNodeId]?.[ep.sourcePortName]
    if (val !== undefined) groupOutputs[ep.portName] = val
  }
  return groupOutputs
}
