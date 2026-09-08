// Regression test for the canvas live-sync rebuild. The canvas must rebuild its
// ReactFlow layer on:
//   1. the battery catalog arriving AFTER the snapshot (otherwise a snapshot
//      loaded before the catalog drops every node — battery lookup misses — and
//      never recovers); and
//   2. a `pipelineRevision` bump (the load / graph:applied refetch signal). The
//      pipeline id is the constant 'main', so keying the rebuild on the id
//      alone made every external/LLM-driven batch invisible.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport, createEditorTransport, type EditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import Canvas from '../components/canvas/Canvas.js'
import type { Battery, Pipeline } from '../types.js'

const echoBattery: Battery = {
  id: 'demo.echo',
  name: 'Echo',
  nameEn: 'Echo',
  type: 'ts',
  category: 'base',
  description: 'echoes its input',
  version: '1.0.0',
  inputs: [{ name: 'in', type: 'string' }],
  outputs: [{ name: 'out', type: 'string' }],
  params: [],
}

function pipelineWith(nodeIds: string[]): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'main',
    name: 'main',
    description: '',
    nodes: nodeIds.map((id) => ({
      id,
      batteryId: 'demo.echo',
      name: 'Echo',
      position: { x: 40, y: 40 },
      params: {},
    })),
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

function baseState(overrides: Record<string, unknown>) {
  usePipelineStore.setState({
    batteries: [],
    categories: [],
    currentPipeline: null,
    sessionRestorePending: null,
    pipelineRevision: 0,
    pipelineStatus: 'idle',
    selectedNode: null,
    selectedNodeIds: [],
    logs: [],
    nodeOutputs: {},
    dynamicOutputPorts: {},
    groupViewStack: [],
    ...overrides,
  })
}

let transport: EditorTransport

beforeEach(() => {
  const client = createMockApiClient({
    ops: [{ id: 'demo.echo', name: 'Echo', inputs: [], outputs: [], params: [], execute: () => null }],
  })
  transport = createEditorTransport(client)
  configureEditorTransport(transport)
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
})

afterEach(() => {
  transport.dispose()
  configureEditorTransport(null)
})

describe('canvas graph-sync rebuild', () => {
  it('rebuilds nodes when the battery catalog arrives after the snapshot', () => {
    // Snapshot loaded first, catalog still empty → node is dropped initially.
    baseState({ currentPipeline: pipelineWith(['n1']), pipelineRevision: 1 })
    const { container } = render(<Canvas />)
    expect(container.querySelector('.battery-node')).toBeNull()

    // Catalog arrives (e.g. loadBatteries resolves) — canvas must rebuild.
    act(() => {
      usePipelineStore.setState({ batteries: [echoBattery] })
    })
    expect(container.querySelector('.battery-node')).not.toBeNull()
    expect(container.querySelector('.node-title')?.textContent).toBe('Echo')
  })

  it('rebuilds on a pipelineRevision bump even though the pipeline id is constant', () => {
    // Catalog ready, empty graph at revision 1.
    baseState({ batteries: [echoBattery], currentPipeline: pipelineWith([]), pipelineRevision: 1 })
    const { container } = render(<Canvas />)
    expect(container.querySelector('.battery-node')).toBeNull()

    // An external batch (LLM / CLI) lands → loadPipeline replaces the snapshot
    // (same id 'main') and bumps the revision. The canvas must show the node.
    act(() => {
      usePipelineStore.setState({ currentPipeline: pipelineWith(['n1']), pipelineRevision: 2 })
    })
    expect(container.querySelector('.battery-node')).not.toBeNull()
  })
})
