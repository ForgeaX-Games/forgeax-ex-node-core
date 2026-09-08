// graph.json SSOT — load / save with atomic write + hash invariant.
//
// On every successful save:
//   1. canonicalise the payload (sorted keys, no hash field)
//   2. compute sha256 over the canonical bytes
//   3. write to a sibling temp file then rename — atomic on POSIX FS
// On load, the stored hash must match the recomputed canonical hash;
// mismatches are surfaced as an 'invariant' StorageError.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { GraphFileV1 } from './types.js'

/** Stable, deterministic JSON canonicalisation: sorted keys at every level. */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj).sort()) out[k] = canonicalize(obj[k])
  return out
}

/** Compute the hash that goes into graph.json.hash. Excludes the hash field itself. */
export function computeGraphHash(graph: Omit<GraphFileV1, 'hash'> & { hash?: string }): string {
  const { hash: _drop, ...rest } = graph
  void _drop
  const canon = JSON.stringify(canonicalize(rest))
  return createHash('sha256').update(canon).digest('hex')
}

export class GraphStore {
  constructor(private readonly path: string) {}

  exists(): boolean {
    return existsSync(this.path)
  }

  /**
   * Load and validate. Returns null when the file does not exist.
   * Throws on hash mismatch or schema mismatch — caller decides whether
   * to recover (e.g. record a `kernel:migration` history entry) or refuse.
   */
  load(): GraphFileV1 | null {
    if (!existsSync(this.path)) return null
    let parsed: GraphFileV1
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as GraphFileV1
    } catch (e) {
      throw new Error(`graph.json parse failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (parsed.schemaVersion !== 1) {
      throw new Error(`graph.json schemaVersion=${parsed.schemaVersion} is not supported`)
    }
    const recomputed = computeGraphHash(parsed)
    if (recomputed !== parsed.hash) {
      throw new Error(
        `graph.json hash mismatch — file may have been edited externally (stored=${parsed.hash}, recomputed=${recomputed})`,
      )
    }
    return parsed
  }

  /**
   * Atomic save with optimistic concurrency check.
   *
   * When `expectedPrevHash` is given, the function reads the current
   * file (if any) and ensures its hash matches before overwriting.
   * Mismatch → throw; the caller must reload, rebase the change, and retry.
   *
   * The supplied graph's `hash` field is overwritten with the
   * recomputed canonical hash before writing.
   */
  save(graph: Omit<GraphFileV1, 'hash'> & { hash?: string }, opts: { expectedPrevHash?: string } = {}): GraphFileV1 {
    if (opts.expectedPrevHash !== undefined && existsSync(this.path)) {
      const current = this.load()
      const currentHash = current?.hash ?? '<missing>'
      if (currentHash !== opts.expectedPrevHash) {
        throw new Error(
          `concurrent-write: graph.json was changed since the caller's read (expected=${opts.expectedPrevHash}, actual=${currentHash})`,
        )
      }
    }

    const finalHash = computeGraphHash(graph)
    const finalGraph: GraphFileV1 = { ...(graph as GraphFileV1), hash: finalHash, schemaVersion: 1 }

    const dir = dirname(this.path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${this.path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    writeFileSync(tmp, JSON.stringify(finalGraph, null, 2), 'utf-8')
    renameSync(tmp, this.path)
    return finalGraph
  }
}
