// Storage layer integration tests against a real tmp filesystem.
//
// Covers:
//   * graph.json hash invariant (load rejects mismatch)
//   * graph.json optimistic-concurrency check (expectedPrevHash)
//   * canonicalize stable across key-order permutations
//   * history.jsonl chain validation
//   * outputs/<id>/<port>.json read/write/invalidate

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  GraphStore,
  HistoryLog,
  OutputCache,
  canonicalize,
  computeGraphHash,
  type GraphFileV1,
  type HistoryEntryV1,
} from '../layer1/index.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

function makeGraph(overrides: Partial<GraphFileV1> = {}): Omit<GraphFileV1, 'hash'> {
  return {
    schemaVersion: 1,
    id: 'test-graph',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    nodes: {
      n1: { id: 'n1', opId: 'plugin.echo', position: { x: 0, y: 0 }, params: {} },
    },
    edges: {},
    ...overrides,
  }
}

describe('canonicalize / computeGraphHash', () => {
  it('produces the same hash regardless of key order', () => {
    const a = makeGraph()
    const b = makeGraph()
    // Wrap b's nodes object with reversed keys to ensure the hash ignores order.
    const reordered = {
      hash: 'placeholder',
      // intentionally pile keys in a different order than makeGraph emits
      edges: b.edges,
      updatedAt: b.updatedAt,
      createdAt: b.createdAt,
      nodes: b.nodes,
      id: b.id,
      schemaVersion: b.schemaVersion,
    }
    expect(computeGraphHash(a)).toEqual(computeGraphHash(reordered as Omit<GraphFileV1, 'hash'>))
  })

  it('canonicalize sorts every nested object', () => {
    const out = canonicalize({ b: 1, a: { z: 2, y: 1 }, c: [{ d: 1, b: 2 }] })
    expect(JSON.stringify(out)).toEqual('{"a":{"y":1,"z":2},"b":1,"c":[{"b":2,"d":1}]}')
  })
})

describe('GraphStore', () => {
  it('round-trips a graph and validates the stored hash', () => {
    const store = new GraphStore(join(scratchDir, 'graph.json'))
    expect(store.exists()).toBe(false)
    const written = store.save(makeGraph())
    expect(written.hash).toMatch(/^[0-9a-f]{64}$/)
    const loaded = store.load()
    expect(loaded).not.toBeNull()
    expect(loaded?.id).toBe('test-graph')
    expect(loaded?.hash).toBe(written.hash)
  })

  it('rejects an externally edited file (hash mismatch)', () => {
    const path = join(scratchDir, 'graph.json')
    const store = new GraphStore(path)
    store.save(makeGraph())
    // Tamper with the file: change a node's position without touching the hash.
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as GraphFileV1
    raw.nodes.n1.position = { x: 999, y: 999 }
    writeFileSync(path, JSON.stringify(raw, null, 2), 'utf-8')
    expect(() => store.load()).toThrow(/hash mismatch/)
  })

  it('honours expectedPrevHash for concurrent-write detection', () => {
    const store = new GraphStore(join(scratchDir, 'graph.json'))
    const v1 = store.save(makeGraph())
    // Simulate a second writer racing in under us.
    const racer = makeGraph({ updatedAt: '2026-01-02T00:00:00Z' })
    store.save(racer)
    // Now we try to save based on the (stale) v1.hash:
    expect(() => store.save(makeGraph({ updatedAt: '2026-01-03T00:00:00Z' }), { expectedPrevHash: v1.hash })).toThrow(
      /concurrent-write/,
    )
  })
})

describe('HistoryLog', () => {
  function entry(prev: string, next: string, ts = '2026-01-01T00:00:00Z'): HistoryEntryV1 {
    return {
      schemaVersion: 1,
      ts,
      actor: 'user',
      batchId: `b-${prev.slice(0, 4)}-${next.slice(0, 4)}`,
      prevHash: prev,
      newHash: next,
      ops: [{ kind: 'noop' }],
    }
  }

  it('appends entries and reports the tip hash', () => {
    const log = new HistoryLog(join(scratchDir, 'history.jsonl'))
    expect(log.exists()).toBe(false)
    expect(log.tipHash()).toBeUndefined()

    log.append(entry('aaaa', 'bbbb'))
    log.append(entry('bbbb', 'cccc'))
    expect(log.exists()).toBe(true)
    expect(log.tipHash()).toBe('cccc')
    expect(log.readAll()).toHaveLength(2)
  })

  it('detects a broken chain', () => {
    const log = new HistoryLog(join(scratchDir, 'history.jsonl'))
    log.append(entry('aaaa', 'bbbb'))
    log.append(entry('XXXX', 'cccc')) // intentional mismatch
    const v = log.validate()
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.reason).toMatch(/chain break/)
      expect(v.lineIndex).toBe(1)
    }
  })

  it('validates against an external expected tip hash', () => {
    const log = new HistoryLog(join(scratchDir, 'history.jsonl'))
    log.append(entry('aaaa', 'bbbb'))
    log.append(entry('bbbb', 'cccc'))
    expect(log.validate({ expectedTipHash: 'cccc' })).toEqual({ ok: true })
    const bad = log.validate({ expectedTipHash: 'WRONG' })
    expect(bad.ok).toBe(false)
  })

  it('streams entries lazily', () => {
    const log = new HistoryLog(join(scratchDir, 'history.jsonl'))
    log.append(entry('aaaa', 'bbbb'))
    log.append(entry('bbbb', 'cccc'))
    log.append(entry('cccc', 'dddd'))
    const seen: string[] = []
    for (const e of log.stream()) seen.push(e.newHash)
    expect(seen).toEqual(['bbbb', 'cccc', 'dddd'])
  })
})

describe('OutputCache', () => {
  it('writes and reads a JSON entry', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    cache.write('n1', 'out1', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'string',
      data: { foo: 'bar' },
    })
    const got = cache.read('n1', 'out1')
    expect(got?.valid).toBe(true)
    expect((got?.data as { foo: string }).foo).toBe('bar')
  })

  it('writes a sibling .bin payload when one is provided', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    const payload = Buffer.from([0x01, 0x02, 0x03, 0x04])
    cache.write(
      'n1',
      'tex',
      { valid: true, executedAt: '2026-01-01T00:00:00Z', executedHash: 'abc', type: 'image' },
      payload,
    )
    const got = cache.read('n1', 'tex')
    expect(got?.binFile).toBe('tex.bin')
    expect(readFileSync(cache.binPath('n1', 'tex'))).toEqual(payload)
  })

  it('invalidates a node by removing its directory', () => {
    const cache = new OutputCache(join(scratchDir, 'outputs'))
    cache.write('n1', 'out1', {
      valid: true,
      executedAt: '2026-01-01T00:00:00Z',
      executedHash: 'abc',
      type: 'string',
    })
    expect(cache.read('n1', 'out1')).not.toBeNull()
    cache.invalidate('n1')
    expect(cache.read('n1', 'out1')).toBeNull()
  })
})
