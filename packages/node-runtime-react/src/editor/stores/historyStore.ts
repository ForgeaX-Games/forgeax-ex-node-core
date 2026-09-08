// History store — a unified entries[] + cursor undo/redo model.
//
//   entries[] — each record carries an action type, a label and the pipeline
//               snapshot taken BEFORE the operation.
//   cursor    — how many history steps are currently "in effect"
//               (0 = fully undone, entries.length = latest state).
//   _redoTip  — when leaving the latest state on the first undo, the current
//               pipeline is cached here so redo can return to it.
//
// Merge policy: consecutive same-type + same-node operations collapse into a
// single entry (keeping the first pre-op snapshot, refreshing label/timestamp).
//
// This is generic editor history — no app-level concerns — so it ports almost
// verbatim from the legacy editor, retargeted at the editor Pipeline type.

import { create } from 'zustand'

import type { HistoryEntryV1 } from '@forgeax/node-runtime'
import type { Pipeline } from '../types.js'
import { historyEntryV1ToView } from './historyLabels.js'

export type HistoryActionType =
  | 'add_node'
  | 'delete_node'
  | 'move_node'
  | 'move_nodes_batch'
  | 'connect_edge'
  | 'delete_edge'
  | 'paste_nodes'
  | 'resize_node'
  | 'edit_text'
  | 'change_param'
  | 'toggle_value'
  | 'toggle_preview'
  | 'load_pipeline'
  | 'group_nodes'
  | 'ungroup_nodes'
  | 'add_frame'
  | 'delete_frame'
  | 'rename_frame'
  // A committed kernel batch bridged in from a NON-LOCAL actor (AI / CLI /
  // another client) via the live-sync path. Local UI ops keep their specific
  // types above; this single type represents one whole programmatic batch.
  | 'batch_applied'

export interface HistoryEntry {
  id: string
  type: HistoryActionType
  timestamp: number
  label: string
  labelEn?: string
  nodeIds?: string[]
  edgeIds?: string[]
  /**
   * Kernel history batchId this entry was bridged from (only set for
   * `batch_applied` entries). Used to de-duplicate repeated `graph:applied`
   * deliveries for the same committed batch.
   */
  batchId?: string
  /** Full pipeline snapshot taken before the operation (for undo restore). */
  snapshot: Pipeline
}

const ACTION_LABELS: Record<HistoryActionType, string> = {
  add_node: 'Add node',
  delete_node: 'Delete node',
  move_node: 'Move node',
  move_nodes_batch: 'Move multiple',
  connect_edge: 'Connect',
  delete_edge: 'Delete connection',
  paste_nodes: 'Paste nodes',
  resize_node: 'Resize',
  edit_text: 'Edit text',
  change_param: 'Change parameter',
  toggle_value: 'Toggle',
  toggle_preview: 'Preview toggle',
  load_pipeline: 'Load pipeline',
  group_nodes: 'Group nodes',
  ungroup_nodes: 'Ungroup',
  add_frame: 'Create frame',
  delete_frame: 'Delete frame',
  rename_frame: 'Rename frame',
  batch_applied: 'Batch applied',
}

const MAX_ENTRIES = 50

