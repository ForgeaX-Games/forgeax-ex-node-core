import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime } from '../layer2/index.js'
import { executeNode } from '../layer2/execute-node.js'
import type { RuntimeEvent } from '../layer2/subscriptions.js'
import {
  executeNode as executeNodeL1,
  DataTree,
  type ExecutionContext,
  type GraphNode,
  type OpSpec,
} from '../layer1/index.js'

let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratch, { recursive: true })
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const sourceOp: OpSpec = {
  id: 'kernel.source',
  inputs: [],
  outputs: [{ name: 'out', type: 'number', access: 'item' }],
  params: [{ name: 'value', type: 'number' }],
  execute: (_ctx, args) => ({ out: args.value }),
}
const doubleOp: OpSpec = {
  id: 'kernel.double',
  inputs: [{ name: 'in', type: 'number', access: 'item' }],
  outputs: [{ name: 'out', type: 'number', access: 'item' }],
  params: [],
  execute: (_ctx, args) => ({ out: (args.in as number) * 2 }),
}
const boomOp: OpSpec = {
  id: 'kernel.boom',
  inputs: [],
  outputs: [{ name: 'out', type: 'number', access: 'item' }],
  params: [],
  execute: () => {
    throw new Error('kaboom')
  },
}

function makeCtx(): ExecutionContext {
  return {
    pipelineId: 'p1',
    log: () => undefined,
    signal: new AbortController().signal,
  }
}

function fresh() {
  const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
  runtime.registry.register(sourceOp)
  runtime.registry.register(doubleOp)
  runtime.registry.register(boomOp)
  return runtime
}

// s(value:21) -> d(double)
async function seedChain(runtime: ReturnType<typeof fresh>) {
  await applyBatch(runtime, [
    { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 21 } },
    { type: 'createNode', nodeId: 'd', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
    { type: 'connect', edgeId: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'd', port: 'in' } },
  ])
}

function entries(v: unknown): Array<{ path: number[]; items: unknown[] }> {
  return v as Array<{ path: number[]; items: unknown[] }>
}

