// WebSocket-style adapter over the kernel ApiClient subscription channels.
//
// The legacy editor talked to a bespoke `wsService` with an `.on(event, cb)` /
// `.send(msg)` bus. The stores and (later) components subscribe to a small set
// of editor events; here we wrap apiClient.subscribe('graph'|'execution', …)
// and translate kernel RuntimeEvents into those editor events.
//
// LIVE-SYNC (the North-Star "watch the AI work"):
//   Any graph mutation — human drag, AI tool call, CLI command — is committed
//   through applyBatch and announced on the 'graph' channel as 'graph:applied'.
//   We forward that as the editor event 'graph:applied'; the pipeline store
//   listens and refetches the snapshot, so the canvas updates the same way for
//   every actor. This replaces the legacy `canvas:op` agent-op fan-out: instead
//   of replaying per-op mutations on the client, we trust the kernel as the
//   single source of truth and re-pull on every committed batch.

import type { ApiClient } from '../../api/ApiClient.js'
import type { RuntimeEvent } from '@forgeax/node-runtime'

/** Editor-facing events the stores/components consume. */
export interface EditorEventMap {
  /** A batch was committed to the graph (by any actor). Payload carries the new hash. */
  'graph:applied': { batchId: string; newHash: string }
  /** A batch was rejected (e.g. hash mismatch). */
  'graph:rejected': { reason: string }
  /** Execution lifecycle. */
  'exec:started': { executionId: string }
  'exec:completed': { executionId: string }
  'exec:error': { executionId: string; nodeId?: string; message: string }
  /** A node produced output on a port during execution. */
  'node:output': { nodeId: string; portId: string; outputType: string }
  /** The active project changed elsewhere (another iframe / an agent tool). */
  'project:activated': { projectId: string; pipelineId: string; newHash: string }
}

export type EditorEvent = keyof EditorEventMap
type EditorHandler<E extends EditorEvent> = (payload: EditorEventMap[E]) => void

/**
 * Bridges kernel subscription channels to a typed editor event bus. One adapter
 * per ApiClient. `connect()` opens the underlying subscriptions; `dispose()`
 * tears them down. Handlers registered via `on()` survive reconnects because
 * the bus is independent of the channel subscriptions.
 */
export class WsAdapter {
  private readonly handlers = new Map<EditorEvent, Set<EditorHandler<EditorEvent>>>()
  private unsubGraph: (() => void) | null = null
  private unsubExec: (() => void) | null = null

  constructor(private readonly client: ApiClient) {}

  /** Open the kernel channel subscriptions. Idempotent. */
  connect(): void {
    if (this.unsubGraph || this.unsubExec) return
    this.unsubGraph = this.client.subscribe('graph', e => this.route(e))
    this.unsubExec = this.client.subscribe('execution', e => this.route(e))
  }

  /** Close the kernel channel subscriptions. Idempotent. Keeps registered handlers. */
  disconnect(): void {
    this.unsubGraph?.()
    this.unsubExec?.()
    this.unsubGraph = null
    this.unsubExec = null
  }

  /** Full teardown: close subscriptions and drop all handlers. */
  dispose(): void {
    this.disconnect()
    this.handlers.clear()
  }

  /** Register an editor-event listener. Returns an unsubscribe function. */
  on<E extends EditorEvent>(event: E, handler: EditorHandler<E>): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler as EditorHandler<EditorEvent>)
    return () => {
      this.handlers.get(event)?.delete(handler as EditorHandler<EditorEvent>)
    }
  }

  private emit<E extends EditorEvent>(event: E, payload: EditorEventMap[E]): void {
    const set = this.handlers.get(event)
    if (!set) return
    for (const h of set) {
      try {
        ;(h as EditorHandler<E>)(payload)
      } catch (err) {
        console.error(`[editor/ws] handler for ${event} threw:`, err)
      }
    }
  }

  /** Translate a kernel RuntimeEvent into the editor event bus. */
  private route(e: RuntimeEvent): void {
    switch (e.kind) {
      case 'graph:applied':
        this.emit('graph:applied', { batchId: e.batchId, newHash: e.newHash })
        return
      case 'graph:rejected':
        this.emit('graph:rejected', { reason: e.reason })
        return
      case 'exec:started':
        this.emit('exec:started', { executionId: e.executionId })
        return
      case 'exec:completed':
        this.emit('exec:completed', { executionId: e.executionId })
        return
      case 'exec:error':
        this.emit('exec:error', { executionId: e.executionId, nodeId: e.nodeId, message: e.message })
        return
      case 'exec:node:output':
        this.emit('node:output', { nodeId: e.nodeId, portId: e.portId, outputType: e.outputType })
        return
      case 'project:activated':
        this.emit('project:activated', { projectId: e.projectId, pipelineId: e.pipelineId, newHash: e.newHash })
        return
      default:
        // Asset events are not consumed by the generic editor stores.
        return
    }
  }
}
