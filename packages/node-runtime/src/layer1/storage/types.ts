// Storage contracts. The kernel persists three artefacts per pipeline,
// each with strict invariants documented in
// docs/node-runtime-architecture/04-GRAPH-STATE.md:
//
//   graph.json           SSOT, overwrite-write, hash-validated
//   history.jsonl        append-only operation log
//   outputs/<id>/<port>  execution cache (can be discarded)

import type { GraphEdge, GraphNode, NodeGroup } from '../types/graph.js'

/** On-disk shape of graph.json. */
export interface GraphFileV1 {
  schemaVersion: 1
  id: string
  createdAt: string
  updatedAt: string
  /** sha256 of the canonical-form file content (everything except the hash field itself). */
  hash: string
  nodes: Record<string, GraphNode>
  edges: Record<string, GraphEdge>
  metadata?: Record<string, unknown>
  /** Composite-node sub-graphs (back-compat, optional). */
  groups?: Record<string, NodeGroup>
}

/** Operation log entry — each line of history.jsonl. */
export interface HistoryEntryV1 {
  schemaVersion: 1
  ts: string
  /** user / ai:<model-id> / cli / kernel:undo / kernel:migration / etc. */
  actor: string
  batchId: string
  prevHash: string
  newHash: string
  ops: ReadonlyArray<Record<string, unknown>>
  /**
   * Optional human-readable annotation for the batch (additive, v1-compatible).
   * AI / CLI callers may set this so editors can surface a meaningful history
   * label (e.g. "AI: 创建山脉 ×2") instead of an op-type summary. Absent on
   * pre-existing entries and on callers that do not annotate.
   */
  label?: string
}

/** Per-port output cache entry — written under outputs/<nodeId>/<portId>.json. */
export interface OutputCacheV1 {
  schemaVersion: 1
  valid: boolean
  executedAt: string
  /** graph.hash at execution time. */
  executedHash: string
  /** Logical type of the value (port type from OpSpec). */
  type: string
  /** Optional opaque preview metadata for UI panels. */
  preview?: Record<string, unknown>
  /** Inline JSON payload (small outputs). Mutually exclusive with binFile. */
  data?: unknown
  /** Path to a sibling .bin when the payload is large or binary. */
  binFile?: string
}

export type StorageError =
  | { kind: 'parse'; path: string; reason: string }
  | { kind: 'invariant'; reason: string }
  | { kind: 'concurrent-write'; expectedHash: string; actualHash: string }
  | { kind: 'io'; path: string; reason: string }
