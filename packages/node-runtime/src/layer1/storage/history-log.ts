// history.jsonl — append-only operation log.
//
// Each line is a single JSON object describing one applyBatch call.
// Invariants:
//   * line N's prevHash == line N-1's newHash (chained)
//   * last line's newHash == graph.json.hash
//   * lines are never edited or removed (kernel:undo appends a forward
//     entry rather than rewinding)
//
// The kernel writes one line per successful batch using fs.appendFileSync
// for atomic append on POSIX. Concurrent writers must serialise externally;
// this class does not implement file locks.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { HistoryEntryV1 } from './types.js'

export class HistoryLog {
  constructor(private readonly path: string) {}

  exists(): boolean {
    return existsSync(this.path)
  }

  /** Append one entry. Validates schemaVersion + chains prevHash to the existing tip. */
  append(entry: HistoryEntryV1): void {
    if (entry.schemaVersion !== 1) {
      throw new Error(`history entry schemaVersion=${entry.schemaVersion} is not supported`)
    }
    const dir = dirname(this.path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const line = JSON.stringify(entry) + '\n'
    appendFileSync(this.path, line, 'utf-8')
  }

  /** Read every entry (entire log). For long histories use stream() instead. */
  readAll(): HistoryEntryV1[] {
    if (!existsSync(this.path)) return []
    const lines = readFileSync(this.path, 'utf-8').split('\n').filter(Boolean)
    return lines.map((line, idx) => {
      try {
        const e = JSON.parse(line) as HistoryEntryV1
        if (e.schemaVersion !== 1) {
          throw new Error(`schemaVersion=${e.schemaVersion} not supported`)
        }
        return e
      } catch (err) {
        throw new Error(
          `history.jsonl parse failed at line ${idx + 1}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    })
  }

  /** Tip's newHash, or undefined when empty. */
  tipHash(): string | undefined {
    const all = this.readAll()
    return all.length > 0 ? all[all.length - 1].newHash : undefined
  }

  /** Walk every entry; useful for huge histories where readAll would OOM. */
  *stream(): IterableIterator<HistoryEntryV1> {
    if (!existsSync(this.path)) return
    const raw = readFileSync(this.path, 'utf-8')
    let start = 0
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== '\n') continue
      const line = raw.slice(start, i)
      start = i + 1
      if (!line) continue
      yield JSON.parse(line) as HistoryEntryV1
    }
    // Tail without trailing newline.
    if (start < raw.length) {
      const line = raw.slice(start)
      if (line) yield JSON.parse(line) as HistoryEntryV1
    }
  }

  /**
   * Validate the chain integrity and (optionally) match the final newHash
   * against an external graph hash. Returns the index of the first broken
   * link, or null if everything checks out.
   */
  validate(opts: { expectedTipHash?: string } = {}): { ok: true } | { ok: false; reason: string; lineIndex?: number } {
    const all = this.readAll()
    if (all.length === 0) {
      return opts.expectedTipHash === undefined
        ? { ok: true }
        : { ok: false, reason: 'history is empty but expectedTipHash given' }
    }
    for (let i = 1; i < all.length; i++) {
      if (all[i].prevHash !== all[i - 1].newHash) {
        return {
          ok: false,
          reason: `chain break: line ${i + 1} prevHash=${all[i].prevHash} != line ${i} newHash=${all[i - 1].newHash}`,
          lineIndex: i,
        }
      }
    }
    if (opts.expectedTipHash !== undefined && all[all.length - 1].newHash !== opts.expectedTipHash) {
      return {
        ok: false,
        reason: `tip mismatch: history newHash=${all[all.length - 1].newHash} != expected=${opts.expectedTipHash}`,
        lineIndex: all.length - 1,
      }
    }
    return { ok: true }
  }
}
