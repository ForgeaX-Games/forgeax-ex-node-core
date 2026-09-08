import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OpRegistry, createBatteryLoader, executeNode } from '@forgeax/node-runtime/layer1'
import type { ExecutionContext, GraphNode } from '@forgeax/node-runtime/layer1'

const here = dirname(fileURLToPath(import.meta.url))
const batteriesDir = join(here, '..', 'fixtures', 'batteries')

function ctx(): ExecutionContext {
  return { pipelineId: 't', log: () => {}, signal: new AbortController().signal }
}

describe('fixture batteries', () => {
  it('all three register and run', async () => {
    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, { pluginId: 'fixture', scanDirs: [batteriesDir] })
    const result = await loader.scan()
    expect(result.errors).toEqual([])
    expect(registry.has('fixture.number')).toBe(true)
    expect(registry.has('fixture.add')).toBe(true)
    expect(registry.has('fixture.collect')).toBe(true)

    const numberNode: GraphNode = { id: 'n', opId: 'fixture.number', position: { x: 0, y: 0 }, params: { value: 5 } }
    const r = await executeNode(registry, numberNode, {}, ctx())
    expect(r.error).toBeUndefined()
    const out = r.outputs.out as Array<{ items: unknown[] }>
    expect(out[0]!.items).toEqual([5])
  })
})
