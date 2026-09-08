// `forgeax project` — list / create / open / delete subcommands.
//
// Mirrors the editor projects modal headlessly: create two projects, open one,
// confirm the active graph reflects it, then delete and confirm the workspace
// stays non-empty. Project commands operate on the workspace under
// --project-root and do NOT require --pipeline-id.

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
  scratch = join(tmpdir(), `forgeax-cli-project-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
// project commands need --project-root + --batteries (template validation) but no --pipeline-id.
const base = (...args: string[]) => [
  'node', 'forgeax', ...args,
  '--project-root', scratch, '--batteries', batteriesDir, '--ndjson',
]

describe('forgeax project', () => {
  it('creates, lists, opens and deletes projects (workspace never empty)', async () => {
    // create A (from a template) and B (empty)
    const tpl = join(scratch, 'tpl.json')
    writeFileSync(
      tpl,
      JSON.stringify({
        format: 'kernel-graph-v1',
        graph: { nodes: [{ id: 's', opId: 'fixture.number', position: { x: 0, y: 0 }, params: { value: 7 } }], edges: [] },
      }),
    )

    let out = captureNdjson()
    await run(base('project', 'create', '--name', 'Alpha', '--type', 'scene', '--from-template', tpl))
    const a = (out().at(-1) as { project: { id: string } }).project
    expect(a.id).toBeTruthy()

    out = captureNdjson()
    await run(base('project', 'create', '--name', 'Beta', '--type', 'scene'))
    const b = (out().at(-1) as { project: { id: string } }).project

    // list shows the backfilled default + A + B
    out = captureNdjson()
    await run(base('project', 'list'))
    const list = (out().at(-1) as { projects: Array<{ id: string }> }).projects
    expect(list.length).toBeGreaterThanOrEqual(3)
    expect(list.some((p) => p.id === a.id)).toBe(true)
    expect(list.some((p) => p.id === b.id)).toBe(true)

    // open A → its templated graph is the active pipeline
    out = captureNdjson()
    await run(base('project', 'open', '--id', a.id))
    const opened = out().at(-1) as { workspace: { activeProjectId: string }; pipeline: { nodes: Record<string, unknown> } }
    expect(opened.workspace.activeProjectId).toBe(a.id)
    expect(Object.keys(opened.pipeline.nodes)).toEqual(['s'])

    // delete A → workspace stays valid + non-empty
    out = captureNdjson()
    await run(base('project', 'delete', '--id', a.id))
    const del = out().at(-1) as { ok: boolean; workspace: { activeProjectId: string } }
    expect(del.ok).toBe(true)
    expect(del.workspace.activeProjectId).toBeTruthy()
    expect(del.workspace.activeProjectId).not.toBe(a.id)
  })
})
