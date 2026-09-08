// Runtime aggregator — wires the Layer 1 pieces into a single handle.
//
// Plugins create one Runtime per pipeline they manage. The Runtime owns
// the OpRegistry, GraphStore, HistoryLog, OutputCache, PathResolver,
// and AssetResolver, and exposes them as both raw fields (for
// kernel-internal use) and a Layer 2 API (applyBatch + queries) for
// editing UIs / AI tools / CLI.

import { join } from 'node:path'

import { OpRegistry } from '../layer1/op-registry.js'
import type { ExecutionContext } from '../layer1/index.js'
import { PathResolver } from '../layer1/path-resolver.js'
import { GraphStore } from '../layer1/storage/graph-store.js'
import { HistoryLog } from '../layer1/storage/history-log.js'
import { OutputCache } from '../layer1/storage/output-cache.js'
import { createAssetResolver } from '../layer1/asset-resolver/asset-resolver.js'
import type { AssetResolver } from '../layer1/asset-resolver/types.js'
import { attachBus, createEventBus } from './event-bus.js'
import type { SubscriptionAPI } from './subscriptions.js'

export interface RuntimeConfig {
  /** Absolute path to the project root (the directory that owns the kernel artefacts). */
  projectRoot: string
  /** Stable pipeline identifier; used for history.actor and persistence layout. */
  pipelineId: string
  /** Plugin id — passed through to PathResolver for ${pluginId} interpolation. */
  pluginId: string
  /** Game working directory. Default: same as projectRoot. */
  gameRoot?: string
  /**
   * Optional shared OpRegistry. When provided it is reused instead of
   * constructing a fresh (empty) one. This lets a multi-pipeline pool (e.g.
   * the ProjectRegistry) scan batteries ONCE and share the op catalog across
   * every per-project Runtime, instead of re-scanning on each project switch.
   */
  registry?: OpRegistry
  /**
   * Optional hook to enrich the per-execution {@link ExecutionContext}. The
   * executor builds a base context (`{ pipelineId, log, signal }`) per run; when
   * this hook is provided, the base is passed through it and the returned
   * context is used for op execution. This is the generic seam by which a host
   * plugin injects `services` (e.g. a baker/library bag) into ops WITHOUT the
   * kernel knowing about any specific service. When omitted (the default) the
   * executor uses the base context unchanged, preserving the empty-services
   * behavior every existing consumer relies on. Implementations SHOULD return a
   * context that preserves the base's `pipelineId`, `log`, and `signal`.
   */
  createExecutionContext?: (base: ExecutionContext) => ExecutionContext
  /**
   * Kernel layout under projectRoot. Override for embedding scenarios where
   * the kernel artefacts live outside the project tree.
   */
  layout?: {
    /** graph.json path. Default: <projectRoot>/state/graph.json */
    graphFile?: string
    /** history.jsonl path. Default: <projectRoot>/state/history.jsonl */
    historyFile?: string
    /** outputs/ root. Default: <projectRoot>/state/outputs */
    outputsDir?: string
    /** Asset root. Default: <projectRoot>/assets */
    assetsDir?: string
    /** Asset type prefixes to enumerate. Default: every immediate subdir of assetsDir. */
    assetTypes?: readonly string[]
  }
}

export interface Runtime {
  readonly config: Readonly<RuntimeConfig>
  readonly registry: OpRegistry
  readonly paths: PathResolver
  readonly graph: GraphStore
  readonly history: HistoryLog
  readonly outputs: OutputCache
  readonly assets: AssetResolver
  /** Subscribe-only event stream (graph / execution / asset channels). */
  readonly subscriptions: SubscriptionAPI
  /** Convenience disposer — closes any active watchers. */
  dispose(): void
}

export function createRuntime(config: RuntimeConfig): Runtime {
  const layout = config.layout ?? {}
  const graphFile = layout.graphFile ?? join(config.projectRoot, 'state', 'graph.json')
  const historyFile = layout.historyFile ?? join(config.projectRoot, 'state', 'history.jsonl')
  const outputsDir = layout.outputsDir ?? join(config.projectRoot, 'state', 'outputs')
  const assetsDir = layout.assetsDir ?? join(config.projectRoot, 'assets')

  const registry = config.registry ?? new OpRegistry()
  const paths = new PathResolver({
    projectRoot: config.projectRoot,
    pluginId: config.pluginId,
    gameRoot: config.gameRoot ?? config.projectRoot,
  })
  const graph = new GraphStore(graphFile)
  const history = new HistoryLog(historyFile)
  const outputs = new OutputCache(outputsDir)
  const assets = createAssetResolver({ root: assetsDir, types: layout.assetTypes })

  // Disposer collects unsubscribers from any subsystem that started watchers.
  let disposed = false
  function dispose(): void {
    if (disposed) return
    disposed = true
    // The asset watcher is the only subsystem with running handles after init;
    // battery-loader and others register their own dispose paths through subscribe().
    // We do not call assets.watch() here, so unless the consumer started one, dispose is a no-op.
  }

  const bus = createEventBus()

  const runtime: Runtime = {
    config: Object.freeze({ ...config }),
    registry,
    paths,
    graph,
    history,
    outputs,
    assets,
    subscriptions: bus,
    dispose,
  }

  attachBus(runtime, bus)
  return runtime
}
