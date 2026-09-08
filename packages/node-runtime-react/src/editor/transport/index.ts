// Editor transport: the single point where the faithful editor's data layer
// binds to a kernel ApiClient. Build a transport from a client, then hand it to
// the stores via configureEditorTransport(). Tests can inject a transport built
// over createMockApiClient().

import type { ApiClient } from '../../api/ApiClient.js'
import { EditorApiAdapter } from './apiAdapter.js'
import { WsAdapter } from './wsAdapter.js'

export { EditorApiAdapter } from './apiAdapter.js'
export type { ApplyResult, ApplyDiagnostic, ImportPipelineResult } from './apiAdapter.js'
export { WsAdapter } from './wsAdapter.js'
export type { EditorEvent, EditorEventMap } from './wsAdapter.js'
export {
  diffPipelineToOps,
  graphEdgeToPipelineEdge,
  graphNodeToPipelineNode,
  legacyPipelineToOps,
  opSpecToBattery,
  snapshotToPipeline,
} from './mappers.js'
export type { LegacyPipelineToOpsOptions, LegacyPipelineToOpsResult } from './mappers.js'

/** The data + event surface the editor stores talk to. */
export interface EditorTransport {
  readonly api: EditorApiAdapter
  readonly ws: WsAdapter
  /** Open the live-sync subscriptions. */
  connect(): void
  /** Tear everything down. */
  dispose(): void
}

/** Build an EditorTransport over a kernel ApiClient. Does not auto-connect. */
export function createEditorTransport(client: ApiClient): EditorTransport {
  const api = new EditorApiAdapter(client)
  const ws = new WsAdapter(client)
  return {
    api,
    ws,
    connect: () => ws.connect(),
    dispose: () => ws.dispose(),
  }
}

// ── Module-level transport injection ──────────────────────────────────────
//
// The editor stores are zustand module singletons (matching the legacy editor)
// and therefore cannot take a client as a constructor argument. Instead the
// host app (or a test) builds a transport and registers it here once at boot.
// Stores read the active transport through getEditorTransport().

let _activeTransport: EditorTransport | null = null

/** Register the active transport. Pass null to clear (e.g. test teardown). */
export function configureEditorTransport(transport: EditorTransport | null): void {
  _activeTransport = transport
}

/** The active transport. Throws if none configured — a clear programmer error. */
export function getEditorTransport(): EditorTransport {
  if (!_activeTransport) {
    throw new Error(
      '[editor] no transport configured — call configureEditorTransport(createEditorTransport(client)) at boot',
    )
  }
  return _activeTransport
}

/** The active transport, or null if not configured. Non-throwing variant. */
export function peekEditorTransport(): EditorTransport | null {
  return _activeTransport
}
