import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ApiClient,
  ApplyBatchOptions,
  ApplyBatchResult,
  ExecutionResult,
  GraphEdge,
  GraphNode,
  Op,
  PipelineSnapshot,
} from '@forgeax/node-runtime'

import { configureEditorTransport, createEditorTransport, type EditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import type { Pipeline } from '../types.js'

function makePipeline(nodes: Array<{ id: string; batteryId?: string }>): Pipeline {
  const now = '1970-01-01T00:00:00.000Z'
  return {
    id: 'persist-race',
    name: 'persist-race',
    description: '',
    nodes: nodes.map((node, index) => ({
      id: node.id,
      batteryId: node.batteryId ?? 'a.one',
      name: node.id,
      position: { x: index * 100, y: 0 },
      params: {},
    })),
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

function snapshotFrom(nodes: Map<string, GraphNode>, hash: string): PipelineSnapshot {
  return {
    id: 'persist-race',
    hash,
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
    nodes: Object.fromEntries(nodes),
    edges: {},
  }
}

function createRaceClient() {
  const nodes = new Map<string, GraphNode>([
    ['n1', { id: 'n1', opId: 'a.one', name: 'n1', position: { x: 0, y: 0 }, params: {} }],
    ['n2', { id: 'n2', opId: 'a.one', name: 'n2', position: { x: 100, y: 0 }, params: {} }],
  ])
  let hash = 'h0'
  let firstGetPipeline: (() => void) | null = null
  const firstGetStarted = vi.fn()
  const applyBatch = vi.fn(async (ops: readonly Op[]): Promise<ApplyBatchResult> => {
    for (const op of ops) {
      if (op.type === 'deleteNode') nodes.delete(op.nodeId)
      if (op.type === 'createNode') {
        nodes.set(op.nodeId, {
          id: op.nodeId,
          opId: op.opId,
          name: op.name,
          position: op.position,
          params: { ...op.params },
        })
      }
    }
    hash = `h${applyBatch.mock.calls.length}`
    return { status: 'ok', newHash: hash, batchId: hash }
  })
  let getPipelineCalls = 0
  const client: ApiClient = {
    pipelineId: 'persist-race',
    async getPipeline() {
      getPipelineCalls += 1
      if (getPipelineCalls === 1) {
        firstGetStarted()
        await new Promise<void>((resolve) => {
          firstGetPipeline = resolve
        })
      }
      return snapshotFrom(nodes, hash)
    },
    applyBatch,
    execute: async (): Promise<ExecutionResult> => ({ status: 'completed' }) as ExecutionResult,
    getNode: async () => null,
    listNodes: async () => Array.from(nodes.values()),
    listEdges: async (): Promise<readonly GraphEdge[]> => [],
    getNodeOutput: async () => undefined,
    getHistory: async () => [],
    listOps: async () => [],
    getGroup: async () => null,
    listGroups: async () => [],
    subscribe: () => () => {},
    resolveAssetPath: async (template: string) => template,
  }
  return {
    client,
    applyBatch,
    firstGetStarted,
    releaseFirstGetPipeline: () => firstGetPipeline?.(),
    nodeIds: () => Array.from(nodes.keys()).sort(),
  }
}

let transport: EditorTransport | null = null

beforeEach(() => {
  usePipelineStore.setState({
    currentPipeline: null,
    pipelineRevision: 0,
    logs: [],
    nodeOutputs: {},
    dynamicOutputPorts: {},
  })
})

afterEach(() => {
  transport?.dispose()
  transport = null
  configureEditorTransport(null)
})

/** Non-blocking client: applyBatch mutates an in-memory graph synchronously. */
function createSimpleClient() {
  const nodes = new Map<string, GraphNode>([
    ['n1', { id: 'n1', opId: 'a.one', name: 'n1', position: { x: 0, y: 0 }, params: {} }],
    ['n2', { id: 'n2', opId: 'a.one', name: 'n2', position: { x: 100, y: 0 }, params: {} }],
  ])
  let hash = 'h0'
  const applyBatch = vi.fn(async (ops: readonly Op[]): Promise<ApplyBatchResult> => {
    for (const op of ops) {
      if (op.type === 'deleteNode') nodes.delete(op.nodeId)
      if (op.type === 'createNode') {
        nodes.set(op.nodeId, { id: op.nodeId, opId: op.opId, name: op.name, position: op.position, params: { ...op.params } })
      }
    }
    hash = `h${applyBatch.mock.calls.length}`
    return { status: 'ok', newHash: hash, batchId: hash }
  })
  const client: ApiClient = {
    pipelineId: 'persist-final',
    async getPipeline() {
      return snapshotFrom(nodes, hash)
    },
    applyBatch,
    execute: async (): Promise<ExecutionResult> => ({ status: 'completed' }) as ExecutionResult,
    getNode: async () => null,
    listNodes: async () => Array.from(nodes.values()),
    listEdges: async (): Promise<readonly GraphEdge[]> => [],
    getNodeOutput: async () => undefined,
    getHistory: async () => [],
    listOps: async () => [],
    getGroup: async () => null,
    listGroups: async () => [],
    subscribe: () => () => {},
    resolveAssetPath: async (template: string) => template,
  }
  return { client, applyBatch, nodeIds: () => Array.from(nodes.keys()).sort() }
}

describe('pipelineStore persist ordering', () => {
  it('persists the final state after rapid consecutive edits (no dropped last beat)', async () => {
    const sim = createSimpleClient()
    transport = createEditorTransport(sim.client)
    configureEditorTransport(transport)

    usePipelineStore.setState({ currentPipeline: makePipeline([{ id: 'n1' }, { id: 'n2' }]) })

    // Fire several edits + persists back-to-back in a single tick: intermediate
    // persists may be coalesced away, but the FINAL snapshot must always land.
    const persists: Array<Promise<unknown>> = []
    for (let i = 0; i < 5; i += 1) {
      usePipelineStore.getState().addNode({
        id: `r${i}`,
        batteryId: 'a.one',
        name: `r${i}`,
        position: { x: i * 50, y: 200 },
        params: {},
      })
      persists.push(usePipelineStore.getState().persistSession())
    }
    await Promise.all(persists)

    // The kernel must reflect every added node — the latest beat is never lost.
    expect(sim.nodeIds()).toEqual(['n1', 'n2', 'r0', 'r1', 'r2', 'r3', 'r4'])
  })

  it('does not let an older persist snapshot recreate a root-deleted node', async () => {
    const race = createRaceClient()
    transport = createEditorTransport(race.client)
    configureEditorTransport(transport)

    usePipelineStore.setState({ currentPipeline: makePipeline([{ id: 'n1' }, { id: 'n2' }]) })
    const stalePersist = usePipelineStore.getState().persistSession()
    await vi.waitFor(() => expect(race.firstGetStarted).toHaveBeenCalled())

    usePipelineStore.getState().removeNode('n1')
    const deletePersist = usePipelineStore.getState().persistSession()

    race.releaseFirstGetPipeline()
    await Promise.all([stalePersist, deletePersist])

    expect(race.applyBatch).toHaveBeenCalledWith(
      [{ type: 'deleteNode', nodeId: 'n1' }],
      expect.objectContaining({ actor: 'editor' }) as ApplyBatchOptions,
    )
    expect(race.nodeIds()).toEqual(['n2'])
  })
})
