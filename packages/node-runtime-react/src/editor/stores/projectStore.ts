// Project store — multi-project management for the faithful editor.
//
// A port of the legacy editor's projectStore onto the kernel transport. It
// drives create / list / open(switch) / delete over the EditorApiAdapter's
// optional project methods, and wires the OPEN CASCADE into the existing
// live-sync machinery rather than reinventing it:
//
//   switchProject(id):
//     1. persistSession()            ← flush the outgoing project's canvas
//     2. api.activateProject(id)     ← server swaps the active runtime/storage
//     3. reset node outputs / dynamic ports / selection / group view
//     4. loadPipeline()              ← pipelineRevision++ → useCanvasGraphSync
//                                       reconcile rebuild → preview refresh
//     5. clearHistory()              ← undo stack does NOT cross projects
//     6. setActiveProjectType(type)  ← keeps the battery filter correct
//     7. refresh recentProjectIds from the workspace doc
//
// Steps 1–7 reuse the SAME paths every other actor uses (loadPipeline →
// graph:applied → reconcile), so no editor behaviour is regressed. The app
// (e.g. scene-generator) observes `activeProjectId` to clear/reload its preview
// iframe (the renderer `projectChanged` signal) — that wiring stays app-level.

import { create } from 'zustand'

import type { CreateProjectRequest } from '../../api/ApiClient.js'
import type { ProjectMeta } from '@forgeax/node-runtime'

import { getEditorTransport } from '../transport/index.js'
import { useHistoryStore } from './historyStore.js'
import { usePipelineStore } from './pipelineStore.js'
import { useUIStore } from './uiStore.js'

interface ProjectState {
  projects: ProjectMeta[]
  activeProjectId: string | null
  recentProjectIds: string[]
  isLoading: boolean
  isSwitching: boolean
  error: string | null

  /** Load the project list + workspace, syncing the active project type. */
  fetchProjects: () => Promise<void>
  /** fetchProjects then open the active project (cold boot). */
  bootstrap: () => Promise<void>
  /** Open a project: the full faithful cascade (flush → activate → reconcile → clearHistory). */
  switchProject: (id: string) => Promise<void>
  /**
   * Listen for `project:activated` broadcast by the backend when ANOTHER client
   * (a sibling iframe, or an agent tool) switches the active project, and
   * re-sync this client to it. Returns an unsubscribe. Wire alongside
   * pipelineStore.subscribeLiveSync at boot.
   */
  subscribeProjectActivation: () => () => void
  /** Create a project then open it. */
  createProject: (input: CreateProjectRequest) => Promise<ProjectMeta>
  /** Delete a project; the server keeps the workspace non-empty + returns it. */
  deleteProject: (id: string, assetPolicy?: 'detach' | 'delete') => Promise<void>
  /** Rename a project. */
  renameProject: (id: string, name: string) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  recentProjectIds: [],
  isLoading: false,
  isSwitching: false,
  error: null,

  fetchProjects: async () => {
    set({ isLoading: true, error: null })
    try {
      const { api } = getEditorTransport()
      const [projects, workspace] = await Promise.all([api.listProjects(), api.getWorkspace()])
      const activeProjectId = workspace?.activeProjectId ?? null
      set({
        projects: [...projects],
        activeProjectId,
        recentProjectIds: workspace?.recentProjectIds ?? [],
      })
      // Keep the battery filter aligned with the active project's type.
      const active = projects.find((p) => p.id === activeProjectId)
      useUIStore.getState().setActiveProjectType(active?.type ?? null)
    } catch (e) {
      set({ error: (e as Error).message })
    } finally {
      set({ isLoading: false })
    }
  },

  bootstrap: async () => {
    await get().fetchProjects()
    const activeId = get().activeProjectId
    if (activeId) {
      await get().switchProject(activeId)
    }
  },

