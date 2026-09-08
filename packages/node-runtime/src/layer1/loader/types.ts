// Battery (op) loader public types.
//
// Plugins call createBatteryLoader(registry, config) at boot to auto-register
// every op found under their configured `materials/batteries/...` directory
// tree. The kernel does not know what ops exist at compile time; new ops are
// added by dropping a folder.

/** Scan layouts the kernel knows how to walk. */
export type ScanLayout = 'three-level' | 'flexible'

export interface BatteryLoaderConfig {
  /**
   * Plugin id used to namespace the registered op ids when meta.json does
   * not provide an explicit id. For example, scanning a directory called
   * `humanoid-skeleton/` under a plugin with id `wb-3d-lowpoly` yields
   * op id `wb-3d-lowpoly.humanoid-skeleton` unless meta.json overrides.
   */
  pluginId: string

  /**
   * Absolute paths to scan. Plugins typically build these from path slots
   * (kernel.batteries.user, plugin.batteries.builtin, etc.).
   */
  scanDirs: readonly string[]

  /**
   * Layout strategy for the directory tree under each scanDir.
   *   three-level — {bigTag}/{smallTag}/{batteryId}/{meta.json,index.ts}
   *   flexible    — {bigTag}/{batteryDir|smallTag/batteryDir}/{meta.json,index.ts}
   * Mixed layouts (per-directory) are still possible: the loader detects
   * meta.json at every depth.
   */
  layout?: ScanLayout

  /** Hot-reload via chokidar. Default false. */
  watch?: boolean

  /**
   * Allow the plugin to drop or remap ops after the kernel parsed them.
   * Returning null skips the op; returning a different id renames it.
   */
  filter?: (id: string, dir: string) => string | null
}

export interface ScanError {
  dir: string
  reason: string
}

export interface ScanResult {
  /** Newly registered op count. */
  added: number
  /** Already-registered ops whose meta.json changed. */
  updated: number
  /** Previously registered ops whose source directory disappeared. */
  removed: number
  /** Per-directory failures (don't abort the scan; collected for reporting). */
  errors: ScanError[]
}

/** Loader event payload. */
export type LoaderEvent =
  | { kind: 'op-added'; opId: string; sourceDir: string }
  | { kind: 'op-updated'; opId: string; sourceDir: string }
  | { kind: 'op-removed'; opId: string; sourceDir: string }
  | { kind: 'scan-error'; error: ScanError }

/** Subscription handle returned from BatteryLoader.subscribe. */
export type LoaderUnsubscribe = () => void

export interface BatteryLoader {
  /** Initial scan. Walks every scanDir once and registers every op found. */
  scan(): Promise<ScanResult>
  /** Re-scan everything; emits add/update/remove events for the diff. */
  reload(): Promise<ScanResult>
  /**
   * Watch every scanDir via chokidar and emit per-file events as they arrive.
   * Returns an unsubscribe function. No-op if `watch` was false at construction.
   */
  startWatching(): LoaderUnsubscribe
  /**
   * Subscribe to loader events. Plugins use this to mirror the loader's
   * registry diff into their UI metadata store.
   */
  subscribe(handler: (event: LoaderEvent) => void): LoaderUnsubscribe
  /** Returns every op id this loader currently knows about. */
  list(): readonly string[]
}

// ── Battery meta.json shape ───────────────────────────────────────────
//
// The on-disk shape every battery folder must conform to. Fields are loose
// (most are optional with sane defaults); the parser fills the gaps. UI-only
// fields (color, tags, displayGroup, etc.) are still read here but the
// kernel ignores them — plugins consume them via the loader's metaJson
// snapshot, not via OpSpec.

export interface BatteryMetaPort {
  name?: string
  type?: string
  required?: boolean
  default?: unknown
  description?: string
  'description-en'?: string
  label?: string
  options?: string[]
  /** 'item' | 'list' | 'tree' — the dispatcher's per-port mode. */
  access?: 'item' | 'list' | 'tree'
}

export interface BatteryMetaParam {
  name?: string
  type?: string
  default?: unknown
  description?: string
  options?: string[]
  min?: number
  max?: number
  label?: string
}

export interface BatteryMetaDynamicConfig {
  prefix?: string
  labelTemplate?: string
  minCount?: number
  type?: string
  access?: 'item' | 'list' | 'tree'
}

export interface BatteryMeta {
  id?: string
  type?: string
  label?: string
  name?: string
  'name-zh'?: string
  'name-en'?: string
  category?: string
  description?: string
  'description-en'?: string
  version?: string
  author?: string
  inputs?: BatteryMetaPort[]
  outputs?: BatteryMetaPort[]
  params?: BatteryMetaParam[]
  icon?: string
  color?: string
  tags?: string[]
  tag_labels?: string[]
  dynamicInputs?: BatteryMetaDynamicConfig
  dynamicOutputs?: BatteryMetaDynamicConfig
  lacing?: 'longest' | 'shortest' | 'cross' | 'pairwise'
  principal?: string
  engineBehavior?: 'loopUnpack'
  /** Plugin-specific multi-project visibility hint. Kernel passes through. */
  projectTypes?: string[]
  frontend?: {
    nodeType?: string
    displayGroup?: string
    hideOutputs?: boolean
  }
}
