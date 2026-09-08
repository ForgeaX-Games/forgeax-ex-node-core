import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadRuntime } from '../runtime.js'

const here = dirname(fileURLToPath(import.meta.url))
const batteriesDir = join(here, '..', 'fixtures', 'batteries')
let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-cli-rt-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratch, { recursive: true })
})
afterEach(() => rmSync(scratch, { recursive: true, force: true }))

describe('loadRuntime', () => {
  it('creates a runtime and registers fixture ops when batteriesDir is given', async () => {
    const runtime = await loadRuntime({
      projectRoot: scratch,
      pipelineId: 'p1',
      pluginId: 'fixture',
      batteriesDir,
    })
    expect(runtime.registry.has('fixture.number')).toBe(true)
    expect(runtime.registry.has('fixture.add')).toBe(true)
    expect(runtime.registry.has('fixture.collect')).toBe(true)
    expect(runtime.config.pipelineId).toBe('p1')
  })

  it('skips op scanning when batteriesDir is empty', async () => {
    const runtime = await loadRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'fixture', batteriesDir: '' })
    expect(runtime.registry.list()).toEqual([])
  })

  it('throws CliError(exitCode 2) when a battery has malformed meta.json', async () => {
    const badBatteries = join(scratch, 'bad-batteries')
    const badDir = join(badBatteries, 'broken')
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, 'meta.json'), '{ not valid json')
    writeFileSync(join(badDir, 'index.js'), 'export function broken() { return {} }\n')
    await expect(
      loadRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'fixture', batteriesDir: badBatteries }),
    ).rejects.toMatchObject({ exitCode: 2 })
  })
})
