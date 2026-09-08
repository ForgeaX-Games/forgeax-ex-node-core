// Battery (op) loader — main implementation.
//
// Walks every configured scanDir, parses meta.json, dynamic-imports
// index.ts to obtain the execute function, builds an OpSpec, and registers
// it with the kernel registry. Hot-reload via chokidar watches the same
// scanDirs and emits per-folder add/remove/update events.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { OpRegistry } from '../op-registry.js'
import type { ExecutionContext, OpSpec } from '../types/op-spec.js'
import { metaToOpSpec } from './meta-parser.js'
import type {
  BatteryLoader,
  BatteryLoaderConfig,
  BatteryMeta,
  LoaderEvent,
  LoaderUnsubscribe,
  ScanError,
  ScanResult,
} from './types.js'

interface LoadedOp {
  /** Source directory of the battery. */
  dir: string
  /** Stable id under which the op is registered. */
  id: string
  /** mtimeMs of meta.json — drives update detection. */
  metaMtime: number
}

export function createBatteryLoader(
  registry: OpRegistry,
  config: BatteryLoaderConfig,
): BatteryLoader {
  const loaded = new Map<string, LoadedOp>() // key = dir
  const subscribers = new Set<(event: LoaderEvent) => void>()
  let watcher: { close: () => Promise<void> } | null = null

  function emit(event: LoaderEvent): void {
    for (const sub of subscribers) {
      try {
        sub(event)
      } catch {
        /* swallow subscriber errors so one bad listener does not poison the loader */
      }
    }
  }

  function listSubdirectories(dir: string): string[] {
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir)
        .filter((name) => {
          if (name.startsWith('.') || name === 'node_modules') return false
          try {
            return statSync(join(dir, name)).isDirectory()
          } catch {
            return false
          }
        })
        // Deterministic walk order: readdirSync returns entries in raw
        // filesystem order, which differs across machines/filesystems. Sorting
        // makes the scan order — and therefore which directory wins an id
        // collision (see the duplicate-id guard in scan()) — reproducible.
        .sort()
    } catch {
      return []
    }
  }

  /**
   * Recursively find every directory that contains a meta.json. The kernel
   * does not impose a fixed depth — plugins are free to use 2-level / 3-level
   * / mixed layouts. The walk is bounded by node_modules / dotfile filtering.
   */
  function findBatteryDirs(root: string, out: string[]): void {
    if (!existsSync(root)) return
    let isLeaf = false
    if (existsSync(join(root, 'meta.json'))) {
      out.push(root)
      isLeaf = true
    }
    if (isLeaf) return
    for (const child of listSubdirectories(root)) {
      findBatteryDirs(join(root, child), out)
    }
  }

  async function loadOne(dir: string, errors: ScanError[]): Promise<OpSpec | null> {
    const metaPath = join(dir, 'meta.json')
    if (!existsSync(metaPath)) return null

    let meta: BatteryMeta
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as BatteryMeta
    } catch (e) {
      errors.push({ dir, reason: `meta.json parse failed: ${e instanceof Error ? e.message : String(e)}` })
      return null
    }

    const fallbackId = meta.id ?? `${config.pluginId}.${basename(dir)}`
    const baseSpec = metaToOpSpec(meta, fallbackId)
    const filteredId = config.filter ? config.filter(baseSpec.id, dir) : baseSpec.id
    if (filteredId === null) return null
    const finalId = filteredId

    // Dynamic import of index.ts to get the execute closure.
    const indexPath = join(dir, 'index.ts')
    const indexJsPath = join(dir, 'index.js')
    const entryPath = existsSync(indexPath) ? indexPath : existsSync(indexJsPath) ? indexJsPath : null

    if (!entryPath) {
      errors.push({ dir, reason: 'index.ts / index.js not found' })
      return null
    }

    let entryModule: Record<string, unknown>
    try {
      entryModule = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>
    } catch (e) {
      errors.push({
        dir,
        reason: `dynamic import failed: ${e instanceof Error ? e.message : String(e)}`,
      })
      return null
    }

    // Convention: first lowercase-named exported function is the entry.
    const entryFn = Object.values(entryModule).find(
      (v) =>
        typeof v === 'function' &&
        /^[a-z]/.test((v as { name: string }).name),
    ) as ((input: Record<string, unknown>, ctx?: ExecutionContext) => unknown) | undefined

    if (!entryFn) {
      errors.push({ dir, reason: 'no lowercase-named entry function exported' })
      return null
    }

    const op: OpSpec = {
      ...baseSpec,
      id: finalId,
      execute: (ctx, args) => entryFn(args, ctx),
    }
    return op
  }

  async function scan(): Promise<ScanResult> {
    const result: ScanResult = { added: 0, updated: 0, removed: 0, errors: [] }
    const visitedDirs = new Set<string>()
    // Duplicate-id guard. The walk is deterministic (listSubdirectories sorts),
    // so the FIRST directory to claim an id wins; any later directory re-using
    // the same id is reported and skipped instead of silently overwriting the
    // winner in filesystem order. (Distinct dirs with distinct meta ids are
    // fine — only a true id clash across two directories is flagged.)
    const seenIds = new Map<string, string>() // op id -> winning source dir
    const noteWinner = (id: string, dir: string): void => {
      if (!seenIds.has(id)) seenIds.set(id, dir)
    }

    for (const root of config.scanDirs) {
      const dirs: string[] = []
      findBatteryDirs(root, dirs)
      for (const dir of dirs) {
        visitedDirs.add(dir)
        const metaMtime = (() => {
          try {
            return statSync(join(dir, 'meta.json')).mtimeMs
          } catch {
            return 0
          }
        })()

        const prev = loaded.get(dir)
        if (prev && prev.metaMtime === metaMtime && registry.has(prev.id)) {
          // No change.
          noteWinner(prev.id, dir)
          continue
        }

        const op = await loadOne(dir, result.errors)
        if (!op) continue

        const winner = seenIds.get(op.id)
        if (winner !== undefined && winner !== dir) {
          result.errors.push({
            dir,
            reason: `duplicate op id "${op.id}" — already provided by "${winner}"; skipping this duplicate (op ids must be unique across battery directories)`,
          })
          continue
        }
        noteWinner(op.id, dir)

        if (prev) {
          // Update path: re-register under the same id.
          if (prev.id !== op.id) {
            // Id changed — drop the old, register the new.
            registry.unregister(prev.id)
            emit({ kind: 'op-removed', opId: prev.id, sourceDir: dir })
          }
          registry.replace(op)
          loaded.set(dir, { dir, id: op.id, metaMtime })
          result.updated++
          emit({ kind: 'op-updated', opId: op.id, sourceDir: dir })
        } else {
          registry.replace(op)
          loaded.set(dir, { dir, id: op.id, metaMtime })
          result.added++
          emit({ kind: 'op-added', opId: op.id, sourceDir: dir })
        }
      }
    }

    // Detect removals: anything in `loaded` whose dir was not visited.
    for (const [dir, info] of loaded.entries()) {
      if (visitedDirs.has(dir)) continue
      registry.unregister(info.id)
      loaded.delete(dir)
      result.removed++
      emit({ kind: 'op-removed', opId: info.id, sourceDir: dir })
    }

    for (const error of result.errors) emit({ kind: 'scan-error', error })
    return result
  }

  async function reload(): Promise<ScanResult> {
    return scan()
  }

  function startWatching(): LoaderUnsubscribe {
    if (!config.watch) return () => undefined
    if (watcher) return () => undefined

    // Lazily load chokidar to avoid forcing the dep on consumers that do not watch.
    let unsubscribed = false
    let debounceTimer: NodeJS.Timeout | null = null

    void (async (): Promise<void> => {
      // dynamic import — the dep is declared but only loaded when watch=true.
      const chokidar = (await import('chokidar')) as typeof import('chokidar')
      if (unsubscribed) return
      const w = chokidar.watch(config.scanDirs as string[], {
        ignoreInitial: true,
        ignored: (p: string) => /node_modules|(^|\/)\../.test(p),
      })
      const triggerRescan = (): void => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          void scan()
        }, 200)
      }
      w.on('add', triggerRescan)
      w.on('change', triggerRescan)
      w.on('unlink', triggerRescan)
      w.on('addDir', triggerRescan)
      w.on('unlinkDir', triggerRescan)
      watcher = w as unknown as { close: () => Promise<void> }
    })()

    return (): void => {
      unsubscribed = true
      if (debounceTimer) clearTimeout(debounceTimer)
      void watcher?.close()
      watcher = null
    }
  }

  function subscribe(handler: (event: LoaderEvent) => void): LoaderUnsubscribe {
    subscribers.add(handler)
    return () => {
      subscribers.delete(handler)
    }
  }

  function list(): readonly string[] {
    return [...loaded.values()].map((l) => l.id)
  }

  return { scan, reload, startWatching, subscribe, list }
}
