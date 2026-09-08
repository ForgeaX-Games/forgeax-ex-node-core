// Global Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z keyboard undo/redo for the editor.
//
// Ported from the legacy editor's useCanvasUndoRedo, retargeted at the kernel
// SSOT model. The legacy editor restored the snapshot at the history cursor by
// mutating local React state (sessionRestorePending). Here the editor is a thin
// view over the kernel graph, so a restore MUST go back through the backend
// authoritatively — otherwise the kernel + previews desync from the canvas.
//
// Flow on undo/redo:
//   1. useHistoryStore.undo(currentPipeline) / .redo() moves the cursor and
//      returns the target pipeline snapshot (pre-op snapshots; see historyStore).
//   2. We apply that snapshot to the kernel via importPipeline (REPLACE) with an
//      `undo` / `redo` actor, so the graph round-trips the canonical path:
//        applyBatch → graph:applied → loadPipeline → pipelineRevision++ →
//        useCanvasGraphSync reconcile → preview refresh (exec:completed).
//
// Loop guard: the history bridge (pipelineStore) treats `undo`/`redo` as
// history-suppressed actors, so re-applying a snapshot does NOT record a fresh
// `batch_applied` entry. The history cursor moves ONLY via the undo/redo stack
// logic here — never via the bridge.

import { useEffect } from 'react'

import { getEditorTransport } from '../../transport/index.js'
import { usePipelineStore } from '../../stores/pipelineStore.js'
import { useHistoryStore } from '../../stores/historyStore.js'
import type { Pipeline } from '../../types.js'

/**
 * Restore a target pipeline snapshot to the kernel authoritatively. Routed
 * through importPipeline in REPLACE mode so groups / annotations / frames /
 * viewport round-trip alongside nodes + edges, exactly like the legacy
 * snapshot restore — but via the canonical kernel apply path (no local-state
 * desync). The `undo` / `redo` actor is history-suppressed in the bridge.
 */
export async function restoreSnapshot(snapshot: Pipeline, actor: 'undo' | 'redo'): Promise<void> {
  try {
    await getEditorTransport().api.importPipeline(snapshot, {
      mode: 'replace',
      actor,
      label: actor === 'undo' ? 'Undo' : 'Redo',
    })
  } catch (error) {
    console.error(`[undo-redo] ${actor} restore failed:`, error)
  }
}

export function useCanvasUndoRedo(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const metaOrCtrl = isMac ? e.metaKey : e.ctrlKey
      if (!metaOrCtrl) return

      // Never hijack typing in form fields (matches legacy).
      const tag = (e.target as HTMLElement | null)?.tagName?.toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const key = e.key.toLowerCase()
      const isUndo = key === 'z' && !e.shiftKey
      const isRedo = key === 'y' || (key === 'z' && e.shiftKey)
      if (!isUndo && !isRedo) return

      e.preventDefault()
      e.stopPropagation()

      const { undo, redo } = useHistoryStore.getState()
      const { currentPipeline } = usePipelineStore.getState()
      if (!currentPipeline) return

      // undo() needs the live pipeline to cache the redo tip when leaving the
      // latest state; redo() reads its own cached tip / entry snapshot.
      const snapshot = isUndo ? undo(currentPipeline) : redo()
      if (snapshot) void restoreSnapshot(snapshot, isUndo ? 'undo' : 'redo')
    }

    // Capture phase + stopPropagation so ReactFlow's own key handlers (and the
    // Ctrl+G group handler) never see the undo/redo chord.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