function generateId(): string {
  return `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function clonePipeline(p: Pipeline): Pipeline {
  return JSON.parse(JSON.stringify(p))
}

function arraysEqual(a?: string[], b?: string[]): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

interface HistoryState {
  entries: HistoryEntry[]
  /** Steps currently in effect, in [0, entries.length]. */
  cursor: number
  /**
   * Count of leading entries hydrated from the persistent per-project backend
   * log (history.jsonl). These carry no real pre-op snapshot, so they are
   * DISPLAY-ONLY and form an undo floor: undo never walks below this index.
   */
  persistedCount: number
  /** Pipeline cached when leaving the latest state on undo; restored on redo. */
  _redoTip: Pipeline | null

  /**
   * Replace the visible history with the most-recent entries from the backend
   * per-project log (history.jsonl). Called on cold boot / refresh and on every
   * project switch so the panel reflects that project's persisted operations.
   * Hydrated rows are display-only (not undoable — see `persistedCount`).
   */
  hydrate: (entries: readonly HistoryEntryV1[]) => void

  /**
   * Record one operation. Call BEFORE applying it, passing the current
   * (pre-op) pipeline. Merge policy: if the previous step is the same
   * type + same nodes, refresh its label/timestamp instead of adding a row.
   */
  record: (
    type: HistoryActionType,
    currentPipeline: Pipeline,
    opts?: { nodeIds?: string[]; edgeIds?: string[]; label?: string; labelEn?: string; batchId?: string },
  ) => void

  /** Undo: move the cursor left, return the pipeline to restore (null = at start). */
  undo: (currentPipeline: Pipeline) => Pipeline | null

  /** Redo: move the cursor right, return the pipeline to restore (null = at end). */
  redo: () => Pipeline | null

  clearHistory: () => void
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  cursor: 0,
  persistedCount: 0,
  _redoTip: null,

  hydrate: (entries) => {
    const recent = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries
    const rows = recent.map(historyEntryV1ToView)
    set({ entries: rows, cursor: rows.length, persistedCount: rows.length, _redoTip: null })
  },

  record: (type, currentPipeline, opts = {}) => {
    const { entries, cursor } = get()
    const now = Date.now()

    // Merge: consecutive same-type + same-node → update the existing entry.
    // `batch_applied` entries are NEVER merged — each committed programmatic
    // batch is a discrete, undoable history step (and carries its own batchId).
    if (cursor > 0 && type !== 'batch_applied') {
      const last = entries[cursor - 1]
      if (last.type === type && arraysEqual(last.nodeIds, opts.nodeIds)) {
        const updated = [...entries]
        updated[cursor - 1] = {
          ...last,
          label: opts.label ?? last.label,
          labelEn: opts.labelEn ?? last.labelEn,
          timestamp: now,
        }
        set({ entries: updated })
        return
      }
    }

    // Truncate entries after the cursor (a new op discards the redo history).
    const base = entries.slice(0, cursor)
    const entry: HistoryEntry = {
      id: generateId(),
      type,
      timestamp: now,
      label: opts.label ?? ACTION_LABELS[type],
      labelEn: opts.labelEn ?? ACTION_LABELS[type],
      nodeIds: opts.nodeIds,
      edgeIds: opts.edgeIds,
      batchId: opts.batchId,
      snapshot: clonePipeline(currentPipeline),
    }
    const next = [...base, entry]
    // Trim from the front when over the cap; any hydrated (display-only) rows
    // dropped must shrink the undo floor in lockstep.
    let persistedCount = get().persistedCount
    if (next.length > MAX_ENTRIES) {
      const removeN = next.length - MAX_ENTRIES
      next.splice(0, removeN)
      persistedCount = Math.max(0, persistedCount - removeN)
    }
    set({ entries: next, cursor: next.length, persistedCount, _redoTip: null })
  },

  undo: (currentPipeline) => {
    const { entries, cursor, persistedCount } = get()
    // Floor at persistedCount: hydrated rows have no real pre-op snapshot.
    if (cursor <= persistedCount) return null

    // First undo from the latest state caches the current pipeline for redo.
    const redoTip = cursor === entries.length ? clonePipeline(currentPipeline) : get()._redoTip

    const newCursor = cursor - 1
    set({ cursor: newCursor, _redoTip: redoTip })
    return entries[newCursor].snapshot
  },

  redo: () => {
    const { entries, cursor, _redoTip } = get()
    if (cursor >= entries.length) return null

    const newCursor = cursor + 1
    set({ cursor: newCursor })

    if (newCursor === entries.length) {
      return _redoTip
    }
    return entries[newCursor].snapshot
  },

  clearHistory: () => set({ entries: [], cursor: 0, persistedCount: 0, _redoTip: null }),
}))
