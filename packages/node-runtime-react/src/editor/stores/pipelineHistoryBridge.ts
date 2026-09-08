// ── History bridge (programmatic batch → visible history panel) ────────────
//
// LOCAL UI ops record into useHistoryStore via the canvas hooks BEFORE applying
// (and then persist through applyBatch with actor 'editor'/'local'). PROGRAMMATIC
// mutations (POST /api/v1/batch from an AI agent / CLI / another client) never
// touch the editor store — they go applyBatch → history.jsonl → WS graph:applied
// → loadPipeline() → canvas reconcile, so they were invisible in the panel.
// `bridgeBatchToHistory` closes that gap: on a committed batch it looks the
// kernel history entry up by batchId and records ONE entry for non-local actors,
// labelled from the actor + op types. Local actors are skipped to avoid
// double-recording what the canvas hooks already logged.

import type { HistoryEntryV1 } from '@forgeax/node-runtime'
import { getEditorTransport } from '../transport/index.js'
import { useHistoryStore } from './historyStore.js'
import { createEmptyPipeline } from './pipelineStore.helpers.js'
import { historyActorTag, summarizeBatchOps, batchAffectedNodeIds } from './historyLabels.js'
import type { Pipeline } from '../types.js'

// Actors whose committed batches must NOT create a fresh visible-history row:
//   - `editor` / `local`: the canvas hooks already recorded the op locally
//     (BEFORE applying it), so bridging would double-record.
//   - `undo` / `redo`: these are HISTORY RESTORES — useCanvasUndoRedo re-applies
//     a stored snapshot through the canonical applyBatch/import path. Recording
//     them would double-count AND (worse) truncate + advance the cursor mid-undo,
//     corrupting the stack and risking an undo→record→undo loop. The cursor must
//     move ONLY via the undo/redo stack logic in useCanvasUndoRedo.
const HISTORY_SUPPRESSED_ACTORS = new Set(['editor', 'local', 'undo', 'redo'])

function isHistorySuppressedActor(actor: string): boolean {
  return HISTORY_SUPPRESSED_ACTORS.has(actor)
}

/**
 * Record a non-local committed batch into the editor history store so it shows
 * in the panel. `preSnapshot` is the pipeline state captured BEFORE loadPipeline
 * mutated the store (so undo can restore to the pre-batch graph). Idempotent per
 * batchId: a repeated graph:applied for the same batch is ignored.
 */
export async function bridgeBatchToHistory(batchId: string, preSnapshot: Pipeline | null): Promise<void> {
  // Synthetic local-apply events carry no batchId — nothing to bridge.
  if (!batchId) return

  // De-dup: the same committed batch may be announced more than once
  // (e.g. an in-process synth + a WS broadcast). One entry per batchId.
  if (useHistoryStore.getState().entries.some((e) => e.batchId === batchId)) return

  let entry: HistoryEntryV1 | undefined
  try {
    const history = await getEditorTransport().api.getHistory()
    entry = history.find((e) => e.batchId === batchId)
  } catch (error) {
    console.warn('[history-bridge] getHistory failed:', error)
    return
  }
  if (!entry) return

  // Local UI ops (already recorded by the canvas hooks) and undo/redo restores
  // (re-applying a stored snapshot) must not create a fresh history row.
  if (isHistorySuppressedActor(entry.actor)) return

  // Re-check de-dup after the await (a concurrent delivery may have raced in).
  if (useHistoryStore.getState().entries.some((e) => e.batchId === batchId)) return

  const summary = entry.label ?? `${historyActorTag(entry.actor)}: ${summarizeBatchOps(entry.ops)}`
  useHistoryStore.getState().record('batch_applied', preSnapshot ?? createEmptyPipeline(), {
    nodeIds: batchAffectedNodeIds(entry.ops),
    label: summary,
    labelEn: summary,
    batchId,
  })
}
