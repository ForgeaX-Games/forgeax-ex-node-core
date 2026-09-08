// Per-project history hydration contract.
//
// `hydrate` rebuilds the visible panel from the persistent backend log
// (history.jsonl) on load / project switch. Hydrated rows are DISPLAY-ONLY:
// they carry no real pre-op snapshot, so `persistedCount` forms an undo floor
// that undo never crosses. New live ops recorded on top ARE undoable, and the
// MAX_ENTRIES front-trim shrinks the floor in lockstep.

import { beforeEach, describe, expect, it } from 'vitest'

import type { HistoryEntryV1 } from '@forgeax/node-runtime'

import { useHistoryStore } from '../stores/historyStore.js'
import { createEmptyPipeline } from '../stores/pipelineStore.helpers.js'

function backendEntry(i: number, over: Partial<HistoryEntryV1> = {}): HistoryEntryV1 {
  return {
    schemaVersion: 1,
    ts: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    actor: 'editor',
    batchId: `batch-${i}`,
    prevHash: `h${i}`,
    newHash: `h${i + 1}`,
    ops: [{ type: 'createNode', nodeId: `n${i}` }],
    ...over,
  }
}

beforeEach(() => {
  useHistoryStore.setState({ entries: [], cursor: 0, persistedCount: 0, _redoTip: null })
})

describe('historyStore hydrate', () => {
  it('rebuilds display rows from the backend log and marks them as the undo floor', () => {
    useHistoryStore.getState().hydrate([backendEntry(0), backendEntry(1, { label: 'AI: 创建山脉 ×2' })])

    const s = useHistoryStore.getState()
    expect(s.entries).toHaveLength(2)
    expect(s.cursor).toBe(2)
    expect(s.persistedCount).toBe(2)
    // Local 'editor' batch with no label → op-type summary; annotated → kept.
    expect(s.entries[0].label).toContain('createNode')
    expect(s.entries[1].label).toBe('AI: 创建山脉 ×2')
    expect(s.entries[0].batchId).toBe('batch-0')
  })

  it('does not undo into hydrated (snapshot-less) rows', () => {
    const store = useHistoryStore.getState()
    store.hydrate([backendEntry(0), backendEntry(1)])

    // At the floor: undo is a no-op.
    expect(store.undo(createEmptyPipeline())).toBeNull()
    expect(useHistoryStore.getState().cursor).toBe(2)

    // A fresh live op is undoable exactly once, then we hit the floor again.
    store.record('add_node', createEmptyPipeline(), { nodeIds: ['live1'], label: 'Add node' })
    expect(useHistoryStore.getState().cursor).toBe(3)
    expect(useHistoryStore.getState().persistedCount).toBe(2)

    expect(useHistoryStore.getState().undo(createEmptyPipeline())).not.toBeNull()
    expect(useHistoryStore.getState().cursor).toBe(2)
    expect(useHistoryStore.getState().undo(createEmptyPipeline())).toBeNull()
    expect(useHistoryStore.getState().cursor).toBe(2)
  })

  it('keeps only the most-recent MAX_ENTRIES and shrinks the floor when trimming', () => {
    // 50 = MAX_ENTRIES. Hydrate the cap, then record one more → front-trim by 1.
    const many = Array.from({ length: 50 }, (_, i) => backendEntry(i))
    useHistoryStore.getState().hydrate(many)
    expect(useHistoryStore.getState().persistedCount).toBe(50)

    useHistoryStore.getState().record('add_node', createEmptyPipeline(), { nodeIds: ['x'], label: 'Add node' })

    const s = useHistoryStore.getState()
    expect(s.entries).toHaveLength(50)
    expect(s.persistedCount).toBe(49) // one hydrated row dropped from the front
    expect(s.entries[s.entries.length - 1].label).toBe('Add node')
  })

  it('hydrate keeps only the tail when the log exceeds MAX_ENTRIES', () => {
    const many = Array.from({ length: 60 }, (_, i) => backendEntry(i))
    useHistoryStore.getState().hydrate(many)

    const s = useHistoryStore.getState()
    expect(s.entries).toHaveLength(50)
    expect(s.entries[0].batchId).toBe('batch-10') // oldest 10 dropped
    expect(s.entries[s.entries.length - 1].batchId).toBe('batch-59')
  })
})
