// History label/shape helpers — shared by the live-sync bridge
// (pipelineHistoryBridge) and the per-project hydration path (historyStore).
//
// SSOT for "how a committed kernel batch is summarised into a visible-history
// row": both the bridge (recording a NON-LOCAL batch live) and `hydrate`
// (rebuilding the panel from history.jsonl on load/switch) derive their label,
// affected-node list and display row from the SAME functions here.

import type { HistoryEntryV1 } from '@forgeax/node-runtime'
import type { Pipeline } from '../types.js'
import { createEmptyPipeline } from './pipelineStore.helpers.js'
import type { HistoryEntry } from './historyStore.js'

/** A short, language-neutral tag for a kernel actor id (e.g. 'ai:gpt' → 'AI'). */
export function historyActorTag(actor: string): string {
  if (actor.startsWith('ai')) return 'AI'
  if (actor.startsWith('cli')) return 'CLI'
  return actor
}

/** Summarise a batch's ops as "createNode ×2, connect" (insertion order). */
export function summarizeBatchOps(ops: ReadonlyArray<Record<string, unknown>>): string {
  const counts = new Map<string, number>()
  for (const op of ops) {
    const type = typeof op.type === 'string' ? op.type : 'op'
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return (
    Array.from(counts.entries())
      .map(([type, n]) => (n > 1 ? `${type} ×${n}` : type))
      .join(', ') || 'no-op'
  )
}

/** The distinct node/group ids a batch touched (used for the history entry). */
export function batchAffectedNodeIds(ops: ReadonlyArray<Record<string, unknown>>): string[] {
  const ids = new Set<string>()
  for (const op of ops) {
    if (typeof op.nodeId === 'string') ids.add(op.nodeId)
    if (typeof op.groupId === 'string') ids.add(op.groupId)
    const source = op.source as { nodeId?: unknown } | undefined
    const target = op.target as { nodeId?: unknown } | undefined
    if (source && typeof source.nodeId === 'string') ids.add(source.nodeId)
    if (target && typeof target.nodeId === 'string') ids.add(target.nodeId)
  }
  return Array.from(ids)
}

/**
 * Map a persisted backend log entry → a display `HistoryEntry` for the panel.
 *
 * These rows are rebuilt from `history.jsonl` on load/switch and are
 * DISPLAY-ONLY: they carry an empty placeholder `snapshot` (the pre-op state is
 * not persisted), so they sit below the undo floor and are never restored.
 * Local 'editor' batches are persisted without a label, so we fall back to an
 * op-type summary; AI/CLI batches that annotated `label` keep their own text.
 */
export function historyEntryV1ToView(entry: HistoryEntryV1): HistoryEntry {
  const ts = Date.parse(entry.ts)
  const summary = entry.label ?? `${historyActorTag(entry.actor)}: ${summarizeBatchOps(entry.ops)}`
  const placeholder: Pipeline = createEmptyPipeline()
  return {
    id: entry.batchId,
    type: 'batch_applied',
    timestamp: Number.isNaN(ts) ? 0 : ts,
    label: summary,
    labelEn: summary,
    nodeIds: batchAffectedNodeIds(entry.ops),
    batchId: entry.batchId,
    snapshot: placeholder,
  }
}
