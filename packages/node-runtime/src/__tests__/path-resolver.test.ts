import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PathResolver } from '../layer1/path-resolver.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-pr-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

function makeResolver(): PathResolver {
  const gameRoot = join(scratchDir, '.forgeax', 'games', 'demo')
  mkdirSync(gameRoot, { recursive: true })
  return new PathResolver({
    pluginId: 'wb-test',
    projectRoot: scratchDir,
    gameRoot,
  })
}

describe('PathResolver', () => {
  it('resolves a manifest default with ${gameRoot} interpolation', () => {
    const r = makeResolver()
    r.registerSlot({
      id: 'wb-test.output.assets',
      default: '${gameRoot}/assets/',
      kind: 'directory',
      access: 'write',
    })
    const out = r.resolve('wb-test.output.assets')
    expect(out).toMatch(/\.forgeax\/games\/demo\/assets/)
  })

  it('honours session override above persisted override', () => {
    const r = makeResolver()
    r.registerSlot({
      id: 'wb-test.scratch',
      default: '${gameRoot}/default/',
      kind: 'directory',
      access: 'write',
    })
    r.setSlot('wb-test.scratch', `${scratchDir}/persisted/`, true)
    expect(r.resolve('wb-test.scratch')).toMatch(/persisted/)
    r.setSlot('wb-test.scratch', `${scratchDir}/session/`, false)
    expect(r.resolve('wb-test.scratch')).toMatch(/session/)
    r.resetSlot('wb-test.scratch') // session only
    expect(r.resolve('wb-test.scratch')).toMatch(/persisted/)
  })

  it('honours FORGEAX_PATH_<NORMALIZED> env var when no override is set', () => {
    const r = makeResolver()
    r.registerSlot({
      id: 'wb-test.output.envpath',
      default: '${gameRoot}/default/',
      kind: 'directory',
      access: 'write',
    })
    process.env.FORGEAX_PATH_WB_TEST_OUTPUT_ENVPATH = `${scratchDir}/from-env/`
    try {
      expect(r.resolve('wb-test.output.envpath')).toMatch(/from-env/)
    } finally {
      delete process.env.FORGEAX_PATH_WB_TEST_OUTPUT_ENVPATH
    }
  })

  it('rejects paths that escape the project root', () => {
    const r = makeResolver()
    r.registerSlot({
      id: 'wb-test.escape',
      default: '/etc/passwd',
      kind: 'file',
      access: 'read',
    })
    expect(() => r.resolve('wb-test.escape')).toThrow(/escapes project root/)
  })

  it('persists changes across resolver instances via paths.config.json', () => {
    const r1 = makeResolver()
    r1.registerSlot({
      id: 'wb-test.persistent',
      default: '${gameRoot}/orig/',
      kind: 'directory',
      access: 'write',
    })
    r1.setSlot('wb-test.persistent', `${scratchDir}/persisted-2/`, true)
    expect(r1.resolve('wb-test.persistent')).toMatch(/persisted-2/)

    // New resolver instance pointed at the same gameRoot picks up paths.config.json.
    const gameRoot = join(scratchDir, '.forgeax', 'games', 'demo')
    expect(existsSync(join(gameRoot, 'paths.config.json'))).toBe(true)

    const r2 = new PathResolver({
      pluginId: 'wb-test',
      projectRoot: scratchDir,
      gameRoot,
    })
    r2.registerSlot({
      id: 'wb-test.persistent',
      default: '${gameRoot}/orig/',
      kind: 'directory',
      access: 'write',
    })
    expect(r2.resolve('wb-test.persistent')).toMatch(/persisted-2/)
  })

  it('lists slots filtered by plugin id namespace', () => {
    const r = makeResolver()
    r.registerSlot({ id: 'wb-test.a', default: '${gameRoot}/a/', kind: 'directory', access: 'write' })
    r.registerSlot({ id: 'wb-test.b', default: '${gameRoot}/b/', kind: 'directory', access: 'write' })
    r.registerSlot({ id: 'wb-other.c', default: '${gameRoot}/c/', kind: 'directory', access: 'write' })
    expect(r.listSlots('wb-test').map((s) => s.id).sort()).toEqual(['wb-test.a', 'wb-test.b'])
    expect(r.listSlots().length).toBe(3)
  })

  it('saves persisted overrides as schemaVersion=1 JSON', () => {
    const r = makeResolver()
    r.registerSlot({
      id: 'wb-test.persisted',
      default: '${gameRoot}/orig/',
      kind: 'directory',
      access: 'write',
    })
    r.setSlot('wb-test.persisted', `${scratchDir}/x/`, true)
    const gameRoot = join(scratchDir, '.forgeax', 'games', 'demo')
    const cfg = JSON.parse(readFileSync(join(gameRoot, 'paths.config.json'), 'utf-8'))
    expect(cfg.schemaVersion).toBe(1)
    expect(cfg.slots['wb-test.persisted']).toMatch(/\/x/)
  })
})
