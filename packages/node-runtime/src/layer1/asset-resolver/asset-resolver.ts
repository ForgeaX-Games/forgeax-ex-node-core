// Asset-resolver — generic file resolver for assets under an asset root.
//
// Plugins use this to surface assets to ops (read/write) and to react to
// out-of-band file changes (an artist drops a new texture into the folder).
// The kernel deliberately does not bake in any asset-type vocabulary; the
// plugin chooses what 'textures' / 'scenes' / etc. mean by populating the
// `types` config.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type {
  AssetDescriptor,
  AssetResolverEvent,
  AssetResolverEventHandler,
  AssetListFilter,
  AssetResolver,
  AssetResolverConfig,
  AssetUnsubscribe,
} from './types.js'

/** Walk a directory recursively and yield every file with a stat. */
function walkFiles(root: string, out: { abs: string; size: number; mtimeMs: number }[]): void {
  if (!existsSync(root)) return
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const abs = join(root, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walkFiles(abs, out)
    } else if (st.isFile()) {
      out.push({ abs, size: st.size, mtimeMs: st.mtimeMs })
    }
  }
}

function describe(root: string, abs: string, size: number, mtimeMs: number): AssetDescriptor {
  const relPath = relative(root, abs).split(sep).join('/')
  const type = relPath.split('/')[0] ?? ''
  return { type, relPath, absPath: abs, size, mtimeMs }
}

function ensureWithinRoot(root: string, target: string): string {
  if (isAbsolute(target)) {
    throw new Error(`asset path must be root-relative, got absolute: ${target}`)
  }
  const resolved = resolve(root, target)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`asset path escapes root: ${target}`)
  }
  return resolved
}

export function createAssetResolver(config: AssetResolverConfig): AssetResolver {
  const root = config.root
  const debounceMs = config.debounceMs ?? 200
  const subscribers = new Set<AssetResolverEventHandler>()
  let watcher: { close: () => Promise<void> } | null = null
  let debounceTimer: NodeJS.Timeout | null = null
  /** Last-seen file map to compute add/change/remove on each rescan. */
  const seen = new Map<string, { size: number; mtimeMs: number }>()

  function emit(event: AssetResolverEvent): void {
    for (const sub of subscribers) {
      try {
        sub(event)
      } catch {
        /* one bad listener should not poison others */
      }
    }
  }

  function scanRoots(): { abs: string; size: number; mtimeMs: number }[] {
    if (config.types && config.types.length > 0) {
      const found: { abs: string; size: number; mtimeMs: number }[] = []
      for (const t of config.types) walkFiles(join(root, t), found)
      return found
    }
    const found: { abs: string; size: number; mtimeMs: number }[] = []
    walkFiles(root, found)
    return found
  }

  function rescan(): void {
    const current = scanRoots()
    const currentMap = new Map<string, { size: number; mtimeMs: number }>()
    for (const f of current) currentMap.set(f.abs, { size: f.size, mtimeMs: f.mtimeMs })

    // adds + changes
    for (const [abs, info] of currentMap.entries()) {
      const prev = seen.get(abs)
      if (!prev) {
        emit({ kind: 'asset-added', descriptor: describe(root, abs, info.size, info.mtimeMs) })
      } else if (prev.mtimeMs !== info.mtimeMs || prev.size !== info.size) {
        emit({ kind: 'asset-changed', descriptor: describe(root, abs, info.size, info.mtimeMs) })
      }
    }
    // removals
    for (const abs of seen.keys()) {
      if (currentMap.has(abs)) continue
      const relPath = relative(root, abs).split(sep).join('/')
      const type = relPath.split('/')[0] ?? ''
      emit({ kind: 'asset-removed', type, relPath, absPath: abs })
    }
    seen.clear()
    for (const [abs, info] of currentMap) seen.set(abs, info)
  }

  function list(filter?: AssetListFilter): AssetDescriptor[] {
    const found = scanRoots()
    const all = found.map((f) => describe(root, f.abs, f.size, f.mtimeMs))
    if (!filter) return all
    return all.filter((d) => {
      if (filter.type !== undefined && d.type !== filter.type) return false
      if (filter.suffix !== undefined && !d.relPath.endsWith(filter.suffix)) return false
      return true
    })
  }

  function read(relPath: string): Buffer | null {
    const abs = ensureWithinRoot(root, relPath)
    if (!existsSync(abs)) return null
    return readFileSync(abs)
  }

  function write(relPath: string, bytes: Buffer): AssetDescriptor {
    const abs = ensureWithinRoot(root, relPath)
    const dir = dirname(abs)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(abs, bytes)
    const st = statSync(abs)
    return describe(root, abs, st.size, st.mtimeMs)
  }

  function remove(relPath: string): void {
    const abs = ensureWithinRoot(root, relPath)
    if (!existsSync(abs)) return
    rmSync(abs, { force: true })
  }

  function subscribe(handler: AssetResolverEventHandler): AssetUnsubscribe {
    subscribers.add(handler)
    return () => {
      subscribers.delete(handler)
    }
  }

  function watch(): AssetUnsubscribe {
    if (watcher) return () => undefined
    let unsubscribed = false
    // Prime the seen-set so first event reflects future changes only.
    for (const f of scanRoots()) seen.set(f.abs, { size: f.size, mtimeMs: f.mtimeMs })

    void (async (): Promise<void> => {
      const chokidar = (await import('chokidar')) as typeof import('chokidar')
      if (unsubscribed) return
      const targets = config.types && config.types.length > 0 ? config.types.map((t) => join(root, t)) : [root]
      const w = chokidar.watch(targets, {
        ignoreInitial: true,
        ignored: (p: string) => /node_modules|(^|\/|\\)\../.test(p),
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      })
      const trigger = (): void => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(rescan, debounceMs)
      }
      w.on('add', trigger)
      w.on('change', trigger)
      w.on('unlink', trigger)
      w.on('addDir', trigger)
      w.on('unlinkDir', trigger)
      watcher = w as unknown as { close: () => Promise<void> }
    })()

    return (): void => {
      unsubscribed = true
      if (debounceTimer) clearTimeout(debounceTimer)
      void watcher?.close()
      watcher = null
      seen.clear()
    }
  }

  function isWatching(): boolean {
    return watcher !== null
  }

  return { list, read, write, remove, subscribe, watch, isWatching }
}
