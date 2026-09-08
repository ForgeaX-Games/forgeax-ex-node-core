// Pipeline store tests — focus on the live-sync backbone:
//   (1) agentAddNode drives the store + persists through applyBatch (the same
//       path a human edit takes);
//   (2) a graph:applied event delivered via the subscribe adapter triggers the
//       store to refetch and the canvas nodes to change (non-vacuous: assert
//       store.currentPipeline gains a node it did not have before).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OpSpec } from '@forgeax/node-runtime'

import { createMockApiClient, type MockApiClient } from '../../test/mockApiClient.js'
import {
  configureEditorTransport,
  createEditorTransport,
  type EditorTransport,
} from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import { createEmptyPipeline } from '../stores/pipelineStore.helpers.js'

function spec(id: string, name: string, outputs: OpSpec['outputs'] = []): OpSpec {
  return { id, name, inputs: [], outputs, params: [], execute: () => null }
}

let client: MockApiClient
let transport: EditorTransport

function resetStores(): void {
  usePipelineStore.setState({
    batteries: [],
    categories: [],
    currentPipeline: null,
    sessionRestorePending: null,
    pipelineStatus: 'idle',
    selectedNode: null,
    selectedNodeIds: [],
    logs: [],
    nodeOutputs: {},
    dynamicOutputPorts: {},
    groupViewStack: [],
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
}

async function flush(): Promise<void> {
  // Let the async loadPipeline triggered by the sync event resolve.
  await Promise.resolve()
  await Promise.resolve()
}

describe('pipelineStore live-sync backbone', () => {
  beforeEach(() => {
    client = createMockApiClient({ ops: [spec('a.one', 'One'), spec('a.two', 'Two')] })
    transport = createEditorTransport(client)
    configureEditorTransport(transport)
    resetStores()
  })

  afterEach(() => {
    transport.dispose()
    configureEditorTransport(null)
  })

  it('loadBatteries populates the catalog from listOps()', async () => {
    await usePipelineStore.getState().loadBatteries()
    expect(usePipelineStore.getState().batteries.map((b) => b.id)).toEqual(['a.one', 'a.two'])
  })

  it('agentAddNode records history, updates the store, and persists via applyBatch', async () => {
    await usePipelineStore.getState().loadBatteries()
    usePipelineStore.getState().setPipeline(createEmptyPipeline())
    const applySpy = vi.spyOn(client, 'applyBatch')

    usePipelineStore.getState().agentAddNode({
      id: 'n1',
      batteryId: 'a.one',
      name: 'One',
      position: { x: 0, y: 0 },
      params: {},
    })

    // Data layer: the node is in the working pipeline.
    expect(usePipelineStore.getState().currentPipeline?.nodes.map((n) => n.id)).toContain('n1')
    // History recorded (same path as a human add).
    expect(useHistoryStore.getState().entries).toHaveLength(1)
    expect(useHistoryStore.getState().entries[0].type).toBe('add_node')

    // Persist + execute flow through applyBatch.
    await flush()
    expect(applySpy).toHaveBeenCalled()
    expect(applySpy.mock.calls[0][0]).toEqual([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])
  })

  it('LIVE-SYNC: a graph change from another actor refetches and updates the canvas', async () => {
    // Start from an empty, loaded pipeline.
    await usePipelineStore.getState().loadPipeline()
    expect(usePipelineStore.getState().currentPipeline?.nodes ?? []).toHaveLength(0)

    // The store subscribes to live-sync (graph:applied → refetch).
    const unsub = usePipelineStore.getState().subscribeLiveSync()

    // Another actor (AI / CLI / another client) mutates the kernel graph
    // directly. The mock emits graph:applied synchronously inside applyBatch.
    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'remote-1', opId: 'a.two', position: { x: 5, y: 5 }, params: {} }],
      { actor: 'ai-agent' },
    )

    // The subscribe adapter drove the store to refetch — non-vacuous: the
    // canvas now shows a node it never had locally.
    await flush()
    const nodes = usePipelineStore.getState().currentPipeline?.nodes ?? []
    expect(nodes.map((n) => n.id)).toContain('remote-1')

    unsub()
  })

  it('LIVE-SYNC: unsubscribe stops further refetches', async () => {
    await usePipelineStore.getState().loadPipeline()
    const unsub = usePipelineStore.getState().subscribeLiveSync()
    unsub()

    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'remote-2', opId: 'a.one', position: { x: 0, y: 0 }, params: {} }],
      { actor: 'ai-agent' },
    )
    await flush()

    const nodes = usePipelineStore.getState().currentPipeline?.nodes ?? []
    expect(nodes.map((n) => n.id)).not.toContain('remote-2')
  })

  it('loadPipeline preserves the client-only previewEnabled toggle across a re-pull', async () => {
    client.__reset({
      ops: [spec('a.one', 'One')],
      nodes: [{ id: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} }],
      edges: [],
    })
    await usePipelineStore.getState().loadPipeline()
    // previewEnabled is never persisted to the backend → undefined after a pull.
    expect(usePipelineStore.getState().currentPipeline?.nodes[0]?.previewEnabled).toBeUndefined()

    // User turns the node's preview OFF (client-only state).
    usePipelineStore.setState((s) => ({
      currentPipeline: s.currentPipeline
        ? { ...s.currentPipeline, nodes: s.currentPipeline.nodes.map((n) => ({ ...n, previewEnabled: false })) }
        : s.currentPipeline,
    }))

    // A live-sync / re-exec re-pull must NOT silently re-enable the preview.
    await usePipelineStore.getState().loadPipeline()
    expect(usePipelineStore.getState().currentPipeline?.nodes[0]?.previewEnabled).toBe(false)
  })

  it('executePipeline routes through the transport execute()', async () => {
    const execSpy = vi.spyOn(client, 'execute')
    usePipelineStore.getState().setPipeline(createEmptyPipeline())
    await usePipelineStore.getState().executePipeline()
    expect(execSpy).toHaveBeenCalled()
    expect(usePipelineStore.getState().pipelineStatus).toBe('completed')
  })

  it('refreshConnectedOutputs hydrates unconnected visible output ports for tooltips', async () => {
    client.__reset({
      ops: [
        spec('scene.add_child', 'AddChild', [
          { name: 'scene', type: 'scene', access: 'item' },
          { name: 'childPaths', type: 'string', access: 'list' },
        ]),
        spec('scene.output', 'Scene Output'),
      ],
      nodes: [
        { id: 'add', opId: 'scene.add_child', position: { x: 0, y: 0 }, params: {} },
        { id: 'out', opId: 'scene.output', position: { x: 200, y: 0 }, params: {} },
      ],
      edges: [
        {
          id: 'e-add-scene-out-scene',
          source: { nodeId: 'add', port: 'scene' },
          target: { nodeId: 'out', port: 'scene' },
        },
      ],
    })
    await usePipelineStore.getState().loadBatteries()
    await usePipelineStore.getState().loadPipeline()
    vi.spyOn(client, 'getNodeOutput').mockImplementation(async (_nodeId, portId) => {
      if (portId === 'scene') return [{ path: [0], items: [{ focus: '/Root' }] }]
      if (portId === 'childPaths') {
        return [
          { path: [0, 0], items: ['/Root/A'] },
          { path: [0, 1], items: ['/Root/B'] },
        ]
      }
      return undefined
    })

    await usePipelineStore.getState().refreshConnectedOutputs()

    expect(usePipelineStore.getState().nodeOutputs.add?.childPaths).toEqual([
      { path: [0, 0], items: ['/Root/A'] },
      { path: [0, 1], items: ['/Root/B'] },
    ])
  })
})
