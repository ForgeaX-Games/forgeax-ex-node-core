// projectStore — the faithful open cascade reuses the live-sync machinery.
//
// Proves switchProject():
//   1. calls the transport activateProject (server swaps the active runtime),
//   2. drives loadPipeline() so pipelineRevision bumps (→ useCanvasGraphSync
//      reconcile rebuild) and currentPipeline reflects the OPENED project,
//   3. clears the undo history (it must not cross projects),
//   4. resets the node-output cache,
//   5. sets the active project type (keeps the battery filter correct).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ApiClient,
  PipelineSnapshot,
  ProjectMeta,
  ProjectRecord,
  RuntimeChannel,
  RuntimeEvent,
  WorkspaceState,
} from '@forgeax/node-runtime'
import type { ActivateProjectResult, CreateProjectRequest } from '../../api/ApiClient.js'

import { configureEditorTransport, createEditorTransport, type EditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import { useUIStore } from '../stores/uiStore.js'
import { useProjectStore } from '../stores/projectStore.js'

function snap(id: string, nodeId: string): PipelineSnapshot {
  return {
    id,
    hash: `${id}-hash`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: { [nodeId]: { id: nodeId, opId: 'a.one', name: nodeId, position: { x: 0, y: 0 }, params: {} } },
    edges: {},
  }
}

/** A minimal in-memory ApiClient with the project surface + per-project graphs. */
function makeClient(): ApiClient {
  const graphs: Record<string, PipelineSnapshot> = {
    p1: snap('p1', 'oneNode'),
    p2: snap('p2', 'twoNode'),
  }
  const metas: Record<string, ProjectMeta> = {
    p1: { id: 'p1', type: 'scene', name: 'P1', description: '', createdAt: '', updatedAt: '' },
    p2: { id: 'p2', type: 'lowpoly', name: 'P2', description: '', createdAt: '', updatedAt: '' },
  }
  let active = 'p1'
  const recent = ['p1']
  return {
    pipelineId: 'main',
    applyBatch: async () => ({ status: 'ok', newHash: 'h', batchId: 'b' }),
    execute: async () => ({ status: 'completed' }) as never,
    getPipeline: async () => graphs[active] ?? null,
    getNode: async () => null,
    listNodes: async () => Object.values(graphs[active]?.nodes ?? {}),
    listEdges: async () => [],
    getNodeOutput: async () => undefined,
    getHistory: async () => [],
    listOps: async () => [],
    getGroup: async () => null,
    listGroups: async () => [],
    subscribe: (_c: RuntimeChannel, _l: (e: RuntimeEvent) => void) => () => {},
    resolveAssetPath: async (t: string) => t,
    listProjects: async () => Object.values(metas),
    getProject: async (id: string): Promise<ProjectRecord | null> =>
      metas[id] ? { manifest: { schemaVersion: 1, ...metas[id], storage: { graphFile: '', historyFile: '', outputsDir: '' } } } : null,
    createProject: async (_req: CreateProjectRequest) => metas.p2,
    updateProject: async (id: string) => metas[id],
    deleteProject: async () => ({ ok: true as const, workspace: { activeProjectId: active, recentProjectIds: recent, lastOpenedAt: '' } }),
    activateProject: async (id: string): Promise<ActivateProjectResult> => {
      active = id
      if (!recent.includes(id)) recent.unshift(id)
      return {
        project: { manifest: { schemaVersion: 1, ...metas[id], storage: { graphFile: '', historyFile: '', outputsDir: '' } } },
        pipeline: graphs[id] ?? null,
      }
    },
    getWorkspace: async (): Promise<WorkspaceState> => ({ activeProjectId: active, recentProjectIds: recent, lastOpenedAt: '' }),
    setWorkspace: async (): Promise<WorkspaceState> => ({ activeProjectId: active, recentProjectIds: recent, lastOpenedAt: '' }),
  }
}

let transport: EditorTransport

beforeEach(() => {
  transport = createEditorTransport(makeClient())
  configureEditorTransport(transport)
  usePipelineStore.setState({
    currentPipeline: null,
    pipelineRevision: 0,
    nodeOutputs: {},
    dynamicOutputPorts: {},
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
  useProjectStore.setState({ projects: [], activeProjectId: null, recentProjectIds: [], isSwitching: false })
})

afterEach(() => {
  transport.dispose()
  configureEditorTransport(null)
})

describe('projectStore open cascade', () => {
  it('switchProject swaps the graph via loadPipeline (revision++) and clears history', async () => {
    // Seed a stale undo entry + node output to prove they are reset on switch.
    useHistoryStore.setState({ entries: [{ id: 'x' } as never], cursor: 1, _redoTip: null })
    usePipelineStore.setState({ nodeOutputs: { ghost: { out: 1 } } })
    const revBefore = usePipelineStore.getState().pipelineRevision

    await useProjectStore.getState().switchProject('p2')

    const pipe = usePipelineStore.getState()
    expect(pipe.currentPipeline?.id).toBe('p2')
    expect(pipe.currentPipeline?.nodes.some((n) => n.id === 'twoNode')).toBe(true)
    expect(pipe.pipelineRevision).toBeGreaterThan(revBefore)
    expect(pipe.nodeOutputs.ghost).toBeUndefined()
    expect(useHistoryStore.getState().entries).toHaveLength(0)
    expect(useUIStore.getState().activeProjectType).toBe('lowpoly')
    expect(useProjectStore.getState().activeProjectId).toBe('p2')
  })

  it('fetchProjects loads the list + syncs the active project type', async () => {
    await useProjectStore.getState().fetchProjects()
    expect(useProjectStore.getState().projects.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    expect(useProjectStore.getState().activeProjectId).toBe('p1')
    expect(useUIStore.getState().activeProjectType).toBe('scene')
  })
})

describe('projectStore cross-client sync (subscribeProjectActivation)', () => {
  // Build a client whose `subscribe` captures channel listeners so the test can
  // emit a `project:activated` as if the backend broadcast it (e.g. the left
  // pane / an agent switched the project), and count activateProject calls.
  // `setServerActive` mutates the backing active project WITHOUT going through
  // this client's activateProject — modelling the fact that ANOTHER client
  // already activated server-side before the broadcast reached us.
  function makeCapturingTransport(): {
    listeners: Record<string, Set<(e: RuntimeEvent) => void>>
    activateCalls: () => number
    setServerActive: (id: string) => Promise<void>
  } {
    const base = makeClient()
    const listeners: Record<string, Set<(e: RuntimeEvent) => void>> = {}
    let activateCalls = 0
    const client: ApiClient = {
      ...base,
      activateProject: async (id: string) => {
        activateCalls++
        return base.activateProject!(id)
      },
      subscribe: (c: RuntimeChannel, l: (e: RuntimeEvent) => void) => {
        ;(listeners[c] ??= new Set()).add(l)
        return () => listeners[c]?.delete(l)
      },
    }
    transport.dispose()
    configureEditorTransport(null)
    transport = createEditorTransport(client)
    configureEditorTransport(transport)
    return {
      listeners,
      activateCalls: () => activateCalls,
      // Flip the backing store's active project via the UNWRAPPED activateProject
      // (does not bump our counter) — models another client having switched
      // server-side before the broadcast reaches us.
      setServerActive: async (id) => {
        await base.activateProject!(id)
      },
    }
  }

  function emitProjectActivated(
    listeners: Record<string, Set<(e: RuntimeEvent) => void>>,
    projectId: string,
  ): void {
    // project:activated rides the 'graph' channel (client demux).
    for (const l of listeners.graph ?? []) {
      l({ kind: 'project:activated', projectId, pipelineId: projectId, newHash: `${projectId}-hash` } as RuntimeEvent)
    }
  }

  it('re-syncs to a project activated elsewhere WITHOUT re-calling activateProject', async () => {
    const { listeners, activateCalls, setServerActive } = makeCapturingTransport()
    await useProjectStore.getState().fetchProjects()
    expect(useProjectStore.getState().activeProjectId).toBe('p1')

    const unsub = useProjectStore.getState().subscribeProjectActivation()
    const revBefore = usePipelineStore.getState().pipelineRevision
    const callsBefore = activateCalls()

    // Another client switched the server to p2, then the backend broadcast it.
    await setServerActive('p2')
    emitProjectActivated(listeners, 'p2')

    // Wait for the full cascade to settle (set activeProjectId BEFORE
    // loadPipeline, so gate on the last-loaded state, not activeProjectId).
    await vi.waitFor(() => {
      expect(useProjectStore.getState().isSwitching).toBe(false)
      expect(usePipelineStore.getState().currentPipeline?.id).toBe('p2')
    })
    expect(useProjectStore.getState().activeProjectId).toBe('p2')
    expect(usePipelineStore.getState().pipelineRevision).toBeGreaterThan(revBefore)
    expect(useUIStore.getState().activeProjectType).toBe('lowpoly')
    // Must NOT re-activate (that would re-broadcast → feedback loop).
    expect(activateCalls()).toBe(callsBefore)
    unsub()
  })

  it('ignores its own activation echo (incoming id === activeProjectId)', async () => {
    const { listeners } = makeCapturingTransport()
    await useProjectStore.getState().fetchProjects()
    const unsub = useProjectStore.getState().subscribeProjectActivation()
    const revBefore = usePipelineStore.getState().pipelineRevision

    emitProjectActivated(listeners, 'p1') // same as current active → no-op
    await new Promise((r) => setTimeout(r, 10))

    expect(useProjectStore.getState().activeProjectId).toBe('p1')
    expect(usePipelineStore.getState().pipelineRevision).toBe(revBefore)
    unsub()
  })
})
