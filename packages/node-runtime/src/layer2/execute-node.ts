// Layer 2 execution API. Runs a graph — a target node's DOWNSTREAM closure
// (the node plus every node it feeds, with boundary upstream inputs hydrated
// from the persisted output cache), or the whole pipeline — and streams
// progress over the runtime's event bus.
//
// Hybrid lifecycle: executeNode validates synchronously, emits exec:started,
// resolves a handle, then walks the closure in the background. The returned
// promise does NOT wait for the run to finish; await handle.done for that.

import { randomUUID } from 'node:crypto'

import { executeNode as executeNodeL1, executeGroupSubgraph } from '../layer1/index.js'
import type { ExecutionContext, GraphEdge, GraphNode, OpAccess, OpRegistry } from '../layer1/index.js'
import { busFor, type EventBus } from './event-bus.js'
import { GROUP_OP_ID } from './apply-batch.js'
import { buildExecutionClosure, resolveNodeInputs, type ExecutionClosure } from './resolve-inputs.js'
import type { Runtime } from './runtime.js'

// Mirrors the relay sentinel in layer1/executor.ts (a wire pass-through node).
const RELAY_OP_ID = '__relay__'

export interface ExecuteNodeRequest {
  /** Run this node's upstream closure. Omit to run the whole pipeline. */
  nodeId?: string
}

export interface ExecutionResult {
  executionId: string
  status: 'completed' | 'error' | 'aborted'
  /** nodeId -> portId -> wire value (DataTreeEntry[] form). */
  outputs: Record<string, Record<string, unknown>>
  error?: { nodeId?: string; message: string }
  durationMs: number
}

export interface ExecutionHandle {
  executionId: string
  abort(): void
  done: Promise<ExecutionResult>
}

type LoadedGraph = NonNullable<ReturnType<Runtime['graph']['load']>>

function portTypeOf(registry: OpRegistry, opId: string, portId: string): string {
  return registry.get(opId)?.outputs.find((o) => o.name === portId)?.type ?? 'any'
}

/**
 * Derive the connection inference for an adaptive dynamic-input node: the access
 * (and type) of the first dynamic input's upstream source port. Returned for the
 * execution context — NOT written into node.params — so it can never collide with
 * a user-defined param of the same name. The engine (layer1 executor) surfaces it
 * to the op's args bag only when the node has not already locked the values.
 */
function resolveConnectionInference(
  registry: OpRegistry,
  node: GraphNode,
  nodesById: ReadonlyMap<string, GraphNode>,
  edges: readonly GraphEdge[],
): { access: OpAccess; type?: string } | undefined {
  // A persisted params lock (written by the frontend on first connect) wins;
  // skip inference entirely so we don't shadow it.
  if (node.params.inferredAccess !== undefined) return undefined

  const targetOp = registry.get(node.opId)
  const dyn = targetOp?.dynamicInputs
  if (!dyn) return undefined

  const firstDynamicPort = `${dyn.prefix}0`
  const firstEdge = edges.find((edge) => edge.target.nodeId === node.id && edge.target.port === firstDynamicPort)
  if (!firstEdge) return undefined

  const sourceNode = nodesById.get(firstEdge.source.nodeId)
  const sourceOp = sourceNode ? registry.get(sourceNode.opId) : undefined
  const sourcePort = sourceOp?.outputs.find((output) => output.name === firstEdge.source.port)
  if (!sourcePort) return undefined

  return {
    access: sourcePort.access ?? 'item',
    ...(sourcePort.type !== undefined ? { type: sourcePort.type } : {}),
  }
}

