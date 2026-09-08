// ProjectRegistry — multi-project CRUD + activate/open cascade.
//
// Covers: create→list→activate→delete lifecycle; activate swaps the active
// graph so subsequent applyBatch / queries hit the right project's isolated
// storage; per-project history isolation; fromTemplate seeds via the kernel
// importPipelineGraph; and default-project backfill that adopts an existing
// implicit `<root>/state/graph.json` in place (current work survives).

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyBatch,
  createRuntime,
  getHistory,
  getPipeline,
  ProjectRegistry,
} from '../layer2/index.js'
import type { ProjectRuntimeFactory } from '../layer2/index.js'
import { OpRegistry } from '../layer1/op-registry.js'
import type { OpSpec } from '../layer1/types/op-spec.js'

let root: string

beforeEach(() => {
  root = join(tmpdir(), `forgeax-projects-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function op(id: string): OpSpec {
  return {
    id,
    name: id,
    inputs: [{ name: 'in', type: 'any' }],
    outputs: [{ name: 'out', type: 'any' }],
    params: [],
    execute: () => null,
  }
}

/** A shared OpRegistry + a factory that builds isolated per-project runtimes. */
function makeFactory(opIds: string[] = ['demo.a', 'demo.b']): {
  registry: OpRegistry
  factory: ProjectRuntimeFactory
} {
  const registry = new OpRegistry()
  for (const id of opIds) registry.register(op(id))
  const factory: ProjectRuntimeFactory = (req) =>
    createRuntime({
      projectRoot: root,
      pipelineId: req.pipelineId,
      pluginId: 'plugin.test',
      registry,
      layout: {
        graphFile: req.graphFile,
        historyFile: req.historyFile,
        outputsDir: req.outputsDir,
      },
    })
  return { registry, factory }
}

function makeRegistry(opIds?: string[]): ProjectRegistry {
  const { factory } = makeFactory(opIds)
  return new ProjectRegistry({
    workspaceRoot: root,
    createRuntime: factory,
    defaultType: 'scene',
    defaultProjectName: 'Default Scene',
    defaultProjectId: 'main',
  })
}

describe('ProjectRegistry — backfill', () => {
  it('creates a default project on first init', () => {
    const reg = makeRegistry()
    reg.init()
    const list = reg.listProjects()
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe('main')
    expect(list[0]!.type).toBe('scene')
    expect(reg.getWorkspace().activeProjectId).toBe('main')
    expect(reg.getWorkspace().recentProjectIds).toEqual(['main'])
  })

  it('adopts an existing implicit <root>/state/graph.json in place (work survives)', async () => {
    // Seed the legacy implicit pipeline directly at <root>/state/graph.json.
    const { registry } = makeFactory()
    const legacy = createRuntime({
      projectRoot: root,
      pipelineId: 'main',
      pluginId: 'plugin.test',
      registry,
    })
    await applyBatch(legacy, [
      { type: 'createNode', nodeId: 'legacy1', opId: 'demo.a', position: { x: 1, y: 2 }, params: {} },
    ])
    expect(existsSync(join(root, 'state', 'graph.json'))).toBe(true)

    // A fresh registry must adopt that graph as the default project.
    const reg = makeRegistry()
    reg.init()
    expect(reg.listProjects()).toHaveLength(1)
    const snap = getPipeline(reg.getActiveRuntime())!
    expect(snap.nodes.legacy1).toBeDefined()
    expect(snap.nodes.legacy1!.opId).toBe('demo.a')
  })
})

describe('ProjectRegistry — lifecycle + activate swap', () => {
  it('create → list → activate → delete, with isolated graphs per project', async () => {
    const reg = makeRegistry()
    reg.init()

    const a = await reg.createProject({ type: 'scene', name: 'Project A' })
    const b = await reg.createProject({ type: 'scene', name: 'Project B' })
    expect(reg.listProjects().map((p) => p.id).sort()).toEqual(['main', a.id, b.id].sort())

    // Put a distinct graph into each project's storage via the active runtime.
    reg.activateProject(a.id)
    await applyBatch(reg.getActiveRuntime(), [
      { type: 'createNode', nodeId: 'aNode', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} },
    ])

    reg.activateProject(b.id)
    await applyBatch(reg.getActiveRuntime(), [
      { type: 'createNode', nodeId: 'bNode', opId: 'demo.b', position: { x: 5, y: 5 }, params: {} },
    ])

    // Activate A: the active graph must reflect A only.
    reg.activateProject(a.id)
    let snap = getPipeline(reg.getActiveRuntime())!
    expect(Object.keys(snap.nodes)).toEqual(['aNode'])
    expect(reg.getWorkspace().activeProjectId).toBe(a.id)

    // Activate B: the active graph must reflect B only.
    reg.activateProject(b.id)
    snap = getPipeline(reg.getActiveRuntime())!
    expect(Object.keys(snap.nodes)).toEqual(['bNode'])

    // A subsequent applyBatch lands in the active (B) project's storage.
    await applyBatch(reg.getActiveRuntime(), [
      { type: 'createNode', nodeId: 'bNode2', opId: 'demo.a', position: { x: 9, y: 9 }, params: {} },
    ])
    expect(Object.keys(getPipeline(reg.getRuntimeFor(b.id))!.nodes).sort()).toEqual(['bNode', 'bNode2'])
    expect(Object.keys(getPipeline(reg.getRuntimeFor(a.id))!.nodes)).toEqual(['aNode'])

    // Delete B (the active one) → falls back to another project, never empty.
    await reg.deleteProject(b.id)
    expect(reg.listProjects().some((p) => p.id === b.id)).toBe(false)
    expect(reg.getWorkspace().activeProjectId).not.toBe(b.id)
    expect(reg.getWorkspace().activeProjectId).toBeTruthy()
  })

  it('isolates per-project history (history.jsonl is per project)', async () => {
    const reg = makeRegistry()
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })

    reg.activateProject(a.id)
    await applyBatch(reg.getActiveRuntime(), [
      { type: 'createNode', nodeId: 'a1', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} },
    ], { actor: 'ai:a', label: 'A op' })

    reg.activateProject(b.id)
    await applyBatch(reg.getActiveRuntime(), [
      { type: 'createNode', nodeId: 'b1', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} },
    ], { actor: 'ai:b', label: 'B op' })

    const histA = getHistory(reg.getRuntimeFor(a.id))
    const histB = getHistory(reg.getRuntimeFor(b.id))
    expect(histA).toHaveLength(1)
    expect(histB).toHaveLength(1)
    expect(histA.at(-1)!.label).toBe('A op')
    expect(histB.at(-1)!.label).toBe('B op')
  })

  it('seeds a new project graph from a template via importPipelineGraph', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({
      name: 'From Template',
      fromTemplate: {
        format: 'kernel-graph-v1',
        graph: {
          nodes: [
            { id: 't1', opId: 'demo.a', position: { x: 0, y: 0 }, params: { seeded: true } },
            { id: 't2', opId: 'demo.b', position: { x: 1, y: 1 }, params: {} },
          ],
          edges: [{ id: 'e1', source: { nodeId: 't1', port: 'out' }, target: { nodeId: 't2', port: 'in' } }],
        },
      },
    })
    const snap = getPipeline(reg.getRuntimeFor(p.id))!
    expect(Object.keys(snap.nodes).sort()).toEqual(['t1', 't2'])
    expect(snap.nodes.t1!.params).toEqual({ seeded: true })
    expect(Object.keys(snap.edges)).toEqual(['e1'])
    // The seed is recorded in the new project's own history.
    expect(getHistory(reg.getRuntimeFor(p.id)).length).toBeGreaterThan(0)
  })

  it('bootstraps an empty (but readable) graph for a non-template project', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'Empty' })
    const snap = getPipeline(reg.getRuntimeFor(p.id))!
    expect(snap.id).toBe(p.id)
    expect(snap.nodes).toEqual({})
    expect(snap.edges).toEqual({})
  })

  it('persists index + workspace across registry instances', async () => {
    const reg1 = makeRegistry()
    reg1.init()
    const p = await reg1.createProject({ name: 'Persisted' })
    reg1.activateProject(p.id)

    const reg2 = makeRegistry()
    reg2.init()
    expect(reg2.listProjects().some((x) => x.id === p.id)).toBe(true)
    expect(reg2.getWorkspace().activeProjectId).toBe(p.id)
  })
})

describe('ProjectRegistry — exclusive per-agent lock', () => {
  const ai = (agentId: string) => ({ kind: 'ai' as const, agentId })

  it('humans (kind!=ai) always bypass the lock', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    expect(reg.acquireProjectLock(p.id, { kind: 'user' })).toEqual({ ok: true })
    // No lock recorded for a human.
    expect(reg.getProjectLock(p.id)).toBeNull()
    expect(reg.checkMutationAccess(p.id, { kind: 'user' })).toEqual({ ok: true })
  })

  it('a second agent cannot open a project held by another', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    expect(reg.acquireProjectLock(p.id, ai('A'))).toEqual({ ok: true })
    expect(reg.getProjectLock(p.id)?.agentId).toBe('A')
    const blocked = reg.acquireProjectLock(p.id, ai('B'))
    expect(blocked.ok).toBe(false)
    expect((blocked as { reason: string }).reason).toMatch(/^project-locked-by-other/)
    // Re-acquire by the same agent is idempotent.
    expect(reg.acquireProjectLock(p.id, ai('A'))).toEqual({ ok: true })
  })

  it('an agent cannot open a second project until it closes the first', async () => {
    const reg = makeRegistry()
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })
    expect(reg.acquireProjectLock(a.id, ai('A'))).toEqual({ ok: true })
    const blocked = reg.acquireProjectLock(b.id, ai('A'))
    expect(blocked.ok).toBe(false)
    expect((blocked as { reason: string }).reason).toMatch(/^agent-holds-another/)
    // Release A, then B opens.
    expect(reg.releaseProjectLock(a.id, ai('A'))).toEqual({ ok: true })
    expect(reg.acquireProjectLock(b.id, ai('A'))).toEqual({ ok: true })
  })

  it('rejects a release from the wrong agent; missing agentId is rejected', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    reg.acquireProjectLock(p.id, ai('A'))
    const wrong = reg.releaseProjectLock(p.id, ai('B'))
    expect(wrong.ok).toBe(false)
    expect((wrong as { reason: string }).reason).toMatch(/^lock-not-owned/)
    const noAgent = reg.acquireProjectLock(p.id, { kind: 'ai' })
    expect(noAgent.ok).toBe(false)
    expect((noAgent as { reason: string }).reason).toMatch(/^lock-requires-agent-id/)
  })

  it('checkMutationAccess: only the holding agent may mutate its active project', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    // No lock yet → an AI mutation is denied (must open first).
    expect(reg.checkMutationAccess(p.id, ai('A')).ok).toBe(false)
    reg.acquireProjectLock(p.id, ai('A'))
    expect(reg.checkMutationAccess(p.id, ai('A'))).toEqual({ ok: true })
    expect(reg.checkMutationAccess(p.id, ai('B')).ok).toBe(false)
    // Humans always pass regardless of who holds it.
    expect(reg.checkMutationAccess(p.id, { kind: 'workbench' })).toEqual({ ok: true })
  })

  it('deleting a locked project releases its lock', async () => {
    const reg = makeRegistry()
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })
    reg.acquireProjectLock(a.id, ai('A'))
    await reg.deleteProject(a.id)
    expect(reg.getProjectLock(a.id)).toBeNull()
    // The agent is free to open a different project now.
    expect(reg.acquireProjectLock(b.id, ai('A'))).toEqual({ ok: true })
  })
})

describe('ProjectRegistry — delete asset hook', () => {
  it('forwards the asset policy to the app-supplied hook', async () => {
    const { factory } = makeFactory()
    const calls: Array<{ id: string; policy: string }> = []
    const reg = new ProjectRegistry({
      workspaceRoot: root,
      createRuntime: factory,
      defaultType: 'scene',
      defaultProjectId: 'main',
      onDeleteProjectAssets: (id, policy) => {
        calls.push({ id, policy })
      },
    })
    reg.init()
    const p = await reg.createProject({ name: 'Disposable' })
    await reg.deleteProject(p.id, { assetPolicy: 'delete' })
    expect(calls).toEqual([{ id: p.id, policy: 'delete' }])
  })
})