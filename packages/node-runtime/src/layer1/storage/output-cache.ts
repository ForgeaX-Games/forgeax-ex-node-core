// outputs/<nodeId>/<portId>.{json,bin} — execution cache.
//
// Two responsibilities:
//   1. Persist per-port output values keyed by graph.hash so the next
//      partial-execute can decide whether the cached value is still valid.
//   2. Tear down nodes (and their downstream) when invalidated.
//
// `outputs/` is intentionally NOT the source of truth for produced assets —
// long-lived assets land in <gameRoot>/assets/ via the asset-resolver. This
// cache exists for incremental re-execution and UI replay.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { OutputCacheV1 } from './types.js'

export class OutputCache {
  constructor(private readonly root: string) {}

  /** Absolute path to the .json metadata file for one node/port. */
  jsonPath(nodeId: string, portId: string): string {
    return join(this.root, nodeId, `${portId}.json`)
  }

  /** Absolute path to the sibling .bin payload (if the entry uses an external blob). */
  binPath(nodeId: string, portId: string): string {
    return join(this.root, nodeId, `${portId}.bin`)
  }

  /** Read one cached entry. Returns null when missing or invalid JSON. */
  read(nodeId: string, portId: string): OutputCacheV1 | null {
    const p = this.jsonPath(nodeId, portId)
    if (!existsSync(p)) return null
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf-8')) as OutputCacheV1
      if (parsed.schemaVersion !== 1) return null
      return parsed
    } catch {
      return null
    }
  }

  /** Write a cached entry. Inline JSON when small, sibling .bin when binary. */
  write(nodeId: string, portId: string, entry: Omit<OutputCacheV1, 'schemaVersion'>, binPayload?: Buffer): void {
    const dir = join(this.root, nodeId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const finalEntry: OutputCacheV1 = { schemaVersion: 1, ...entry }
    if (binPayload !== undefined) {
      finalEntry.binFile = `${portId}.bin`
      delete (finalEntry as { data?: unknown }).data
      writeFileSync(this.binPath(nodeId, portId), binPayload)
    }
    writeFileSync(this.jsonPath(nodeId, portId), JSON.stringify(finalEntry, null, 2), 'utf-8')
  }

  /** Mark a node's cache invalid by writing valid:false on every existing port. */
  invalidate(nodeId: string): void {
    const dir = join(this.root, nodeId)
    if (!existsSync(dir)) return
    rmSync(dir, { recursive: true, force: true })
  }

  /** Clear the entire cache root. */
  clearAll(): void {
    if (!existsSync(this.root)) return
    rmSync(this.root, { recursive: true, force: true })
  }
}
