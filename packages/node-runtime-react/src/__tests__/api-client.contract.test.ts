import { describe, expect, it } from 'vitest'

import type { Op, RuntimeEvent } from '@forgeax/node-runtime'
import { createMockApiClient } from '../test/mockApiClient.js'

describe('MockApiClient (ApiClient contract)', () => {
  it('createNode adds the node and emits graph:applied', async () => {
    const client = createMockApiClient()
    const events: RuntimeEvent[] = []
    client.subscribe('graph', e => events.push(e))

    const ops: Op[] = [
      { type: 'createNode', nodeId: 'n1', opId: 'demo.echo', position: { x: 0, y: 0 }, params: { x: 1 } },
    ]
    const result = await client.applyBatch(ops)

    expect(result.status).toBe('ok')
    const node = await client.getNode('n1')
    expect(node?.opId).toBe('demo.echo')
    expect((await client.listNodes()).map(n => n.id)).toEqual(['n1'])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'graph:applied', pipelineId: 'test-pipeline' })
  })

  it('connect / disconnect manage edges and cascade-delete on node removal', async () => {
    const client = createMockApiClient()
    await client.applyBatch([
      { type: 'createNode', nodeId: 'a', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'b', opId: 'demo.echo', position: { x: 1, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
    ])
    expect((await client.listEdges()).map(e => e.id)).toEqual(['e1'])

    await client.applyBatch([{ type: 'deleteNode', nodeId: 'a' }])
    expect((await client.listEdges()).length).toBe(0)
    expect((await client.listNodes()).map(n => n.id)).toEqual(['b'])
  })

  it('updateNode merges params; preserves untouched fields', async () => {
    const client = createMockApiClient()
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'demo.echo', position: { x: 0, y: 0 }, params: { a: 1, b: 2 } },
    ])
    await client.applyBatch([
      { type: 'updateNode', nodeId: 'n1', params: { b: 99 } },
    ])
    const node = await client.getNode('n1')
    expect(node?.params).toEqual({ a: 1, b: 99 })
  })

  it('expectedPrevHash mismatch rejects the batch and emits graph:rejected', async () => {
    const client = createMockApiClient()
    const events: RuntimeEvent[] = []
    client.subscribe('graph', e => events.push(e))

    const result = await client.applyBatch(
      [{ type: 'createNode', nodeId: 'n1', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} }],
      { expectedPrevHash: 'wrong' },
    )

    expect(result.status).toBe('rejected')
    expect(events[0]).toMatchObject({ kind: 'graph:rejected' })
    expect((await client.listNodes()).length).toBe(0)
  })

  it('subscribe returns an unsubscribe handle', async () => {
    const client = createMockApiClient()
    const events: RuntimeEvent[] = []
    const off = client.subscribe('graph', e => events.push(e))

    await client.applyBatch([{ type: 'createNode', nodeId: 'n1', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} }])
    off()
    await client.applyBatch([{ type: 'createNode', nodeId: 'n2', opId: 'demo.echo', position: { x: 1, y: 0 }, params: {} }])

    expect(events).toHaveLength(1)
  })

  it('history records every applied batch', async () => {
    const client = createMockApiClient()
    await client.applyBatch([{ type: 'createNode', nodeId: 'n1', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} }])
    await client.applyBatch([{ type: 'updateNode', nodeId: 'n1', params: { x: 7 } }])
    const history = await client.getHistory()
    expect(history).toHaveLength(2)
    expect(history[0]?.ops[0]).toMatchObject({ type: 'createNode' })
  })

  it('listeners are invoked BEFORE applyBatch resolves (contract §4)', async () => {
    const client = createMockApiClient()
    const order: string[] = []
    client.subscribe('graph', () => order.push('listener'))

    const promise = client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} },
    ])
    promise.then(() => order.push('resolved'))
    await promise

    // Listener must fire before the resolution callback runs.
    expect(order).toEqual(['listener', 'resolved'])
  })

  it('read-after-write consistency on the same client (contract §3)', async () => {
    const client = createMockApiClient()
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'demo.echo', position: { x: 0, y: 0 }, params: { v: 1 } },
    ])
    expect((await client.getNode('n1'))?.params).toEqual({ v: 1 })
    expect((await client.getPipeline())?.nodes['n1']?.opId).toBe('demo.echo')
  })

  it('getPipeline returns one consistent snapshot (preferred over listNodes+listEdges)', async () => {
    const client = createMockApiClient()
    await client.applyBatch([
      { type: 'createNode', nodeId: 'a', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'b', opId: 'demo.echo', position: { x: 1, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
    ])
    const snap = await client.getPipeline()
    expect(snap).not.toBeNull()
    expect(Object.keys(snap!.nodes).sort()).toEqual(['a', 'b'])
    expect(Object.keys(snap!.edges)).toEqual(['e1'])
    expect(snap!.hash).toBeTruthy()
  })

  it('list-shaped queries return [] (not null) when empty (contract §2)', async () => {
    const client = createMockApiClient()
    expect(await client.listNodes()).toEqual([])
    expect(await client.listEdges()).toEqual([])
    expect(await client.listOps()).toEqual([])
    expect(await client.getHistory()).toEqual([])
  })

  it('getNode returns null (not throws) on missing id (contract §2)', async () => {
    const client = createMockApiClient()
    expect(await client.getNode('does-not-exist')).toBeNull()
  })

  it('dispose is optional and calling client.dispose?.() is always safe (contract §1)', async () => {
    const client = createMockApiClient()
    // Mock omits dispose; optional chaining must be a no-op.
    expect(() => client.dispose?.()).not.toThrow()
    // Double-call is also safe (idempotency contract).
    expect(() => { client.dispose?.(); client.dispose?.() }).not.toThrow()
  })
})
