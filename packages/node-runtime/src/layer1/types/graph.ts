// Kernel-side graph types.
//
// The pipeline / node / edge data the executor reads. UI-only fields
// (annotations, canvas frames, viewport, REST DTOs) live in the plugin's
// own types — the kernel does not see them.

/** A 2D position used for visual layout. The kernel preserves it but never reads it. */
export interface Position {
  x: number
  y: number
}

/** One side of an edge: a (node, port) pair. */
export interface EdgeEndpoint {
  nodeId: string
  port: string
}

/** A graph edge connecting an output port to an input port. */
export interface GraphEdge {
  id: string
  source: EdgeEndpoint
  target: EdgeEndpoint
}

export type NodeStatus = 'idle' | 'pending' | 'running' | 'completed' | 'error' | 'skipped'
export type PipelineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'stopped'

/**
 * A graph node — an op instance with its own params and runtime state.
 *
 * `opId` is the kernel-facing name for what the UI calls `batteryId`; both
 * fields refer to the same OpSpec.id. Plugins migrating from the legacy
 * upstream model can keep emitting `batteryId` and the kernel will normalise.
 */
export interface GraphNode {
  id: string
  /** OpSpec id this node references. */
  opId: string
  /** UI-facing display name. */
  name?: string
  /** Visual layout. */
  position: Position
  /** Param panel values. */
  params: Record<string, unknown>
  /** Last-execution status. */
  status?: NodeStatus
}

/**
 * Group node — a packed sub-graph with explicit external ports.
 *
 * Kernel-side: the executor recurses into the sub-graph during execution.
 * Plugin-side: the UI renders it as a single composite node.
 */
export interface NodeGroup {
  id: string
  name: string
  /** Optional English name for the i18n layer. */
  nameEn?: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  position: Position
  exposedInputs: ExposedPort[]
  exposedOutputs: ExposedPort[]
  /** Visual layout overrides for inner nodes (display-only). */
  innerLayout?: Record<string, Position>
  /**
   * Persisted snapshot of nested groups (self-contained storage form).
   * The executor walks this to resolve nested __group__ inner nodes.
   */
  _nestedGroups?: NodeGroup[]
}

/** A group's external port definition mapping to an inner node port. */
export interface ExposedPort {
  /** External port name (visible to neighbours of the group node). */
  portName: string
  /** External port type. */
  portType: string
  /**
   * DataTree access mode of the inner source port, mirrored onto the
   * boundary so outer connections infer the same item/list/tree tier the
   * member port would. Optional for back-compat with graphs persisted before
   * boundary access was resolved.
   */
  access?: 'item' | 'list' | 'tree'
  /** Optional UI label. */
  portLabel?: string
  /** Inner node id whose port we're exposing. */
  sourceNodeId: string
  /** Inner port name. */
  sourcePortName: string
}

/** Top-level pipeline payload (the kernel slice — no UI-only fields). */
export interface Pipeline {
  id: string
  name: string
  description: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  status: PipelineStatus
  createdAt: string
  updatedAt: string
  /** Composite-node sub-graphs (back-compat, optional). */
  groups?: NodeGroup[]
}

/**
 * A single node's execution output cache. The wire payload is always
 * DataTreeEntry<unknown>[] (the toJSON form of DataTree<T>) so consumers
 * can serialise / replay / rebroadcast without re-handling DataTree
 * instance identity.
 *
 * `sidecar` is a plugin-extension slot for output metadata that does not
 * fit the wire payload (e.g. asset-binding hints). The kernel passes it
 * through unchanged.
 */
export interface NodeOutputRecord {
  pipelineId: string
  nodeId: string
  port: string
  outputType: string
  data: ReadonlyArray<{ path: readonly number[]; items: ReadonlyArray<unknown> }>
  /** UI-facing op name, for layer-panel display. */
  opName?: string
  /** Plugin extension slot — opaque to the kernel. */
  sidecar?: Record<string, unknown>
}

export type ExecuteMode = 'full' | 'partial'

export interface ExecuteRequest {
  mode?: ExecuteMode
  startNodeId?: string
  /** Per-execution overrides (typically merged into node.params at run time). */
  params?: Record<string, unknown>
}

export interface ExecutionResponse {
  executionId: string
  pipelineId: string
  status: string
  startedAt: string
}

export interface StopRequest {
  force?: boolean
}

export interface StopResponse {
  pipelineId: string
  status: string
  stoppedAt: string
  completedNodes: number
  totalNodes: number
}
