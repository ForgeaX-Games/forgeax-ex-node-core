// Asset-resolver — exercises read/write/list/remove against a real tmp dir.
// Watching is exercised separately because it's debounced + async; the test
// harness covers list/read/write semantics and path-escape rejection.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAssetResolver } from '../layer1/index.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-assets-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('asset-resolver', () => {
  it('lists assets under typed prefixes', () => {
    mkdirSync(join(scratchDir, 'textures'), { recursive: true })
    mkdirSync(join(scratchDir, 'scenes'), { recursive: true })
    writeFileSync(join(scratchDir, 'textures', 'a.png'), Buffer.from([1, 2]))
    writeFileSync(join(scratchDir, 'textures', 'b.png'), Buffer.from([3, 4]))
    writeFileSync(join(scratchDir, 'scenes', 's.scene.json'), '{}')

    const r = createAssetResolver({ root: scratchDir, types: ['textures', 'scenes'] })
    const all = r.list()
    expect(all.length).toBe(3)

    const tex = r.list({ type: 'textures' })
    expect(tex.map((d) => d.relPath).sort()).toEqual(['textures/a.png', 'textures/b.png'])

    const png = r.list({ suffix: '.png' })
    expect(png.length).toBe(2)
  })

  it('round-trips read/write and creates parent dirs', () => {
    const r = createAssetResolver({ root: scratchDir })
    const desc = r.write('textures/sub/c.png', Buffer.from([9, 9, 9]))
    expect(desc.relPath).toBe('textures/sub/c.png')
    expect(desc.type).toBe('textures')
    const got = r.read('textures/sub/c.png')
    expect(got).not.toBeNull()
    expect(Array.from(got as Buffer)).toEqual([9, 9, 9])
  })

  it('refuses to escape the root', () => {
    const r = createAssetResolver({ root: scratchDir })
    expect(() => r.read('../escape.txt')).toThrow(/escapes root/)
    expect(() => r.write('../bad.txt', Buffer.from([0]))).toThrow(/escapes root/)
    expect(() => r.read('/abs/path')).toThrow(/absolute/)
  })

  it('returns null for missing assets', () => {
    const r = createAssetResolver({ root: scratchDir })
    expect(r.read('textures/nothing.png')).toBeNull()
  })

  it('removes assets idempotently', () => {
    const r = createAssetResolver({ root: scratchDir })
    r.write('a.txt', Buffer.from('hi'))
    expect(r.read('a.txt')).not.toBeNull()
    r.remove('a.txt')
    expect(r.read('a.txt')).toBeNull()
    // second remove is a no-op, must not throw
    r.remove('a.txt')
  })
})
