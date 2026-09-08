// Asset-resolver types.
//
// The kernel sees an asset as a typed, addressable byte blob under a root
// directory. It knows nothing about textures vs. scenes vs. tilemaps —
// plugins overlay domain meaning on top of these primitives.

export interface AssetDescriptor {
  /** Type prefix, e.g. 'textures', 'scenes', 'tilemaps'. */
  type: string
  /** Path relative to the asset root, including the type prefix. */
  relPath: string
  /** Absolute path on disk. */
  absPath: string
  size: number
  mtimeMs: number
}

export type AssetResolverEvent =
  | { kind: 'asset-added'; descriptor: AssetDescriptor }
  | { kind: 'asset-changed'; descriptor: AssetDescriptor }
  | { kind: 'asset-removed'; type: string; relPath: string; absPath: string }

export type AssetResolverEventHandler = (event: AssetResolverEvent) => void

export interface AssetListFilter {
  type?: string
  /** Glob-ish suffix, e.g. '.png'. Matches AssetDescriptor.relPath endsWith. */
  suffix?: string
}

export interface AssetResolverConfig {
  /** Absolute root directory. The resolver refuses to read/write outside it. */
  root: string
  /**
   * Optional list of type prefixes to scan/watch. When empty, every immediate
   * subdirectory of root is treated as a type bucket.
   */
  types?: readonly string[]
  /** Debounce window for the watcher emit, ms. Default 200. */
  debounceMs?: number
}

export type AssetUnsubscribe = () => void

export interface AssetResolver {
  /** Discover every existing asset under root. */
  list(filter?: AssetListFilter): AssetDescriptor[]
  /** Read a single asset by relative path (e.g. 'textures/foo.png'). Returns null when missing. */
  read(relPath: string): Buffer | null
  /** Write a single asset; creates parent dirs. Refuses to escape the root. */
  write(relPath: string, bytes: Buffer): AssetDescriptor
  /** Remove a single asset. No-op when missing. */
  remove(relPath: string): void
  /** Begin watching for asset changes. Returns an unsubscribe function. */
  watch(): AssetUnsubscribe
  /** Subscribe to events emitted by an active watcher. */
  subscribe(handler: AssetResolverEventHandler): AssetUnsubscribe
  /** Currently watching? */
  isWatching(): boolean
}