describe('executeNode (Layer 2)', () => {
  it('target mode runs the downstream closure (the node + descendants) and threads values', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    const handle = await executeNode(runtime, { nodeId: 's' })
    const result = await handle.done
    expect(result.status).toBe('completed')
    expect(entries(result.outputs.d!.out)[0]!.items).toEqual([42])
    expect(result.outputs.s).toBeDefined()
  })

  it('partial re-run of a sink hydrates boundary upstream inputs from the cache (no re-run of upstream)', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    // Prime the output cache with a full run, then re-run only the sink `d`.
    await (await executeNode(runtime, {})).done
    const result = await (await executeNode(runtime, { nodeId: 'd' })).done
    expect(result.status).toBe('completed')
    // Only `d` ran this pass; `s` came from the cache, not re-executed.
    expect(Object.keys(result.outputs)).toEqual(['d'])
    expect(entries(result.outputs.d!.out)[0]!.items).toEqual([42])
  })

  it('a partial run does not abort on an unrelated, un-included upstream error', async () => {
    const runtime = fresh()
    // good: s -> d   and a separate broken sink fed by boom: boom -> bd
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 21 } },
      { type: 'createNode', nodeId: 'd', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'boom', opId: 'kernel.boom', position: { x: 0, y: 50 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'd', port: 'in' } },
    ])
    // Prime the good chain's cache (downstream of `s` = {s, d}; never touches boom).
    await (await executeNode(runtime, { nodeId: 's' })).done
    // Re-running only `d`'s downstream closure must not touch `boom`.
    const result = await (await executeNode(runtime, { nodeId: 'd' })).done
    expect(result.status).toBe('completed')
    expect(entries(result.outputs.d!.out)[0]!.items).toEqual([42])
  })

  it('pipeline mode runs every node', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    const result = await (await executeNode(runtime, {})).done
    expect(result.status).toBe('completed')
    expect(Object.keys(result.outputs).sort()).toEqual(['d', 's'])
  })

  it('emits started, per-port outputs, then completed in order', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    await (await executeNode(runtime, { nodeId: 's' })).done
    expect(events.map((e) => e.kind)).toEqual([
      'exec:started',
      'exec:node:output',
      'exec:node:output',
      'exec:completed',
    ])
    const outputs = events.filter((e) => e.kind === 'exec:node:output')
    expect(outputs.map((e) => (e as { nodeId: string }).nodeId)).toEqual(['s', 'd'])
  })

  it('writes produced outputs to the output cache', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    await (await executeNode(runtime, { nodeId: 's' })).done
    const cached = runtime.outputs.read('d', 'out')
    expect(cached).not.toBeNull()
    expect(cached!.type).toBe('number')
  })

  it('lets hosts enrich the execution context with plugin services', async () => {
    const runtime = createRuntime({
      projectRoot: scratch,
      pipelineId: 'p1',
      pluginId: 'plugin.test',
      createExecutionContext: (base) => ({
        ...base,
        services: { baker: { tag: 'shared-service' } },
      }),
    })
    runtime.registry.register({
      id: 'kernel.ctx',
      inputs: [],
      outputs: [{ name: 'out', type: 'string', access: 'item' }],
      params: [],
      execute: (ctx) => ({ out: (ctx.services?.baker as { tag: string }).tag }),
    })
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'ctx', opId: 'kernel.ctx', position: { x: 0, y: 0 }, params: {} },
    ])

    const result = await (await executeNode(runtime, {})).done

    expect(result.status).toBe('completed')
    expect(entries(result.outputs.ctx!.out)[0]!.items).toEqual(['shared-service'])
  })

  it('passes a __relay__ node input through to its output', async () => {
    const runtime = fresh()
    // s(7) -> r(__relay__) -> d(double); relay forwards input on its 'input' port
    // to its 'output' port unchanged.
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 7 } },
      { type: 'createNode', nodeId: 'r', opId: '__relay__', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'd', opId: 'kernel.double', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'r', port: 'input' } },
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'r', port: 'output' }, target: { nodeId: 'd', port: 'in' } },
    ])
    const result = await (await executeNode(runtime, {})).done
    expect(result.status).toBe('completed')
    // 7 forwarded through the relay unchanged, then doubled by d.
    expect(entries(result.outputs.r!.output)[0]!.items).toEqual([7])
    expect(entries(result.outputs.d!.out)[0]!.items).toEqual([14])
  })

  it('emits exec:error with the failing nodeId and stops, no completed', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'boom', opId: 'kernel.boom', position: { x: 0, y: 0 }, params: {} },
    ])
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    const result = await (await executeNode(runtime, {})).done
    expect(result.status).toBe('error')
    expect(result.error?.nodeId).toBe('boom')
    const err = events.find((e) => e.kind === 'exec:error') as { nodeId?: string; message: string }
    expect(err.nodeId).toBe('boom')
    expect(events.some((e) => e.kind === 'exec:completed')).toBe(false)
  })

  it('abort stops the walk and resolves with status aborted', async () => {
    const runtime = fresh()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    runtime.registry.register({
      id: 'kernel.gated',
      inputs: [],
      outputs: [{ name: 'out', type: 'number', access: 'item' }],
      params: [],
      execute: async () => {
        await gate
        return { out: 1 }
      },
    })
    // g(gated) -> d(double)
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'g', opId: 'kernel.gated', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'd', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'g', port: 'out' }, target: { nodeId: 'd', port: 'in' } },
    ])
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    const handle = await executeNode(runtime, {})
    handle.abort()
    release()
    const result = await handle.done
    expect(result.status).toBe('aborted')
    // Abort stops at the next node boundary: the in-flight node 'g' completes,
    // but its downstream 'd' never runs.
    expect(result.outputs.g).toBeDefined()
    expect(result.outputs.d).toBeUndefined()
    const err = events.find((e) => e.kind === 'exec:error') as { message: string }
    expect(err.message).toBe('aborted')
    expect(events.some((e) => e.kind === 'exec:completed')).toBe(false)
  })

  it('rejects an unknown target node before emitting any event', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    await expect(executeNode(runtime, { nodeId: 'nope' })).rejects.toThrow(/not found/)
    expect(events).toEqual([])
  })

  it('rejects a cyclic graph before emitting any event', async () => {
    const runtime = fresh()
    const now = new Date().toISOString()
    const mk = (id: string) => ({ id, opId: 'kernel.double', position: { x: 0, y: 0 }, params: {} })
    runtime.graph.save({
      schemaVersion: 1,
      id: 'p1',
      createdAt: now,
      updatedAt: now,
      nodes: { a: mk('a'), b: mk('b') },
      edges: {
        e1: { id: 'e1', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
        e2: { id: 'e2', source: { nodeId: 'b', port: 'out' }, target: { nodeId: 'a', port: 'in' } },
      },
    })
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    await expect(executeNode(runtime, {})).rejects.toThrow(/cycle/)
    expect(events).toEqual([])
  })
})

