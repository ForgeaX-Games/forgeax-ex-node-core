// Layer 2 applyBatch event emission.
//
// A successful applyBatch must announce the mutation on the 'graph'
// channel so consumers subscribed via runtime.subscriptions learn about
// it — matching the package MockApiClient and the documented contract.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime } from '../layer2/index.js'
import type { RuntimeEvent } from '../layer2/subscriptions.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-applyevt-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('applyBatch event emission', () => {
  it('emits graph:applied on the graph channel on success', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'pevt',
      pluginId: 'plugin.test',
    })
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('pevt', ['graph'], (e) => events.push(e))

    const result = await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} },
    ])

    expect(result.status).toBe('ok')
    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event.kind).toBe('graph:applied')
    if (event.kind === 'graph:applied') {
      expect(event.pipelineId).toBe('pevt')
      expect(event.batchId).toBe(result.batchId)
      expect(event.newHash).toBe(result.newHash)
    }
  })

  it('does NOT emit graph:applied for a layout-only (reposition) batch', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'pevt',
      pluginId: 'plugin.test',
    })
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} },
    ])

    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('pevt', ['graph'], (e) => events.push(e))

    // A pure node move (position only) is persisted + recorded in history but
    // must not announce a data change — no re-pull / preview rebuild on clients.
    const result = await applyBatch(runtime, [
      { type: 'updateNode', nodeId: 'a', position: { x: 99, y: 42 } },
    ])

    expect(result.status).toBe('ok')
    expect(events).toHaveLength(0)
    // ...but the move is still persisted.
    expect(runtime.graph.load()?.nodes.a?.position).toEqual({ x: 99, y: 42 })
  })

  it('still emits graph:applied when a batch mixes a reposition with a param change', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'pevt',
      pluginId: 'plugin.test',
    })
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} },
    ])

    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('pevt', ['graph'], (e) => events.push(e))

    await applyBatch(runtime, [
      { type: 'updateNode', nodeId: 'a', position: { x: 5, y: 5 }, params: { foo: 1 } },
    ])

    expect(events).toHaveLength(1)
  })
})
