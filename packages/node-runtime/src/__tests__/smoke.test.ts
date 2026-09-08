// End-to-end smoke test for the kernel:
// register an op → execute a graph → verify outputs.
//
// No filesystem, no plugin services, no UI — just OpSpec + dispatcher +
// executor. If this passes, layer1 is functionally coherent.

import { describe, it, expect } from 'vitest'
import {
  OpRegistry,
  executeNode,
  topologicalSort,
  type ExecutionContext,
  type GraphEdge,
  type GraphNode,
  type OpSpec,
} from '../layer1/index.js'

function makeCtx(): ExecutionContext {
  return {
    pipelineId: 'smoke-pipeline',
    log: () => {
      /* no-op */
    },
    signal: new AbortController().signal,
  }
}

describe('layer1 smoke', () => {
  it('registers an op, executes a node, returns the result', async () => {
    const registry = new OpRegistry()
    const addOp: OpSpec = {
      id: 'kernel.add',
      inputs: [
        { name: 'a', type: 'number', access: 'item' },
        { name: 'b', type: 'number', access: 'item' },
      ],
      outputs: [{ name: 'sum', type: 'number', access: 'item' }],
      params: [],
      execute: (_ctx, args) => {
        const a = (args.a as number) ?? 0
        const b = (args.b as number) ?? 0
        return { sum: a + b }
      },
    }
    registry.register(addOp)

    const node: GraphNode = {
      id: 'n1',
      opId: 'kernel.add',
      position: { x: 0, y: 0 },
      params: { a: 2, b: 3 },
    }
    const result = await executeNode(registry, node, {}, makeCtx())
    expect(result.error).toBeUndefined()
    // Output port 'sum' is wrapped by the dispatcher into DataTreeEntry[]
    // (toJSON form). For a scalar input → scalar output, the sum lands at path [0].
    const sumEntries = result.outputs.sum as Array<{ path: number[]; items: unknown[] }>
    expect(sumEntries).toHaveLength(1)
    expect(sumEntries[0].items).toEqual([5])
  })

  it('topologicalSort orders dependent nodes correctly', () => {
    const ids = ['c', 'a', 'b']
    const edges: GraphEdge[] = [
      { id: 'e1', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
      { id: 'e2', source: { nodeId: 'b', port: 'out' }, target: { nodeId: 'c', port: 'in' } },
    ]
    const order = topologicalSort(ids, edges)
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'))
  })

  it('rejects an unregistered op with a clear error', async () => {
    const registry = new OpRegistry()
    const node: GraphNode = {
      id: 'n1',
      opId: 'kernel.does-not-exist',
      position: { x: 0, y: 0 },
      params: {},
    }
    const result = await executeNode(registry, node, {}, makeCtx())
    expect(result.error).toMatch(/not registered/)
  })
})
