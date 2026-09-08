import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const batteriesDir = join(here, '..', 'fixtures', 'batteries')
let scratch: string
beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-cli-accept-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratch, { recursive: true })
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  vi.restoreAllMocks()
})
function captureNdjson(): () => unknown[] {
  const lines: unknown[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    String(chunk).split('\n').filter(Boolean).forEach((l) => lines.push(JSON.parse(l)))
    return true
  })
  return () => lines
}
const base = (...args: string[]) => [
  'node', 'forgeax', ...args,
  '--pipeline-id', 'p1', '--project-root', scratch, '--batteries', batteriesDir, '--ndjson',
]

function finalResult(records: unknown[]): { status: string; outputs: Record<string, unknown> } {
  return (records[records.length - 1] as { result: { status: string; outputs: Record<string, unknown> } }).result
}

describe('North-Star headless loop (steps 1-4, 6) — determinism', () => {
  it('builds a 3-node pipeline, executes twice, identical outputs', async () => {
    // number(3) -> add.a ; number(4) -> add.b ; add.sum -> collect.in
    await run(base('node', 'create', '--node-id', 'n1', '--op', 'fixture.number', '--params', '{"value":3}'))
    await run(base('node', 'create', '--node-id', 'n2', '--op', 'fixture.number', '--params', '{"value":4}'))
    await run(base('node', 'create', '--node-id', 'sum', '--op', 'fixture.add'))
    await run(base('node', 'create', '--node-id', 'c', '--op', 'fixture.collect'))
    await run(base('node', 'connect', '--edge-id', 'e1', '--from', 'n1:out', '--to', 'sum:a'))
    await run(base('node', 'connect', '--edge-id', 'e2', '--from', 'n2:out', '--to', 'sum:b'))
    await run(base('node', 'connect', '--edge-id', 'e3', '--from', 'sum:sum', '--to', 'c:in'))

    const out1 = captureNdjson()
    await run(base('pipeline', 'execute'))
    const r1 = finalResult(out1())

    const out2 = captureNdjson()
    await run(base('pipeline', 'execute'))
    const r2 = finalResult(out2())

    expect(r1.status).toBe('completed')
    expect(r2.status).toBe('completed')
    // collect produced 3 + 4 = 7
    const cOut = r1.outputs.c as { out: Array<{ items: unknown[] }> }
    expect(cOut.out[0]!.items).toEqual([7])
    // determinism: identical outputs across runs
    expect(JSON.stringify(r1.outputs)).toBe(JSON.stringify(r2.outputs))
  })
})
