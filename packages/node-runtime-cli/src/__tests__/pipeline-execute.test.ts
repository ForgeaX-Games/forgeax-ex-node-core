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
  scratch = join(tmpdir(), `forgeax-cli-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

async function seed(): Promise<void> {
  // number(3) -> collect
  await run(base('node', 'create', '--node-id', 's', '--op', 'fixture.number', '--params', '{"value":3}'))
  await run(base('node', 'create', '--node-id', 'c', '--op', 'fixture.collect'))
  await run(base('node', 'connect', '--edge-id', 'e1', '--from', 's:out', '--to', 'c:in'))
}

describe('pipeline execute', () => {
  it('streams exec:* events then a final result, all completed', async () => {
    await seed()
    const out = captureNdjson()
    await run(base('pipeline', 'execute'))
    const records = out()
    const kinds = records.filter((r) => (r as { kind?: string }).kind).map((r) => (r as { kind: string }).kind)
    // number(3) -> collect: started, one output per node, then completed.
    expect(kinds).toEqual(['exec:started', 'exec:node:output', 'exec:node:output', 'exec:completed'])
    const final = records[records.length - 1] as { result?: { status: string } }
    expect(final.result).toBeDefined()
    expect(final.result!.status).toBe('completed')
  })

  it('emits a structured error record and exits 1 on a cyclic graph', async () => {
    // a -> b -> a using collect nodes (no real source); cycle rejects pre-flight.
    await run(base('node', 'create', '--node-id', 'a', '--op', 'fixture.collect'))
    await run(base('node', 'create', '--node-id', 'b', '--op', 'fixture.collect'))
    await run(base('node', 'connect', '--edge-id', 'e1', '--from', 'a:out', '--to', 'b:in'))
    await run(base('node', 'connect', '--edge-id', 'e2', '--from', 'b:out', '--to', 'a:in'))
    const out = captureNdjson()
    await expect(run(base('pipeline', 'execute'))).rejects.toMatchObject({ exitCode: 1 })
    // The validation reject must still surface as a structured record on stdout
    // (not just stderr), so NDJSON consumers see the failure.
    const errRec = out().find((r) => (r as { result?: { status?: string } }).result?.status === 'error')
    expect(errRec).toBeDefined()
    expect((errRec as { result: { error: { message: string } } }).result.error.message).toMatch(/cycle/)
  })
})
