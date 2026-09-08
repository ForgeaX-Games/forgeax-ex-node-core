// Pure graph helpers for execution: which nodes to run, in what order, and
// how to feed each node's inputs from already-produced upstream outputs.

import { topologicalSort } from '../layer1/index.js'
import type { GraphEdge, GraphNode } from '../layer1/index.js'

/** Accumulated per-node output bags, keyed first by node id, then by output port name. */
export type ProducedOutputs = ReadonlyMap<string, Record<string, unknown>>

/** Read a cached upstream port value for nodes outside the execution closure. */
export type CachedInputReader = (nodeId: string, port: string) => unknown

export function resolveNodeInputs(
  node: GraphNode,
  edges: readonly GraphEdge[],
  produced: ProducedOutputs,
  readCache?: CachedInputReader,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const edge of edges) {
    if (edge.target.nodeId !== node.id) continue
    // This-run output wins; otherwise fall back to the persisted output cache so
    // a partial (downstream) run can read boundary upstream values that were
    // produced by an earlier execution and not re-run this pass. Mirrors the
    // legacy execution.service partial contract ("上游数据由后端 outputCache 补全").
    const upstream = produced.get(edge.source.nodeId)
    let value = upstream?.[edge.source.port]
    if (value === undefined && readCache) value = readCache(edge.source.nodeId, edge.source.port)
    if (value !== undefined) inputs[edge.target.port] = value
  }
  return inputs
}

export interface ExecutionClosure {
  /** Node ids in dependency order. */
  sorted: string[]
  /** Lookup for the nodes in the closure. */
  nodesById: Map<string, GraphNode>
  /** All graph edges (the walk filters per node). */
  edges: readonly GraphEdge[]
}

/** Forward-BFS: the start node plus every node it feeds (directly or transitively). */
function downstreamOf(nodeId: string, edges: readonly GraphEdge[]): Set<string> {
  const visited = new Set<string>([nodeId])
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.source.nodeId === current && !visited.has(edge.target.nodeId)) {
        visited.add(edge.target.nodeId)
        queue.push(edge.target.nodeId)
      }
    }
  }
  return visited
}

/**
 * Select + order the nodes to execute.
 *   - targetNodeId given  → the target's DOWNSTREAM closure (the node plus every
 *     node it feeds). Boundary upstream inputs are hydrated from the persisted
 *     output cache by the walk — so a change at `targetNodeId` re-runs it and
 *     everything that depends on it (the sinks/preview update), without
 *     re-running the rest of the graph. This is the legacy partial-exec model
 *     (getDownstreamNodeIds + outputCache); the inverse "upstream closure"
 *     left downstream stale and re-ran (and could fail on) unrelated upstreams.
 *   - targetNodeId omitted → all nodes (pipeline mode)
 * Throws on an unknown target or a cyclic closure.
 */
export function buildExecutionClosure(
  nodes: Record<string, GraphNode>,
  edges: Record<string, GraphEdge>,
  targetNodeId: string | undefined,
): ExecutionClosure {
  const allEdges = Object.values(edges)
  let closureIds: string[]

  if (targetNodeId !== undefined) {
    if (!nodes[targetNodeId]) throw new Error(`executeNode: target node not found: ${targetNodeId}`)
    // Only descendants that still exist as nodes (an edge may dangle mid-edit).
    closureIds = [...downstreamOf(targetNodeId, allEdges)].filter((id) => nodes[id])
  } else {
    closureIds = Object.keys(nodes)
  }

  const sorted = topologicalSort(closureIds, allEdges)
  if (sorted.length !== closureIds.length) {
    throw new Error('executeNode: graph has a cycle in the execution closure')
  }

  const nodesById = new Map<string, GraphNode>()
  for (const id of closureIds) nodesById.set(id, nodes[id]!)

  return { sorted, nodesById, edges: allEdges }
}
