import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../index.js'

let scratch: string
beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-cli-pl-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
const base = (...args: string[]) => ['node', 'forgeax', ...args, '--pipeline-id', 'p1', '--project-root', scratch, '--ndjson']

describe('pipeline get / apply', () => {
  it('apply runs a raw batch and get returns the snapshot', async () => {
    const ops = JSON.stringify([
      { type: 'createNode', nodeId: 'n1', opId: 'fixture.number', position: { x: 0, y: 0 }, params: { value: 9 } },
    ])
    const out = captureNdjson()
    await run(base('pipeline', 'apply', '--ops', ops))
    expect((out()[0] as { status: string }).status).toBe('ok')

    const out2 = captureNdjson()
    await run(base('pipeline', 'get'))
    const snap = out2()[0] as { nodes: Record<string, unknown> }
    expect(Object.keys(snap.nodes)).toEqual(['n1'])
  })

  it('apply rejects a malformed batch and exits non-zero', async () => {
    await expect(run(base('pipeline', 'apply', '--ops', '{"not":"an array"}'))).rejects.toMatchObject({ exitCode: 2 })
  })

  it('apply with a semantically invalid op (delete missing node) rejects and exits 1', async () => {
    const out = captureNdjson()
    const ops = JSON.stringify([{ type: 'deleteNode', nodeId: 'ghost' }])
    await expect(run(base('pipeline', 'apply', '--ops', ops))).rejects.toMatchObject({ exitCode: 1 })
    // the rejected result is still emitted before the throw, for machine consumers
    expect((out()[0] as { status: string }).status).toBe('rejected')
  })
})