async function runWalk(
  runtime: Runtime,
  bus: EventBus,
  graphFile: LoadedGraph,
  closure: ExecutionClosure,
  executionId: string,
  signal: AbortSignal,
): Promise<ExecutionResult> {
  const startedAt = Date.now()
  const pipelineId = runtime.config.pipelineId
  const produced = new Map<string, Record<string, unknown>>()
  const baseCtx: ExecutionContext = { pipelineId, log: () => {}, signal }
  // Generic seam: a host may enrich the context (e.g. inject `services`) via
  // RuntimeConfig.createExecutionContext. Default = base context unchanged.
  const ctx: ExecutionContext = runtime.config.createExecutionContext
    ? runtime.config.createExecutionContext(baseCtx)
    : baseCtx
  const executedHash = graphFile.hash
  // Full node map (every graph node, not just this run's closure) so connection
  // inference can resolve a boundary upstream source port that a partial
  // (downstream) closure does not include in `nodesById`.
  const allNodesById = new Map<string, GraphNode>(Object.entries(graphFile.nodes))

  const finalize = (
    status: ExecutionResult['status'],
    error?: ExecutionResult['error'],
  ): ExecutionResult => ({
    executionId,
    status,
    outputs: Object.fromEntries(produced),
    ...(error ? { error } : {}),
    durationMs: Date.now() - startedAt,
  })

  try {
    for (const nodeId of closure.sorted) {
      if (signal.aborted) {
        bus.emit({ kind: 'exec:error', pipelineId, executionId, message: 'aborted' })
        return finalize('aborted')
      }

      const node = closure.nodesById.get(nodeId)!
      // Boundary upstream (nodes outside this partial closure) feed in from the
      // persisted output cache — the legacy "上游数据由后端 outputCache 补全".
      const inputs = resolveNodeInputs(node, closure.edges, produced, (srcId, port) =>
        produced.has(srcId) ? undefined : runtime.outputs.read(srcId, port)?.data,
      )

      // Diagnostic: a partial (downstream) run hydrates boundary upstream inputs
      // from the output cache. If a boundary source has never executed there is
      // no cache entry, so the input silently resolves to empty — surface a
      // non-fatal warn so the operator knows to run the upstream / full pipeline.
      for (const edge of closure.edges) {
        if (edge.target.nodeId !== nodeId) continue
        const srcId = edge.source.nodeId
        if (closure.nodesById.has(srcId)) continue // in-closure: produced this run
        if (runtime.outputs.read(srcId, edge.source.port)?.data !== undefined) continue
        bus.emit({
          kind: 'exec:warn',
          pipelineId,
          executionId,
          nodeId,
          message:
            `input "${edge.target.port}" has no upstream value: boundary node ` +
            `"${srcId}" (port "${edge.source.port}") has no cached output — ` +
            `run it or the full pipeline first`,
        })
      }

      let outputs: Record<string, unknown>
      if (node.opId === RELAY_OP_ID) {
        outputs = { output: inputs.input }
      } else if (node.opId === GROUP_OP_ID) {
        // Top-level shadow nodes built by applyBatch use id === groupId, so node.id
        // is the operative key. The params.groupId lookup mirrors the convention the
        // executor uses for nested inner group nodes (layer1/executor.ts) and guards
        // hand-built graphs that set it explicitly.
        const groupId = typeof node.params.groupId === 'string' ? node.params.groupId : node.id
        const group = graphFile.groups?.[groupId]
        if (!group) {
          const message = `executeNode: group sub-graph not found: ${groupId}`
          bus.emit({ kind: 'exec:error', pipelineId, executionId, nodeId, message })
          return finalize('error', { nodeId, message })
        }
        // Nested groups are not yet supported at Layer 2; getNestedGroup is omitted
        // intentionally (single-level groups only, per kernel v0.2.0).
        outputs = await executeGroupSubgraph(group, inputs, runtime.registry, ctx)
      } else {
        const inference = resolveConnectionInference(runtime.registry, node, allNodesById, closure.edges)
        const nodeCtx: ExecutionContext = inference ? { ...ctx, connectionInference: inference } : ctx
        const result = await executeNodeL1(runtime.registry, node, inputs, nodeCtx)
        if (result.error) {
          bus.emit({ kind: 'exec:error', pipelineId, executionId, nodeId, message: result.error })
          return finalize('error', { nodeId, message: result.error })
        }
        outputs = result.outputs
      }

      produced.set(nodeId, outputs)
      for (const [portId, value] of Object.entries(outputs)) {
        if (value === undefined) continue
        const outputType = portTypeOf(runtime.registry, node.opId, portId)
        runtime.outputs.write(nodeId, portId, {
          valid: true,
          executedAt: new Date().toISOString(),
          executedHash,
          type: outputType,
          data: value,
        })
        bus.emit({ kind: 'exec:node:output', pipelineId, nodeId, portId, outputType })
      }
    }

    bus.emit({ kind: 'exec:completed', pipelineId, executionId })
    return finalize('completed')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    bus.emit({ kind: 'exec:error', pipelineId, executionId, message })
    return finalize('error', { message })
  }
}

export async function executeNode(
  runtime: Runtime,
  request: ExecuteNodeRequest = {},
): Promise<ExecutionHandle> {
  const bus = busFor(runtime)
  const graphFile = runtime.graph.load()
  if (!graphFile) throw new Error('executeNode: no graph.json to execute')

  // Validate synchronously — a throw here rejects the returned promise before
  // any executionId is minted or any event is emitted.
  const closure = buildExecutionClosure(graphFile.nodes, graphFile.edges, request.nodeId)

  const executionId = randomUUID()
  const controller = new AbortController()
  bus.emit({ kind: 'exec:started', pipelineId: runtime.config.pipelineId, executionId })

  const done = runWalk(runtime, bus, graphFile, closure, executionId, controller.signal)
  return { executionId, abort: () => controller.abort(), done }
}
