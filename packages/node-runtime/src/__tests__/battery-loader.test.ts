// Battery loader — integration test against a real filesystem tree under tmp.
//
// Spins up a minimal `materials/batteries/test/echo` directory with
// meta.json + index.ts, points the loader at it, scans, then verifies the
// op was registered and runs.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  OpRegistry,
  createBatteryLoader,
  executeNode,
  type ExecutionContext,
  type GraphNode,
} from '../layer1/index.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-loader-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

function makeCtx(): ExecutionContext {
  return {
    pipelineId: 'loader-test',
    log: () => undefined,
    signal: new AbortController().signal,
  }
}

describe('battery loader', () => {
  it('discovers a battery folder and registers an op', async () => {
    // Layout: <scratchDir>/data/echo/{meta.json,index.ts}
    const opDir = join(scratchDir, 'data', 'echo')
    mkdirSync(opDir, { recursive: true })
    writeFileSync(
      join(opDir, 'meta.json'),
      JSON.stringify({
        id: 'plugin.echo',
        name: 'echo',
        inputs: [{ name: 'value', type: 'string', access: 'item' }],
        outputs: [{ name: 'echo', type: 'string', access: 'item' }],
        params: [],
      }),
    )
    writeFileSync(
      join(opDir, 'index.ts'),
      `export function echo(input) { return { echo: input.value }; }\n`,
    )

    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, {
      pluginId: 'plugin',
      scanDirs: [join(scratchDir, 'data')],
    })

    const result = await loader.scan()
    expect(result.errors).toEqual([])
    expect(result.added).toBe(1)
    expect(loader.list()).toContain('plugin.echo')
    expect(registry.has('plugin.echo')).toBe(true)

    // Run the op via the executor; verify the dispatcher wires it correctly.
    const node: GraphNode = {
      id: 'n1',
      opId: 'plugin.echo',
      position: { x: 0, y: 0 },
      params: { value: 'hello' },
    }
    const exec = await executeNode(registry, node, {}, makeCtx())
    expect(exec.error).toBeUndefined()
    const out = exec.outputs.echo as Array<{ items: unknown[] }>
    expect(out[0]?.items).toEqual(['hello'])
  })

  it('reports per-folder errors but continues scanning other folders', async () => {
    // bad: meta.json present but malformed JSON
    const badDir = join(scratchDir, 'data', 'bad')
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, 'meta.json'), '{ this is not json')

    // good: a sibling that should still load
    const goodDir = join(scratchDir, 'data', 'good')
    mkdirSync(goodDir, { recursive: true })
    writeFileSync(
      join(goodDir, 'meta.json'),
      JSON.stringify({
        id: 'plugin.good',
        inputs: [],
        outputs: [{ name: 'tag', type: 'string', access: 'item' }],
        params: [],
      }),
    )
    writeFileSync(join(goodDir, 'index.ts'), `export function good() { return { tag: 'ok' }; }\n`)

    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, {
      pluginId: 'plugin',
      scanDirs: [join(scratchDir, 'data')],
    })

    const result = await loader.scan()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].dir).toBe(badDir)
    expect(result.added).toBe(1)
    expect(registry.has('plugin.good')).toBe(true)
  })

  it('deduplicates a clashing op id deterministically: first sorted dir wins, later is skipped + reported', async () => {
    // Two directories claim the SAME meta id. The walk is sorted, so the
    // alphabetically-first dir ('aaa') must win; 'zzz' must be skipped and
    // reported — never a silent filesystem-order overwrite.
    for (const [name, value] of [['zzz', 'from-zzz'], ['aaa', 'from-aaa']] as const) {
      const d = join(scratchDir, 'data', name)
      mkdirSync(d, { recursive: true })
      writeFileSync(
        join(d, 'meta.json'),
        JSON.stringify({ id: 'plugin.dup', inputs: [], outputs: [{ name: 'tag', type: 'string', access: 'item' }], params: [] }),
      )
      writeFileSync(join(d, 'index.ts'), `export function dup() { return { tag: '${value}' }; }\n`)
    }

    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, { pluginId: 'plugin', scanDirs: [join(scratchDir, 'data')] })

    const result = await loader.scan()
    // Exactly one registration; the duplicate is reported, not silently dropped.
    expect(result.added).toBe(1)
    expect(loader.list().filter((id) => id === 'plugin.dup')).toEqual(['plugin.dup'])
    const dupError = result.errors.find((e) => e.reason.includes('duplicate op id'))
    expect(dupError).toBeDefined()
    expect(dupError!.dir).toBe(join(scratchDir, 'data', 'zzz')) // loser
    expect(dupError!.reason).toContain(join(scratchDir, 'data', 'aaa')) // winner

    // The WINNER ('aaa') is the registered implementation.
    const node: GraphNode = { id: 'n', opId: 'plugin.dup', position: { x: 0, y: 0 }, params: {} }
    const exec = await executeNode(registry, node, {}, makeCtx())
    const out = exec.outputs.tag as Array<{ items: unknown[] }>
    expect(out[0]?.items).toEqual(['from-aaa'])
  })

  it('does NOT flag distinct ids that merely share a directory basename', async () => {
    // Two dirs named 'building_carve' but with DIFFERENT meta ids — the real
    // scene-generator case. These must both register, no duplicate error.
    for (const [parent, id] of [['legacy', 'building_carve'], ['alg', 'alg_building_carve']] as const) {
      const d = join(scratchDir, 'data', parent, 'building_carve')
      mkdirSync(d, { recursive: true })
      writeFileSync(
        join(d, 'meta.json'),
        JSON.stringify({ id, inputs: [], outputs: [{ name: 'out', type: 'grid', access: 'item' }], params: [] }),
      )
      writeFileSync(join(d, 'index.ts'), `export function run() { return { out: '${id}' }; }\n`)
    }
    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, { pluginId: 'plugin', scanDirs: [join(scratchDir, 'data')] })
    const result = await loader.scan()
    expect(result.errors).toEqual([])
    expect(result.added).toBe(2)
    expect(registry.has('building_carve')).toBe(true)
    expect(registry.has('alg_building_carve')).toBe(true)
  })

  it('emits op-added events to subscribers', async () => {
    const opDir = join(scratchDir, 'plain')
    mkdirSync(opDir, { recursive: true })
    writeFileSync(
      join(opDir, 'meta.json'),
      JSON.stringify({
        id: 'plugin.plain',
        inputs: [],
        outputs: [{ name: 'value', type: 'number', access: 'item' }],
        params: [],
      }),
    )
    writeFileSync(join(opDir, 'index.ts'), `export function plain() { return { value: 42 }; }\n`)

    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, {
      pluginId: 'plugin',
      scanDirs: [scratchDir],
    })
    const events: string[] = []
    loader.subscribe((e) => events.push(`${e.kind}:${'opId' in e ? e.opId : ''}`))

    await loader.scan()
    expect(events).toContain('op-added:plugin.plain')
  })

  it('drops retired autoTextureBindings engine behavior from battery metadata', async () => {
    const opDir = join(scratchDir, 'texture')
    mkdirSync(opDir, { recursive: true })
    writeFileSync(
      join(opDir, 'meta.json'),
      JSON.stringify({
        id: 'plugin.texture',
        engineBehavior: 'autoTextureBindings',
        inputs: [],
        outputs: [{ name: 'value', type: 'grid', access: 'item' }],
        params: [],
      }),
    )
    writeFileSync(join(opDir, 'index.ts'), `export function texture() { return { value: [[1]] }; }\n`)

    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, { pluginId: 'plugin', scanDirs: [scratchDir] })
    const result = await loader.scan()

    expect(result.errors).toEqual([])
    expect(registry.get('plugin.texture')?.engineBehavior).toBeUndefined()
  })
})