describe('executeNode access semantics (Layer 1)', () => {
  it('uses op input order for the default principal regardless of edge insertion order', async () => {
    const runtime = fresh()
    runtime.registry.register({
      id: 'kernel.principal-order',
      inputs: [
        { name: 'scene', type: 'scene', access: 'item' },
        { name: 'nodes', type: 'scene', access: 'list' },
      ],
      outputs: [{ name: 'out', type: 'string', access: 'item' }],
      params: [],
      execute: (_ctx, args) => ({ out: (args.nodes as string[]).join(',') }),
    })
    const node: GraphNode = {
      id: 'principal',
      opId: 'kernel.principal-order',
      position: { x: 0, y: 0 },
      params: {},
    }

    const result = await executeNodeL1(
      runtime.registry,
      node,
      {
        nodes: [
          { path: [0, 0], items: ['A'] },
          { path: [0, 1], items: ['B'] },
        ],
        scene: [{ path: [7], items: ['Root'] }],
      },
      makeCtx(),
    )

    expect(result.error).toBeUndefined()
    expect(entries(result.outputs.out)).toEqual([{ path: [7], items: ['A,B'] }])
  })

  it('promotes a multi-item item input into one branch per item', async () => {
    const runtime = fresh()
    runtime.registry.register({
      id: 'kernel.item-access',
      inputs: [{ name: 'value', type: 'number', access: 'item' }],
      outputs: [{ name: 'out', type: 'number', access: 'item' }],
      params: [],
      execute: (_ctx, args) => ({ out: (args.value as number) * 10 }),
    })
    const node: GraphNode = {
      id: 'item',
      opId: 'kernel.item-access',
      position: { x: 0, y: 0 },
      params: {},
    }

    const result = await executeNodeL1(
      runtime.registry,
      node,
      { value: [{ path: [0], items: [1, 2] }] },
      makeCtx(),
    )

    expect(result.error).toBeUndefined()
    expect(entries(result.outputs.out)).toEqual([
      { path: [0, 0], items: [10] },
      { path: [0, 1], items: [20] },
    ])
  })

  it('passes a promoted branch to list access as an ordered item array', async () => {
    const runtime = fresh()
    runtime.registry.register({
      id: 'kernel.list-access',
      inputs: [{ name: 'nodes', type: 'string', access: 'list' }],
      outputs: [{ name: 'summary', type: 'string', access: 'item' }],
      params: [],
      execute: (_ctx, args) => ({ summary: (args.nodes as string[]).join(',') }),
    })
    const node: GraphNode = {
      id: 'list',
      opId: 'kernel.list-access',
      position: { x: 0, y: 0 },
      params: {},
    }

    const result = await executeNodeL1(
      runtime.registry,
      node,
      {
        nodes: [
          { path: [0, 0], items: ['A'] },
          { path: [0, 1], items: ['B'] },
        ],
      },
      makeCtx(),
    )

    expect(result.error).toBeUndefined()
    expect(entries(result.outputs.summary)).toEqual([{ path: [0], items: ['A,B'] }])
  })

  it('serializes list access outputs as child branches for downstream list ports', async () => {
    const runtime = fresh()
    runtime.registry.register({
      id: 'kernel.list-output',
      inputs: [],
      outputs: [{ name: 'out', type: 'string', access: 'list' }],
      params: [],
      execute: () => ({ out: ['A', 'B'] }),
    })
    const node: GraphNode = {
      id: 'source',
      opId: 'kernel.list-output',
      position: { x: 0, y: 0 },
      params: {},
    }

    const result = await executeNodeL1(runtime.registry, node, {}, makeCtx())

    expect(result.error).toBeUndefined()
    expect(entries(result.outputs.out)).toEqual([
      { path: [0, 0], items: ['A'] },
      { path: [0, 1], items: ['B'] },
    ])
  })
})

