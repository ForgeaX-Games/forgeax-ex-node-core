// Editor-side graph import — legacyPipelineToOps mapper + EditorApiAdapter
// .importPipeline / .listImportTemplates / .importPipelineFile.
//
// The mapper turns a whole editor Pipeline into an ordered Op[]; the adapter
// submits it through applyBatch (the live-sync path). The optional template /
// file-import transport capabilities are delegated when present and degrade
// gracefully when absent.

import { describe, expect, it, vi } from 'vitest'

import type { OpSpec } from '@forgeax/node-runtime'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { createEditorTransport } from '../transport/index.js'
import { legacyPipelineToOps } from '../transport/mappers.js'
import type { Pipeline } from '../types.js'

function spec(id: string): OpSpec {
  return { id, name: id, inputs: [], outputs: [], params: [], execute: () => null }
}

function pipeline(over: Partial<Pipeline> = {}): Pipeline {
  const now = '1970-01-01T00:00:00.000Z'
  return {
    id: 'p',
    name: 'p',
    description: '',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

describe('legacyPipelineToOps', () => {
  it('builds createNode + connect + setMetadata for a flat graph (replace)', () => {
    const p = pipeline({
      nodes: [
        { id: 'n1', batteryId: 'a.one', name: 'First', position: { x: 1, y: 2 }, params: { k: 1 } },
        { id: 'n2', batteryId: 'a.two', name: 'Second', position: { x: 3, y: 4 }, params: {} },
      ],
      edges: [{ id: 'e', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } }],
      viewport: { x: 9, y: 8, zoom: 2 },
    })
    const { ops, diagnostics } = legacyPipelineToOps(p, { mode: 'replace', current: null })
    expect(diagnostics).toEqual([])
    const types = ops.map((o) => o.type)
    expect(types).toEqual(['createNode', 'createNode', 'connect', 'setMetadata'])
    const create = ops[0] as Extract<(typeof ops)[number], { type: 'createNode' }>
    expect(create.name).toBe('First')
    const meta = ops[3] as Extract<(typeof ops)[number], { type: 'setMetadata' }>
    expect(meta.key).toBe('viewport')
    expect(meta.value).toEqual({ x: 9, y: 8, zoom: 2 })
  })

  it('emits deleteNode for current nodes in replace mode', () => {
    const p = pipeline({ nodes: [{ id: 'n1', batteryId: 'a.one', name: 'n', position: { x: 0, y: 0 }, params: {} }] })
    const current = {
      id: 'p',
      hash: 'h',
      createdAt: '',
      updatedAt: '',
      nodes: { old: { id: 'old', opId: 'a.one', position: { x: 0, y: 0 }, params: {} } },
      edges: {},
    }
    const { ops } = legacyPipelineToOps(p, { mode: 'replace', current })
    expect(ops.some((o) => o.type === 'deleteNode' && o.nodeId === 'old')).toBe(true)
  })

  it('reports diagnostics for unknown opIds via validateOps', () => {
    const p = pipeline({ nodes: [{ id: 'n1', batteryId: 'ghost', name: 'g', position: { x: 0, y: 0 }, params: {} }] })
    const { ops, diagnostics } = legacyPipelineToOps(p, { validateOps: (id) => id !== 'ghost' })
    expect(ops).toEqual([])
    expect(diagnostics[0]?.opId).toBe('ghost')
  })

  it('auto-remaps colliding ids in merge mode', () => {
    const p = pipeline({ nodes: [{ id: 'n1', batteryId: 'a.one', name: 'n', position: { x: 0, y: 0 }, params: {} }] })
    const current = {
      id: 'p', hash: 'h', createdAt: '', updatedAt: '',
      nodes: { n1: { id: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} } },
      edges: {},
    }
    const { ops, nodeIdMap } = legacyPipelineToOps(p, { mode: 'merge', current })
    expect(nodeIdMap.n1).not.toBe('n1')
    expect(ops.every((o) => o.type !== 'deleteNode')).toBe(true)
  })
})

describe('EditorApiAdapter import/export', () => {
  it('importPipeline applies a whole pipeline via applyBatch (replace)', async () => {
    const client = createMockApiClient({ ops: [spec('a.one'), spec('a.two')] })
    const applySpy = vi.spyOn(client, 'applyBatch')
    const { api } = createEditorTransport(client)

    const res = await api.importPipeline(
      pipeline({
        nodes: [
          { id: 'n1', batteryId: 'a.one', name: 'First', position: { x: 0, y: 0 }, params: {} },
          { id: 'n2', batteryId: 'a.two', name: 'Second', position: { x: 50, y: 0 }, params: {} },
        ],
        edges: [{ id: 'e', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } }],
      }),
      { actor: 'ai:import', label: 'Import template X' },
    )

    expect(res.status).toBe('ok')
    expect(applySpy).toHaveBeenCalledTimes(1)
    expect(applySpy.mock.calls[0][1]).toMatchObject({ actor: 'ai:import', label: 'Import template X' })
    const snap = await client.getPipeline()
    expect(Object.keys(snap!.nodes).sort()).toEqual(['n1', 'n2'])
    expect(snap!.nodes.n1!.name).toBe('First')
  })

  it('listImportTemplates returns [] when the transport has no template route', async () => {
    const { api } = createEditorTransport(createMockApiClient())
    expect(await api.listImportTemplates()).toEqual([])
  })

  it('listImportTemplates / importPipelineFile delegate to the transport capability', async () => {
    const base = createMockApiClient({ ops: [spec('a.one')] })
    const client = Object.assign(base, {
      listImportTemplates: vi.fn(async () => [{ path: 't.json', name: 'T', source: 'templates' }]),
      importPipelineFile: vi.fn(async () => ({ status: 'ok' as const, batchId: 'b', executed: true })),
    })
    const { api } = createEditorTransport(client)
    expect(await api.listImportTemplates()).toEqual([{ path: 't.json', name: 'T', source: 'templates' }])
    const res = await api.importPipelineFile({ path: 't.json', source: 'templates', options: { mode: 'replace', executeAfter: 'full' } })
    expect(res.executed).toBe(true)
    expect(client.importPipelineFile).toHaveBeenCalled()
  })
})
