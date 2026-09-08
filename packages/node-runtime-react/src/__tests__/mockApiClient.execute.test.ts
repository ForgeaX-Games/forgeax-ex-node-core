// MockApiClient.execute — verifies the simulated run resolves with a
// 'completed' result and streams at least an exec:completed event over the
// 'execution' channel.

import { describe, expect, it } from 'vitest'

import type { RuntimeEvent } from '@forgeax/node-runtime'
import { createMockApiClient } from '../test/mockApiClient.js'

const seedNode = (id: string) => ({
  id,
  opId: 'demo.echo',
  position: { x: 0, y: 0 },
  params: {},
})

describe('MockApiClient.execute', () => {
  it('resolves with a completed result and emits exec:completed', async () => {
    const client = createMockApiClient({ nodes: [seedNode('a'), seedNode('b')] })
    const events: RuntimeEvent[] = []
    client.subscribe('execution', e => events.push(e))

    const result = await client.execute()

    expect(result.status).toBe('completed')
    expect(typeof result.executionId).toBe('string')
    expect(result.executionId.length).toBeGreaterThan(0)

    const kinds = events.map(e => e.kind)
    expect(kinds).toContain('exec:completed')
  })
})
