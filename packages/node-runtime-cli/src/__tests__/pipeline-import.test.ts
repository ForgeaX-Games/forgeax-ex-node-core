import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const batteriesDir = join(here, '..', 'fixtures', 'batteries')
let scratch: string
beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-cli-import-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

describe('pipeline import', () => {
  it('imports a kernel-graph-v1 file (replace) and executes it', async () => {
    const file = join(scratch, 'graph.json')
    writeFileSync(
      file,
      JSON.stringify({
        format: 'kernel-graph-v1',
        graph: {
          nodes: [
            { id: 's', opId: 'fixture.number', name: 'Source', position: { x: 0, y: 0 }, params: { value: 3 } },
            { id: 'c', opId: 'fixture.collect', position: { x: 100, y: 0 }, params: {} },
          ],
          edges: [{ id: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'c', port: 'in' } }],
        },
      }),
    )

    const out = captureNdjson()
    await run(base('pipeline', 'import', '--file', file, '--mode', 'replace', '--execute', 'full'))
    const final = out().at(-1) as { status: string; executed?: boolean }
    expect(final.status).toBe('ok')
    expect(final.executed).toBe(true)

    // The imported graph is reflected by pipeline get.
    const out2 = captureNdjson()
    await run(base('pipeline', 'get'))
    const snap = out2().at(-1) as { nodes: Record<string, unknown> }
    expect(Object.keys(snap.nodes).sort()).toEqual(['c', 's'])
  })

  it('rejects an unknown opId with a diagnostic and exit 1', async () => {
    const file = join(scratch, 'bad.json')
    writeFileSync(
      file,
      JSON.stringify({
        format: 'kernel-graph-v1',
        graph: { nodes: [{ id: 'x', opId: 'nope.missing', position: { x: 0, y: 0 }, params: {} }], edges: [] },
      }),
    )
    const out = captureNdjson()
    await expect(run(base('pipeline', 'import', '--file', file))).rejects.toMatchObject({ exitCode: 1 })
    const rec = out().find((r) => (r as { status?: string }).status === 'rejected') as { diagnostics?: Array<{ message: string }> }
    expect(rec.diagnostics?.[0]?.message).toMatch(/unknown opId/)
  })
})
