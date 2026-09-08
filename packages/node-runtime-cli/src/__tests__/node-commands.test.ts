import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../index.js'

let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-cli-node-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratch, { recursive: true })
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function captureNdjson(): () => unknown[] {
  const lines: unknown[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    String(chunk)
      .split('\n')
      .filter(Boolean)
      .forEach((l) => lines.push(JSON.parse(l)))
    return true
  })
  return () => lines
}

const base = (...args: string[]) => [
  'node', 'forgeax', ...args,
  '--pipeline-id', 'p1', '--project-root', scratch, '--ndjson',
]

describe('node commands', () => {
  it('create emits status ok and persists the node', async () => {
    const out = captureNdjson()
    await run(base('node', 'create', '--node-id', 'n1', '--op', 'fixture.number', '--params', '{"value":3}'))
    expect((out()[0] as { status: string }).status).toBe('ok')

    // Read back via pipeline get.
    const out2 = captureNdjson()
    await run(base('pipeline', 'get'))
    const snap = out2()[0] as { nodes: Record<string, { opId: string }> }
    expect(snap.nodes.n1!.opId).toBe('fixture.number')
  })

  it('connect adds an edge between two created nodes', async () => {
    await run(base('node', 'create', '--node-id', 'a', '--op', 'fixture.number', '--params', '{"value":1}'))
    await run(base('node', 'create', '--node-id', 'c', '--op', 'fixture.collect'))
    const out = captureNdjson()
    await run(base('node', 'connect', '--edge-id', 'e1', '--from', 'a:out', '--to', 'c:in'))
    expect((out()[0] as { status: string }).status).toBe('ok')
  })

  it('delete removes a node', async () => {
    await run(base('node', 'create', '--node-id', 'x', '--op', 'fixture.number'))
    const out = captureNdjson()
    await run(base('node', 'delete', '--node-id', 'x'))
    expect((out()[0] as { status: string }).status).toBe('ok')
  })

  it('update changes a node param (read back via get)', async () => {
    await run(base('node', 'create', '--node-id', 'u', '--op', 'fixture.number', '--params', '{"value":1}'))
    const out = captureNdjson()
    await run(base('node', 'update', '--node-id', 'u', '--params', '{"value":2}'))
    expect((out()[0] as { status: string }).status).toBe('ok')

    const out2 = captureNdjson()
    await run(base('pipeline', 'get'))
    const snap = out2()[0] as { nodes: Record<string, { params: { value: number } }> }
    expect(snap.nodes.u!.params.value).toBe(2)
  })

  it('disconnect removes an edge (read back via get)', async () => {
    await run(base('node', 'create', '--node-id', 'a', '--op', 'fixture.number'))
    await run(base('node', 'create', '--node-id', 'c', '--op', 'fixture.collect'))
    await run(base('node', 'connect', '--edge-id', 'e1', '--from', 'a:out', '--to', 'c:in'))
    const out = captureNdjson()
    await run(base('node', 'disconnect', '--edge-id', 'e1'))
    expect((out()[0] as { status: string }).status).toBe('ok')

    const out2 = captureNdjson()
    await run(base('pipeline', 'get'))
    const snap = out2()[0] as { edges: Record<string, unknown> }
    expect(Object.keys(snap.edges)).toEqual([])
  })

  it('a missing --node-id throws CliError(exitCode 2)', async () => {
    await expect(run(base('node', 'create', '--op', 'fixture.number'))).rejects.toMatchObject({ exitCode: 2 })
  })
})
