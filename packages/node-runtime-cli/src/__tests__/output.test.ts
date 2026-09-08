import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeEmitter } from '../output.js'

describe('makeEmitter', () => {
  afterEach(() => vi.restoreAllMocks())

  it('ndjson mode writes one compact JSON line per record', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const emit = makeEmitter('ndjson')
    emit.record({ a: 1 })
    emit.record({ b: 2 })
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['{"a":1}\n', '{"b":2}\n'])
  })

  it('json mode pretty-prints each record', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const emit = makeEmitter('json')
    emit.record({ a: 1 })
    expect(spy.mock.calls[0]![0]).toBe(JSON.stringify({ a: 1 }, null, 2) + '\n')
  })
})
