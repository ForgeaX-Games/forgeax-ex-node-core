// Pure helpers for the pipeline store — kept out of the store body so the
// store file reads as state + actions only.

import type { Pipeline, PipelineEdge } from '../types.js'

/**
 * BFS the set of downstream node ids reachable from startId (inclusive).
 * Used to scope incremental execution to the affected sub-graph.
 */
export function getDownstreamIds(startId: string, edges: PipelineEdge[]): string[] {
  const visited = new Set<string>([startId])
  const queue = [startId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.source.nodeId === current && !visited.has(edge.target.nodeId)) {
        visited.add(edge.target.nodeId)
        queue.push(edge.target.nodeId)
      }
    }
  }
  return Array.from(visited)
}

/** A fresh, empty working pipeline created when the first node is added. */
export function createEmptyPipeline(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: `pipeline-${Date.now()}`,
    name: 'untitled-pipeline',
    description: '',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}
