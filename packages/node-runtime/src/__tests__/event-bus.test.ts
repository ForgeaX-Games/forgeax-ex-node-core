import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect } from 'vitest'
import { createEventBus } from '../layer2/event-bus.js'
import type { RuntimeEvent } from '../layer2/subscriptions.js'
import { createRuntime } from '../layer2/runtime.js'
import { busFor } from '../layer2/event-bus.js'

function collect(): { events: RuntimeEvent[]; handler: (e: RuntimeEvent) => void } {
  const events: RuntimeEvent[] = []
  return { events, handler: (e) => events.push(e) }
}

describe('createEventBus', () => {
  it('delivers to a handler matching pipelineId and channel', () => {
    const bus = createEventBus()
    const { events, handler } = collect()
    bus.subscribe('p1', ['execution'], handler)
    bus.emit({ kind: 'exec:started', pipelineId: 'p1', executionId: 'x1' })
    expect(events).toEqual([{ kind: 'exec:started', pipelineId: 'p1', executionId: 'x1' }])
  })

  it('filters by pipelineId', () => {
    const bus = createEventBus()
    const { events, handler } = collect()
    bus.subscribe('p1', ['execution'], handler)
    bus.emit({ kind: 'exec:started', pipelineId: 'p2', executionId: 'x1' })
    expect(events).toEqual([])
  })

  it('filters by channel', () => {
    const bus = createEventBus()
    const { events, handler } = collect()
    bus.subscribe('p1', ['graph'], handler)
    bus.emit({ kind: 'exec:started', pipelineId: 'p1', executionId: 'x1' })
    expect(events).toEqual([])
  })

  it('stops delivery after unsubscribe', () => {
    const bus = createEventBus()
    const { events, handler } = collect()
    const off = bus.subscribe('p1', ['execution'], handler)
    off()
    bus.emit({ kind: 'exec:started', pipelineId: 'p1', executionId: 'x1' })
    expect(events).toEqual([])
  })

  it('isolates a throwing handler from other subscribers', () => {
    const bus = createEventBus()
    const { events, handler } = collect()
    bus.subscribe('p1', ['execution'], () => {
      throw new Error('boom')
    })
    bus.subscribe('p1', ['execution'], handler)
    expect(() => bus.emit({ kind: 'exec:completed', pipelineId: 'p1', executionId: 'x1' })).not.toThrow()
    expect(events).toHaveLength(1)
  })
})

describe('Runtime event bus wiring', () => {
  it('exposes a subscribe-only API that receives events emitted on the internal bus', () => {
    const scratch = join(tmpdir(), `forgeax-bus-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(scratch, { recursive: true })
    try {
      const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
      const events: unknown[] = []
      runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
      busFor(runtime).emit({ kind: 'exec:started', pipelineId: 'p1', executionId: 'x1' })
      expect(events).toEqual([{ kind: 'exec:started', pipelineId: 'p1', executionId: 'x1' }])
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