  switchProject: async (id: string) => {
    if (get().isSwitching) return
    set({ isSwitching: true, error: null })
    try {
      const { api } = getEditorTransport()

      // 1. Flush the OUTGOING project's canvas before we swap storage.
      try {
        await usePipelineStore.getState().persistSession()
      } catch (e) {
        console.warn('[projectStore] persistSession before switch failed:', e)
      }

      // 2. Server swaps the active runtime → its isolated graph/history/outputs.
      const { project } = await api.activateProject(id)

      // 3. Reset transient per-pipeline editor state (outputs/ports/selection).
      usePipelineStore.setState({
        nodeOutputs: {},
        dynamicOutputPorts: {},
        pipelineStatus: 'idle',
        selectedNode: null,
        selectedNodeIds: [],
        pendingSelectNodeIds: null,
        groupViewStack: [],
      })

      // 4. Load the activated project's graph → pipelineRevision++ → reconcile.
      await usePipelineStore.getState().loadPipeline()
      void usePipelineStore.getState().refreshConnectedOutputs()

      // 5. Rebuild the history panel from the INCOMING project's persistent log
      // (history.jsonl). Hydrated rows are display-only; the live undo stack does
      // not cross projects. Degrade to a clear if the log can't be read.
      try {
        useHistoryStore.getState().hydrate(await api.getHistory())
      } catch (e) {
        console.warn('[projectStore] history reload after switch failed:', e)
        useHistoryStore.getState().clearHistory()
      }

      // 6. Keep the battery palette filter correct for the new project type.
      useUIStore.getState().setActiveProjectType(project?.manifest?.type ?? null)

      set({ activeProjectId: id })

      // 7. Refresh the recent list from the authoritative workspace doc.
      const ws = await api.getWorkspace()
      set({ recentProjectIds: ws?.recentProjectIds ?? [] })
    } catch (e) {
      console.error('[projectStore] switchProject failed:', e)
      set({ error: (e as Error).message })
    } finally {
      set({ isSwitching: false })
    }
  },

  subscribeProjectActivation: () => {
    const { ws } = getEditorTransport()
    ws.connect()
    return ws.on('project:activated', ({ projectId }) => {
      // Ignore our own switch — switchProject() sets activeProjectId
      // synchronously before the server round-trip, so the echo is a no-op here
      // (this is the feedback-loop guard). Also skip if we're mid-switch.
      if (projectId === get().activeProjectId) return
      if (get().isSwitching) return
      void (async () => {
        set({ isSwitching: true, error: null })
        try {
          // Reset transient per-pipeline state. No persistSession(): this client
          // is an OBSERVER of a switch another client owns.
          usePipelineStore.setState({
            nodeOutputs: {},
            dynamicOutputPorts: {},
            pipelineStatus: 'idle',
            selectedNode: null,
            selectedNodeIds: [],
            pendingSelectNodeIds: null,
            groupViewStack: [],
          })
          set({ activeProjectId: projectId })
          // The server already swapped the active runtime; just load its graph.
          // Do NOT call api.activateProject (would re-broadcast → feedback loop).
          await usePipelineStore.getState().loadPipeline()
          void usePipelineStore.getState().refreshConnectedOutputs()
          // Rebuild the panel from the now-active project's persistent log.
          try {
            useHistoryStore.getState().hydrate(await getEditorTransport().api.getHistory())
          } catch (e) {
            console.warn('[projectStore] history reload on project:activated failed:', e)
            useHistoryStore.getState().clearHistory()
          }
          // Pick up the new project's type (battery filter) + recents + list.
          await get().fetchProjects()
        } catch (e) {
          console.error('[projectStore] project:activated sync failed:', e)
          set({ error: (e as Error).message })
        } finally {
          set({ isSwitching: false })
        }
      })()
    })
  },

  createProject: async (input: CreateProjectRequest) => {
    const { api } = getEditorTransport()
    const meta = await api.createProject(input)
    set((s) => ({ projects: [...s.projects, meta] }))
    await get().switchProject(meta.id)
    return meta
  },

  deleteProject: async (id: string, assetPolicy?: 'detach' | 'delete') => {
    const { api } = getEditorTransport()
    const wasActive = get().activeProjectId === id
    const res = await api.deleteProject(id, assetPolicy ? { assetPolicy } : undefined)
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      recentProjectIds: s.recentProjectIds.filter((rid) => rid !== id),
    }))
    // The server always leaves a valid active project; open it if we removed
    // the one currently open.
    const nextActive = res.workspace.activeProjectId
    if (wasActive && nextActive) {
      await get().switchProject(nextActive)
    } else {
      await get().fetchProjects()
    }
  },

  renameProject: async (id: string, name: string) => {
    const { api } = getEditorTransport()
    const meta = await api.updateProject(id, { name })
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? meta : p)) }))
  },
}))
