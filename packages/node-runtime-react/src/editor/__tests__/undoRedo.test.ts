// Undo/Redo restore-contract tests.
//
// useCanvasUndoRedo wires Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z to:
//   1. useHistoryStore.undo(currentPipeline) / .redo() → target snapshot + cursor move
//   2. restoreSnapshot(snapshot, 'undo' | 'redo') → importPipeline(replace) →
//      applyBatch (actor 'undo'/'redo') → graph:applied → loadPipeline → reconcile.
//
// These prove the contract WITHOUT the DOM keydown layer (asserted separately by
// the legacy semantics): record → undo → redo targets the right snapshot, the
// restore goes through the kernel apply path with the undo/redo actor, the
// restore does NOT create a fresh history row / double-advance the cursor, and
// undoing an AI `batch_applied` entry restores the pre-batch graph.

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
import { restoreSnapshot } from '../components/canvas/useCanvasUndoRedo.js'

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
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

const nodeCount = (): number => usePipelineStore.getState().currentPipeline?.nodes.length ?? -1

describe('undo/redo restore contract', () => {
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

  it('local op: record → undo → redo targets the right snapshot and restores via the kernel apply path', async () => {
    await usePipelineStore.getState().loadPipeline()
    const unsub = usePipelineStore.getState().subscribeLiveSync()

    // Local add: the canvas hook records the PRE-op snapshot, then the op
    // persists through applyBatch with the local 'editor' actor.
    const pre = usePipelineStore.getState().currentPipeline!
    expect(pre.nodes).toHaveLength(0)
    useHistoryStore.getState().record('add_node', pre, { nodeIds: ['n1'], label: 'Add node' })
    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} }],
      { actor: 'editor' },
    )
    await flush()

    expect(nodeCount()).toBe(1)
    expect(useHistoryStore.getState().entries).toHaveLength(1)
    expect(useHistoryStore.getState().cursor).toBe(1)

    // ── UNDO ─────────────────────────────────────────────────────────────
    const applySpy = vi.spyOn(client, 'applyBatch')
    const target = useHistoryStore.getState().undo(usePipelineStore.getState().currentPipeline!)
    // (i) correct snapshot targeted: the pre-op (empty) pipeline.
    expect(target).not.toBeNull()
    expect(target!.nodes).toHaveLength(0)
    // cursor moved by the stack logic only.
    expect(useHistoryStore.getState().cursor).toBe(0)

    await restoreSnapshot(target!, 'undo')
    await flush()

    // (ii) restore applied via the import/applyBatch path with actor 'undo'.
    const undoCall = applySpy.mock.calls.find((c) => c[1]?.actor === 'undo')
    expect(undoCall).toBeTruthy()
    // graph round-tripped back to the pre-op state.
    expect(nodeCount()).toBe(0)
    // (iii) restore did NOT create a new history row / advance the cursor.
    expect(useHistoryStore.getState().entries).toHaveLength(1)
    expect(useHistoryStore.getState().cursor).toBe(0)

    // ── REDO ─────────────────────────────────────────────────────────────
    const fwd = useHistoryStore.getState().redo()
    expect(fwd).not.toBeNull()
    expect(fwd!.nodes).toHaveLength(1) // the cached redo tip (post-op state)
    expect(useHistoryStore.getState().cursor).toBe(1)

    await restoreSnapshot(fwd!, 'redo')
    await flush()

    const redoCall = applySpy.mock.calls.find((c) => c[1]?.actor === 'redo')
    expect(redoCall).toBeTruthy()
    expect(nodeCount()).toBe(1)
    expect(useHistoryStore.getState().entries).toHaveLength(1)
    expect(useHistoryStore.getState().cursor).toBe(1)

    unsub()
  })

  it('undoing an AI batch_applied entry restores the pre-batch graph; redo re-applies', async () => {
    await usePipelineStore.getState().loadPipeline()
    const unsub = usePipelineStore.getState().subscribeLiveSync()

    // A programmatic (AI) batch — bridged into history as ONE batch_applied
    // entry carrying the PRE-batch snapshot.
    await client.applyBatch(
      [
        { type: 'createNode', nodeId: 'ai1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
        { type: 'createNode', nodeId: 'ai2', opId: 'a.two', position: { x: 1, y: 1 }, params: {} },
        { type: 'connect', edgeId: 'e1', source: { nodeId: 'ai1', port: 'out' }, target: { nodeId: 'ai2', port: 'in' } },
      ],
      { actor: 'ai:agent' },
    )
    await flush()

    expect(useHistoryStore.getState().entries).toHaveLength(1)
    expect(useHistoryStore.getState().entries[0].type).toBe('batch_applied')
    expect(nodeCount()).toBe(2)

    // ── UNDO the AI batch ──────────────────────────────────────────────────
    const target = useHistoryStore.getState().undo(usePipelineStore.getState().currentPipeline!)
    expect(target!.nodes).toHaveLength(0) // pre-batch snapshot
    await restoreSnapshot(target!, 'undo')
    await flush()

    // (iv) undoing the AI batch restores the pre-batch (empty) graph.
    expect(nodeCount()).toBe(0)
    // restore is history-suppressed: still ONE entry, cursor at 0 (no loop).
    expect(useHistoryStore.getState().entries).toHaveLength(1)
    expect(useHistoryStore.getState().cursor).toBe(0)

    // ── REDO re-applies the AI batch ───────────────────────────────────────
    const fwd = useHistoryStore.getState().redo()
    expect(fwd!.nodes).toHaveLength(2)
    await restoreSnapshot(fwd!, 'redo')
    await flush()

    expect(nodeCount()).toBe(2)
    expect(useHistoryStore.getState().entries).toHaveLength(1)
    expect(useHistoryStore.getState().cursor).toBe(1)

    unsub()
  })

  it('a restore (actor undo/redo) does NOT add a visible history row even across multiple cycles', async () => {
    await usePipelineStore.getState().loadPipeline()
    const unsub = usePipelineStore.getState().subscribeLiveSync()

    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'x1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} }],
      { actor: 'ai:agent' },
    )
    await flush()
    expect(useHistoryStore.getState().entries).toHaveLength(1)

    // Three undo/redo cycles must never grow the entries array.
    for (let i = 0; i < 3; i++) {
      const t = useHistoryStore.getState().undo(usePipelineStore.getState().currentPipeline!)
      if (t) await restoreSnapshot(t, 'undo')
      await flush()
      const f = useHistoryStore.getState().redo()
      if (f) await restoreSnapshot(f, 'redo')
      await flush()
    }

    expect(useHistoryStore.getState().entries).toHaveLength(1)
    expect(useHistoryStore.getState().cursor).toBe(1)
    expect(nodeCount()).toBe(1)

    unsub()
  })
})
