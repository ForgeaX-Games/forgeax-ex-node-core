// Layer 2 — createRuntime + applyBatch + queries integration test.
//
// Exercises the full kernel surface that downstream plugins (scene /
// 2d / 3d) consume: bootstrap a runtime in a tmp dir, apply a batch,
// read it back via queries, verify history is appended, and confirm
// optimistic-concurrency rejection.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime, getNode, getPipeline, listEdges, listNodes, listOps } from '../layer2/index.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('createRuntime + applyBatch + queries', () => {
  it('bootstraps an empty runtime, applies a batch, then reads it back', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'p1',
      pluginId: 'plugin.test',
    })

    expect(runtime.graph.exists()).toBe(false)

    const result = await applyBatch(
      runtime,
      [
        {
          type: 'createNode',
          nodeId: 'n1',
          opId: 'plugin.echo',
          position: { x: 10, y: 20 },
          params: { value: 'hello' },
        },
        {
          type: 'createNode',
          nodeId: 'n2',
          opId: 'plugin.echo',
          position: { x: 100, y: 20 },
          params: { value: 'world' },
        },
        {
          type: 'connect',
          edgeId: 'e1',
          source: { nodeId: 'n1', port: 'echo' },
          target: { nodeId: 'n2', port: 'value' },
        },
      ],
      { actor: 'test' },
    )
    expect(result.status).toBe('ok')
    expect(result.newHash).toMatch(/^[0-9a-f]{64}$/)

    const snapshot = getPipeline(runtime)
    expect(snapshot).not.toBeNull()
    expect(Object.keys(snapshot!.nodes).sort()).toEqual(['n1', 'n2'])
    expect(getNode(runtime, 'n1')?.params).toEqual({ value: 'hello' })
    expect(listNodes(runtime, { opId: 'plugin.echo' })).toHaveLength(2)
    expect(listEdges(runtime)).toHaveLength(1)

    const history = runtime.history.readAll()
    expect(history).toHaveLength(1)
    expect(history[0].actor).toBe('test')
    expect(history[0].newHash).toBe(snapshot!.hash)
  })

  it('rejects a batch when expectedPrevHash does not match', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'p1',
      pluginId: 'plugin.test',
    })

    const first = await applyBatch(runtime, [
      {
        type: 'createNode',
        nodeId: 'n1',
        opId: 'plugin.echo',
        position: { x: 0, y: 0 },
        params: {},
      },
    ])
    expect(first.status).toBe('ok')

    const stale = await applyBatch(
      runtime,
      [
        {
          type: 'createNode',
          nodeId: 'n2',
          opId: 'plugin.echo',
          position: { x: 0, y: 0 },
          params: {},
        },
      ],
      { expectedPrevHash: 'WRONG' },
    )
    expect(stale.status).toBe('rejected')
    expect(stale.reason).toMatch(/concurrent-write/)
  })

  it('rejects a batch with a duplicate nodeId and rolls back the in-memory state', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'p1',
      pluginId: 'plugin.test',
    })

    await applyBatch(runtime, [
      {
        type: 'createNode',
        nodeId: 'n1',
        opId: 'plugin.echo',
        position: { x: 0, y: 0 },
        params: {},
      },
    ])

    const dup = await applyBatch(runtime, [
      {
        type: 'createNode',
        nodeId: 'n1',
        opId: 'plugin.echo',
        position: { x: 0, y: 0 },
        params: {},
      },
    ])
    expect(dup.status).toBe('rejected')
    expect(dup.diagnostics?.[0].message).toMatch(/already exists/)

    // Graph still contains exactly one n1 with the original position.
    const snap = getPipeline(runtime)
    expect(Object.keys(snap!.nodes)).toEqual(['n1'])
    // History still has exactly one entry — the rejected batch was not appended.
    expect(runtime.history.readAll()).toHaveLength(1)
  })

  it('cascade-removes edges when a node is deleted', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'p1',
      pluginId: 'plugin.test',
    })

    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'op', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'b', opId: 'op', position: { x: 0, y: 0 }, params: {} },
      {
        type: 'connect',
        edgeId: 'e1',
        source: { nodeId: 'a', port: 'out' },
        target: { nodeId: 'b', port: 'in' },
      },
    ])
    await applyBatch(runtime, [{ type: 'deleteNode', nodeId: 'a' }])

    expect(listNodes(runtime).map((n) => n.id)).toEqual(['b'])
    expect(listEdges(runtime)).toHaveLength(0)
  })

  it('dryRun does not write graph.json or append history', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'p1',
      pluginId: 'plugin.test',
    })
    const result = await applyBatch(
      runtime,
      [{ type: 'createNode', nodeId: 'n1', opId: 'op', position: { x: 0, y: 0 }, params: {} }],
      { dryRun: true },
    )
    expect(result.status).toBe('ok')
    expect(runtime.graph.exists()).toBe(false)
    expect(runtime.history.exists()).toBe(false)
  })

  it('listOps preserves port access metadata for editor rendering', () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'p1',
      pluginId: 'plugin.test',
    })
    runtime.registry.register({
      id: 'plugin.add_child',
      name: 'Add Child',
      inputs: [
        { name: 'scene', type: 'scene', access: 'item' },
        { name: 'nodes', type: 'scene', access: 'list' },
      ],
      outputs: [
        { name: 'scene', type: 'scene', access: 'item' },
        { name: 'childPaths', type: 'string', access: 'list' },
      ],
      params: [],
      execute: () => null,
    })

    const [op] = listOps(runtime)

    expect(op?.inputs.find((p) => p.name === 'nodes')?.access).toBe('list')
    expect(op?.outputs.find((p) => p.name === 'childPaths')?.access).toBe('list')
  })
})
