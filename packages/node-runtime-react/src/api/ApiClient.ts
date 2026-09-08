// Browser-safe Layer 2 contract.
//
// Mirrors @forgeax/node-runtime Layer 2 (applyBatch + queries + subscribe)
// without pulling Node-only deps (fs, chokidar, pino). Consumers (e.g.
// scene-generator's frontend) implement this over their transport of
// choice (HTTP, WebSocket, IPC, in-process).
//
// === Contract ===
//
// 1. Lifetime
//    Each ApiClient instance is bound to a single pipeline (pipelineId).
//    Multi-pipeline UIs hold multiple clients. dispose(), if present, is
//    idempotent and tears down the underlying transport (close socket,
//    abort pending requests).
//
// 2. Query semantics
//    - "Not found" returns null (getNode, getPipeline). List-shaped
//      queries return an empty readonly array on no match.
//    - Failures (network error, server reject, malformed response)
//      reject the Promise. Implementations MUST NOT throw
//      synchronously — wrap any sync errors in Promise.reject.
//
// 3. Read-after-write consistency
//    On the same client, the Promise returned by applyBatch is
//    guaranteed to resolve only after the server has committed (or
//    rejected) the batch. Subsequent queries observe the post-batch
//    state.
//
// 4. Subscription ordering
//    - Listeners are invoked synchronously in the order they were
//      registered.
//    - For events caused by an applyBatch on the SAME client, listeners
//      are invoked BEFORE the applyBatch Promise resolves. Do not
//      refetch from inside `await client.applyBatch(...)` — let the
//      listener handle it, otherwise you will double-fetch.
//    - Listeners SHOULD be exception-safe. A throwing listener may
//      break delivery to listeners registered after it on the same
//      channel; this is implementation-dependent.
//
// 5. Optimised reads
//    Prefer getPipeline() over (listNodes + listEdges) when you want a
//    consistent snapshot — it returns both with one round-trip and one
//    hash, eliminating skew.

import type {
  ApplyBatchOptions,
  ApplyBatchResult,
  AssetDeletePolicy,
  ExecutionResult,
  GraphEdge,
  GraphNode,
  HistoryEntryV1,
  HistoryQuery,
  ImportPipelineExecuteOptions,
  ImportPipelineResponse,
  ImportTemplate,
  NodeFilter,
  NodeGroup,
  Op,
  OpSpec,
  PipelineSnapshot,
  ProjectMeta,
  ProjectRecord,
  RuntimeChannel,
  RuntimeEvent,
  WorkspaceState,
} from '@forgeax/node-runtime'

/** Transport-level create-project request (template referenced by server-side path). */
export interface CreateProjectRequest {
  type?: string
  name: string
  description?: string
  /** Server-side template path/id the backend resolves + seeds from. */
  fromTemplate?: string
}

/** Palette entry for a reusable group/template battery discovered by the app. */
export interface GroupTemplateBattery {
  id: string
  name: string
  nameEn?: string
  category: string
  description?: string
  descriptionEn?: string
  version?: string
  iconSvg?: string
  displayGroup?: string
  sourcePath?: string
  tags?: string[]
  tagLabels?: string[]
}

/** Server response of POST /projects/:id/activate. */
export interface ActivateProjectResult {
  project: ProjectRecord
  /** The newly-activated project's graph snapshot (null when empty/unwritten). */
  pipeline: PipelineSnapshot | null
}

export interface ApiClient {
  /** Pipeline id this client is bound to. */
  readonly pipelineId: string

  // Mutations -------------------------------------------------------------
  applyBatch(ops: readonly Op[], opts?: ApplyBatchOptions): Promise<ApplyBatchResult>

  // Execution ------------------------------------------------------------
  /** Run the pipeline (omit nodeId) or a node's upstream closure. Resolves
   *  when the run finishes; live progress arrives on the 'execution' channel. */
  execute(request?: { nodeId?: string }): Promise<ExecutionResult>

  // Queries ---------------------------------------------------------------
  getPipeline(): Promise<PipelineSnapshot | null>
  getNode(nodeId: string): Promise<GraphNode | null>
  listNodes(filter?: NodeFilter): Promise<readonly GraphNode[]>
  listEdges(): Promise<readonly GraphEdge[]>
  getNodeOutput(nodeId: string, portId: string): Promise<unknown>
  getHistory(opts?: HistoryQuery): Promise<readonly HistoryEntryV1[]>
  listOps(): Promise<readonly OpSpec[]>