describe('executeNode connection metadata inference (Layer 2)', () => {
  it('derives missing inferredAccess for adaptive dynamic tree inputs from the first source port', async () => {
    const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
    runtime.registry.register({
      id: 'kernel.item-source',
      inputs: [],
      outputs: [{ name: 'out', type: 'scene', access: 'item' }],
      params: [{ name: 'value', type: 'string' }],
      execute: (_ctx, args) => ({ out: args.value }),
    })
    runtime.registry.register({
      id: 'kernel.adaptive-merge',
      inputs: [
        { name: 'item_0', type: 'any', access: 'tree' },
        { name: 'item_1', type: 'any', access: 'tree' },
      ],
      outputs: [{ name: 'tree', type: 'any', access: 'tree' }],
      params: [],
      dynamicInputs: { prefix: 'item_', labelTemplate: '[$i]', minCount: 2, type: 'any', access: 'tree' },
      execute: (_ctx, args) => {
        const a = args.item_0 as { toJSON(): Array<{ path: number[]; items: string[] }> }
        const b = args.item_1 as { toJSON(): Array<{ path: number[]; items: string[] }> }
        const aEntries = a.toJSON()
        const bEntries = b.toJSON()
        if (args.inferredAccess === 'item') {
          return { tree: DataTree.fromEntries([{ path: [0], items: [aEntries[0]!.items[0], bEntries[0]!.items[0]] }]) }
        }
        return {
          tree: DataTree.fromEntries([
            { path: [0, 0], items: [aEntries[0]!.items[0]] },
            { path: [1, 0], items: [bEntries[0]!.items[0]] },
          ]),
        }
      },
    })

    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'kernel.item-source', position: { x: 0, y: 0 }, params: { value: 'A' } },
      { type: 'createNode', nodeId: 'b', opId: 'kernel.item-source', position: { x: 0, y: 0 }, params: { value: 'B' } },
      { type: 'createNode', nodeId: 'merge', opId: 'kernel.adaptive-merge', position: { x: 0, y: 0 }, params: { portCount: 2 } },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'merge', port: 'item_0' } },
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'b', port: 'out' }, target: { nodeId: 'merge', port: 'item_1' } },
    ])

    // Prime the cache so the partial re-run of the merge sink can hydrate a/b.
    await (await executeNode(runtime, {})).done
    const result = await (await executeNode(runtime, { nodeId: 'merge' })).done

    expect(result.status).toBe('completed')
    expect(entries(result.outputs.merge!.tree)).toEqual([{ path: [0], items: ['A', 'B'] }])
  })
})

describe('executeNode group sub-graph', () => {
  it('runs a __group__ node and threads values through it', async () => {
    const runtime = fresh()
    // s(5) -> m(double) -> k(double); then wrap {m} into a group.
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 5 } },
      { type: 'createNode', nodeId: 'm', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'k', opId: 'kernel.double', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'm', port: 'in' } },
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'm', port: 'out' }, target: { nodeId: 'k', port: 'in' } },
    ])
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g', name: 'Inner', memberNodeIds: ['m'], position: { x: 100, y: 0 } },
    ])

    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    const result = await (await executeNode(runtime, {})).done

    expect(result.status).toBe('completed')
    // s=5 -> group(m doubles -> 10) -> k doubles -> 20
    expect(entries(result.outputs.k!.out)[0]!.items).toEqual([20])
    // the group node emitted at least one output event
    expect(
      events.some((e) => e.kind === 'exec:node:output' && (e as { nodeId: string }).nodeId === 'g'),
    ).toBe(true)
  })
})
