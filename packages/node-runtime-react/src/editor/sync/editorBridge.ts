// Same-origin editor sync bridge.
//
// The editor renders across TWO separate same-origin iframes (a host app splits
// the surface into a center "canvas" pane mounting <Editor> and a side pane that
// hosts auxiliary controls). Each iframe runs its OWN copy of the kernel zustand
// singletons (uiStore / historyStore / pipelineStore), so live editor state in
// the center pane is invisible to the side pane.
//
// This module bridges the gap with a BroadcastChannel (origin-scoped, so two
// distinct plugins on different ports never cross-talk):
//   - the center <Editor> runs as the HOST: it publishes a compact snapshot of
//     the operation-history list + live status whenever those stores change, and
//     handles inbound commands (clear-history, request-state);
//   - any side pane creates a bridge on the same key, mirrors the snapshot for
//     display, and posts the occasional command back.
//
// Persisted UI prefs (langMode / theme / probeMode / …) are NOT carried here —
// those sync for free via cross-document `storage` events (see uiStore). Only
// ephemeral, non-persisted live state needs this channel.
//
// BroadcastChannel never delivers a message back to the instance that posted it;
// host and side panes live in different iframe contexts, so there is no echo to
// guard against.

import { useEffect } from 'react'

import type { PipelineStatus } from '../types.js'
import type { ConnectionStatus, HistoryActionType } from '../stores/index.js'
import { useHistoryStore, usePipelineStore, useUIStore } from '../stores/index.js'

const CHANNEL_PREFIX = 'forgeax-editor-sync:'

/** A history row as needed for the side-pane list (snapshot payload stripped). */
export interface HistoryEntryView {
  id: string
  type: HistoryActionType
  timestamp: number
  label: string
  labelEn?: string
}

/** Live status mirrored from the center editor's pipeline + ui stores. */
export interface EditorStatusView {
  connectionStatus: ConnectionStatus
  pipelineStatus: PipelineStatus
  /** Selected node's zh display name (or null when nothing is selected). */
  selectedNodeName: string | null
  /** Selected node's battery id (for the en label, resolved on the mirror side). */
  selectedNodeBatteryId: string | null
  nodeCount: number
  edgeCount: number
}

/** The full snapshot the host publishes to side panes. */
export interface EditorMirrorSnapshot {
  history: { entries: HistoryEntryView[]; cursor: number }
  status: EditorStatusView
}

/** Commands a side pane posts back to the host editor. */
export type EditorBridgeCommand = { type: 'clear-history' } | { type: 'request-state' }

export interface EditorBridge {
  publishState(snapshot: EditorMirrorSnapshot): void
  onState(cb: (snapshot: EditorMirrorSnapshot) => void): () => void
  sendCommand(cmd: EditorBridgeCommand): void
  onCommand(cb: (cmd: EditorBridgeCommand) => void): () => void
  close(): void
}

type BridgeMessage =
  | { kind: 'state'; payload: EditorMirrorSnapshot }
  | { kind: 'command'; payload: EditorBridgeCommand }

/**
 * Open a bridge on `key`. Degrades to an inert no-op bridge when
 * BroadcastChannel is unavailable (SSR / old environments) — callers never need
 * to branch on support.
 */
export function createEditorBridge(key: string): EditorBridge {
  const channelName = CHANNEL_PREFIX + key
  const channel =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null

  const stateCbs = new Set<(s: EditorMirrorSnapshot) => void>()
  const cmdCbs = new Set<(c: EditorBridgeCommand) => void>()

  if (channel) {
    channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as BridgeMessage | null
      if (!msg || typeof msg !== 'object') return
      if (msg.kind === 'state') stateCbs.forEach((cb) => cb(msg.payload))
      else if (msg.kind === 'command') cmdCbs.forEach((cb) => cb(msg.payload))
    }
  }

  return {
    publishState: (snapshot) => channel?.postMessage({ kind: 'state', payload: snapshot } satisfies BridgeMessage),
    onState: (cb) => {
      stateCbs.add(cb)
      return () => stateCbs.delete(cb)
    },
    sendCommand: (cmd) => channel?.postMessage({ kind: 'command', payload: cmd } satisfies BridgeMessage),
    onCommand: (cb) => {
      cmdCbs.add(cb)
      return () => cmdCbs.delete(cb)
    },
    close: () => {
      stateCbs.clear()
      cmdCbs.clear()
      channel?.close()
    },
  }
}

/** Build the current snapshot from the live kernel stores (host side). */
function buildSnapshot(): EditorMirrorSnapshot {
  const h = useHistoryStore.getState()
  const p = usePipelineStore.getState()
  const ui = useUIStore.getState()
  return {
    history: {
      entries: h.entries.map((e) => ({
        id: e.id,
        type: e.type,
        timestamp: e.timestamp,
        label: e.label,
        labelEn: e.labelEn,
      })),
      cursor: h.cursor,
    },
    status: {
      connectionStatus: ui.connectionStatus,
      pipelineStatus: p.pipelineStatus,
      selectedNodeName: p.selectedNode?.name ?? null,
      selectedNodeBatteryId: p.selectedNode?.batteryId ?? null,
      nodeCount: p.currentPipeline?.nodes.length ?? 0,
      edgeCount: p.currentPipeline?.edges.length ?? 0,
    },
  }
}

/**
 * Host-side broadcaster. Mounted by <Editor> when `editorSyncKey` is set:
 * republishes (rAF-debounced) on every history / pipeline / ui store change so a
 * side pane mirrors the editor live, and answers `request-state` from a
 * late-mounting side pane plus `clear-history` commands. No-op when key is unset.
 */
export function useEditorBroadcastHost(key: string | undefined): void {
  useEffect(() => {
    if (!key) return
    const bridge = createEditorBridge(key)

    let scheduled = false
    const publish = (): void => bridge.publishState(buildSnapshot())
    const schedule = (): void => {
      if (scheduled) return
      scheduled = true
      const run = (): void => {
        scheduled = false
        publish()
      }
      if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(run)
      else setTimeout(run, 16)
    }

    const unsubs = [
      useHistoryStore.subscribe(schedule),
      usePipelineStore.subscribe(schedule),
      useUIStore.subscribe(schedule),
    ]
    const offCmd = bridge.onCommand((cmd) => {
      if (cmd.type === 'clear-history') useHistoryStore.getState().clearHistory()
      else if (cmd.type === 'request-state') publish()
    })

    publish() // seed any side pane already listening

    return () => {
      unsubs.forEach((u) => u())
      offCmd()
      bridge.close()
    }
  }, [key])
}