  // Group queries (Phase G — kernel v0.2.0+). Single-level groups only.
  getGroup(groupId: string): Promise<NodeGroup | null>
  listGroups(): Promise<readonly NodeGroup[]>

  // Subscriptions ---------------------------------------------------------
  /**
   * Register a listener for events on `channel`. Returns an unsubscribe
   * function that is safe to call multiple times. See contract §4 for
   * ordering and exception-safety rules.
   */
  subscribe(channel: RuntimeChannel, listener: (e: RuntimeEvent) => void): () => void

  // Asset path resolution -------------------------------------------------
  // Resolver lives server-side; the browser asks via apiClient.
  // Sync UI bindings (e.g. <img src=...>) should layer a caching hook
  // (see useAssetPath) on top of this Promise-shaped primitive.
  resolveAssetPath(template: string, vars?: Record<string, string>): Promise<string>

  // Graph import / export (optional) -------------------------------------
  // The faithful "load a node-connection graph from a file" feature. These
  // are OPTIONAL and additive: a transport that fronts an app exposing the
  // import routes implements them (see scene-generator's HttpApiClient); the
  // in-memory mock and minimal transports may omit them. The editor's Open /
  // Save toolbar actions degrade gracefully when they are absent.

  /** List graph templates the server discovered under its templates directory. */
  listImportTemplates?(): Promise<readonly ImportTemplate[]>
  /** Import a template FILE the server reads + applies (replace/merge + optional execute). */
  importPipelineFile?(req: {
    path: string
    source?: string
    options?: ImportPipelineExecuteOptions
  }): Promise<ImportPipelineResponse>
  /** Export the current graph to a server-side template file. */
  exportPipelineFile?(req: { name?: string; source?: string }): Promise<{ path: string; name: string }>

  // Group/template batteries (optional) ----------------------------------
  /** List reusable group/template batteries shown by BatteryBar template mode. */
  listGroupTemplates?(): Promise<readonly GroupTemplateBattery[]>
  /** Load a reusable group/template battery by id for canvas instantiation. */
  loadGroupTemplate?(groupId: string): Promise<NodeGroup | null>
  /** Persist a group as a reusable template battery. */
  saveGroupTemplate?(req: {
    group: NodeGroup
    categoryName: string
    batteryName: string
  }): Promise<{ filePath: string; groupId: string; categoryName: string; batteryName: string }>
  /** List template category folders, including empty folders when the app can scan them. */
  listTemplateCategories?(): Promise<readonly string[]>

  // Multi-project management (optional, app-level) -----------------------
  // Faithful port of the legacy project registry. OPTIONAL + additive: a
  // transport fronting an app that exposes the project routes implements them
  // (see scene-generator's HttpApiClient); minimal transports omit them and the
  // projectStore degrades to a single implicit pipeline. `activateProject` is
  // the open cascade's server step — it swaps the active runtime so subsequent
  // getPipeline()/applyBatch() observe the activated project's isolated graph.

  /** List all projects in the workspace. */
  listProjects?(): Promise<readonly ProjectMeta[]>
  /** Fetch one project's manifest. Null when not found. */
  getProject?(id: string): Promise<ProjectRecord | null>
  /** Create a project (optionally seeded from a server-side template). */
  createProject?(req: CreateProjectRequest): Promise<ProjectMeta>
  /** Patch a project's metadata (name / description / thumbnail / type). */
  updateProject?(id: string, patch: { name?: string; description?: string; thumbnail?: string; type?: string }): Promise<ProjectMeta>
  /** Delete a project; the server enforces "never empty" and returns the new workspace. */
  deleteProject?(id: string, opts?: { assetPolicy?: AssetDeletePolicy }): Promise<{ ok: true; workspace: WorkspaceState }>
  /** Open / activate a project (the server step of the open cascade). */
  activateProject?(id: string): Promise<ActivateProjectResult>
  /** Read the workspace doc (activeProjectId / recentProjectIds). */
  getWorkspace?(): Promise<WorkspaceState>
  /** Patch the workspace doc. */
  setWorkspace?(patch: Partial<WorkspaceState>): Promise<WorkspaceState>

  // Lifecycle -------------------------------------------------------------
  /**
   * Tear down the underlying transport. Optional — implementations that
   * have nothing to release (e.g. in-process / mock) may omit this. Must
   * be idempotent: multiple calls are no-ops after the first.
   */
  dispose?(): void
}
