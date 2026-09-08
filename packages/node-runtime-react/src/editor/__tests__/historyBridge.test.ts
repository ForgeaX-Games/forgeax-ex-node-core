// History bridge tests — programmatic batches surface in the visible panel.
//
// Visible History panel reads useHistoryStore. LOCAL UI ops record there via
// the canvas hooks; PROGRAMMATIC mutations (AI / CLI / another client) only
// flow applyBatch → history.jsonl → graph:applied → loadPipeline(), so they were
// invisible. subscribeLiveSync now bridges a committed batch into useHistoryStore
// for NON-LOCAL actors. These tests prove:
//   (1) an AI batch records exactly ONE entry with an actor-aware label;
//   (2) a local editor op does NOT double-record (the canvas hook already did);
//   (3) a kernel `label` annotation is honoured verbatim;
//   (4) de-dup — a repeated graph:applied for the same batchId records once.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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

function spec(id: string, name: string): OpSpec {
  return { id, name, inputs: [], outputs: [], params: [], execute: () => null }
}

let client: MockApiClient
let transport: EditorTransport

function resetStores(): void {
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
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
}

/** Drain the loadPipeline → refreshConnectedOutputs → bridge async chain. */
async function flush(): Promise<void> {
  // A couple of macrotask turns reliably settle the chained getPipeline /
  // getNodeOutput / getHistory promises regardless of how many awaits deep.
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('history bridge: programmatic batches → visible panel', () => {
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

  it('records exactly ONE entry with an actor-aware label for an AI batch', async () => {
    await usePipelineStore.getState().loadPipeline()
    const unsub = usePipelineStore.getState().subscribeLiveSync()

    await client.applyBatch(
      [
        { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
        { type: 'createNode', nodeId: 'n2', opId: 'a.two', position: { x: 1, y: 1 }, params: {} },
        {
          type: 'connect',
          edgeId: 'e1',
          source: { nodeId: 'n1', port: 'out' },
          target: { nodeId: 'n2', port: 'in' },
        },
      ],
      { actor: 'ai:agent' },
    )
    await flush()

    const entries = useHistoryStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].type).toBe('batch_applied')
    expect(entries[0].label).toBe('AI: createNode ×2, connect')
    expect(entries[0].labelEn).toBe('AI: createNode ×2, connect')
    // Affected node ids captured (for undo highlight / merge-safety).
    expect(new Set(entries[0].nodeIds)).toEqual(new Set(['n1', 'n2']))
    expect(entries[0].batchId).toBeTruthy()

    unsub()
  })

  it('does NOT double-record a local editor op already logged by the canvas hook', async () => {
    await usePipelineStore.getState().loadPipeline()
    const unsub = usePipelineStore.getState().subscribeLiveSync()

    // Simulate the canvas hook recording the local op BEFORE it applies.
    useHistoryStore.getState().record('add_node', createEmptyPipeline(), {
      nodeIds: ['n-local'],
      label: 'Add node',
    })
    expect(useHistoryStore.getState().entries).toHaveLength(1)

    // The same op then persists through applyBatch with the local 'editor' actor.
    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'n-local', opId: 'a.one', position: { x: 0, y: 0 }, params: {} }],
      { actor: 'editor' },
    )
    await flush()

    // Still ONE entry — the bridge skipped the local actor.
    const entries = useHistoryStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].type).toBe('add_node')

    unsub()
  })

  it('honours a kernel `label` annotation verbatim', async () => {
    await usePipelineStore.getState().loadPipeline()
    const unsub = usePipelineStore.getState().subscribeLiveSync()

    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'm1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} }],
      { actor: 'cli', label: 'AI: build mountain ridge' },
    )
    await flush()

    const entries = useHistoryStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].label).toBe('AI: build mountain ridge')

    unsub()
  })

  it('de-dups a repeated graph:applied for the same committed batch', async () => {
    await usePipelineStore.getState().loadPipeline()
    const unsub = usePipelineStore.getState().subscribeLiveSync()

    // Re-deliver the SAME graph:applied (same batchId) twice. The kernel emits
    // it once; a synth + WS broadcast can duplicate it in production.
    transport.ws.connect()
    const payload = { batchId: 'dup-batch', newHash: 'h1' }
    // Seed a matching history entry for the batchId the events reference.
    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'd1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} }],
      { actor: 'ai:agent', batchId: 'dup-batch' },
    )
    await flush()
    // First delivery already recorded one entry (via applyBatch's own emit).
    expect(useHistoryStore.getState().entries).toHaveLength(1)

    // A second, redundant delivery of the same batchId must NOT add a row.
    ;(transport.ws as unknown as { emit: (e: string, p: unknown) => void }).emit(
      'graph:applied',
      payload,
    )
    await flush()
    expect(useHistoryStore.getState().entries).toHaveLength(1)

    unsub()
  })
})
