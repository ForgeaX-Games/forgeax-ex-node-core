import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { useProjectStore } from '../stores/projectStore.js'
import { PipelineFileDialog, ProjectsDialog } from '../components/chrome/index.js'

function makeProjectClient(onCreate: (req: CreateProjectRequest) => void): ApiClient {
  const projects: Record<string, ProjectMeta> = {
    main: { id: 'main', type: 'lowpoly', name: 'Default', description: '', createdAt: '', updatedAt: '' },
  }
  const pipeline: PipelineSnapshot = {
    id: 'main',
    hash: 'h',
    createdAt: '',
    updatedAt: '',
    nodes: {},
    edges: {},
  }
  return {
    pipelineId: 'main',
    applyBatch: async () => ({ status: 'ok', newHash: 'h', batchId: 'b' }),
    execute: async () => ({ status: 'completed' }) as never,
    getPipeline: async () => pipeline,
    getNode: async () => null,
    listNodes: async () => [],
    listEdges: async () => [],
    getNodeOutput: async () => undefined,
    getHistory: async () => [],
    listOps: async () => [],
    getGroup: async () => null,
    listGroups: async () => [],
    subscribe: (_c: RuntimeChannel, _l: (e: RuntimeEvent) => void) => () => {},
    resolveAssetPath: async (t: string) => t,
    listImportTemplates: async () => [{ path: 'demo.json', name: 'Demo', source: 'templates' }],
    listProjects: async () => Object.values(projects),
    getProject: async (id: string): Promise<ProjectRecord | null> =>
      projects[id]
        ? { manifest: { schemaVersion: 1, ...projects[id], storage: { graphFile: '', historyFile: '', outputsDir: '' } } }
        : null,
    createProject: async (req: CreateProjectRequest) => {
      onCreate(req)
      const meta: ProjectMeta = {
        id: 'created',
        type: req.type ?? 'lowpoly',
        name: req.name,
        description: req.description ?? '',
        createdAt: '',
        updatedAt: '',
      }
      projects.created = meta
      return meta
    },
    updateProject: async (id: string) => projects[id],
    deleteProject: async () => ({ ok: true as const, workspace: { activeProjectId: 'main', recentProjectIds: ['main'], lastOpenedAt: '' } }),
    activateProject: async (id: string): Promise<ActivateProjectResult> => ({
      project: { manifest: { schemaVersion: 1, ...projects[id], storage: { graphFile: '', historyFile: '', outputsDir: '' } } },
      pipeline,
    }),
    getWorkspace: async (): Promise<WorkspaceState> => ({ activeProjectId: 'main', recentProjectIds: ['main'], lastOpenedAt: '' }),
    setWorkspace: async (): Promise<WorkspaceState> => ({ activeProjectId: 'main', recentProjectIds: ['main'], lastOpenedAt: '' }),
  }
}

let transport: EditorTransport | null = null

beforeEach(() => {
  useProjectStore.setState({ projects: [], activeProjectId: null, recentProjectIds: [], isLoading: false, isSwitching: false, error: null })
})

afterEach(() => {
  transport?.dispose()
  transport = null
  configureEditorTransport(null)
})

describe('shared editor chrome', () => {
  it('PipelineFileDialog lists shared templates and imports a selected file', async () => {
    const onImport = vi.fn(async () => {})
    render(
      <PipelineFileDialog
        mode="open"
        onClose={() => {}}
        listTemplates={async () => [{ path: 'demo.json', name: 'Demo', source: 'templates' }]}
        onImport={onImport}
        onExport={async () => {}}
      />,
    )

    fireEvent.click(await screen.findByText('Demo'))

    await waitFor(() => expect(onImport).toHaveBeenCalledWith({ path: 'demo.json', name: 'Demo', source: 'templates' }))
  })

  it('ProjectsDialog creates projects with the host-provided default project type', async () => {
    const created: CreateProjectRequest[] = []
    transport = createEditorTransport(makeProjectClient((req) => created.push(req)))
    configureEditorTransport(transport)
    render(<ProjectsDialog defaultProjectType="lowpoly" defaultProjectName="My part" onClose={() => {}} />)

    fireEvent.click(await screen.findByText('+ New project'))
    fireEvent.change(screen.getByPlaceholderText('My part'), { target: { value: 'Gearbox' } })
    fireEvent.click(screen.getByText('Create and open'))

    await waitFor(() => expect(created[0]).toMatchObject({ type: 'lowpoly', name: 'Gearbox' }))
  })
})
