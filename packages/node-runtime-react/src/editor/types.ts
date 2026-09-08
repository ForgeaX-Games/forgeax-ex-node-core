// Editor data model — the generic graph types the faithful editor stores and
// components operate on. These mirror the legacy editor's UI-facing shapes so
// that ported components look and behave identically, while the transport
// layer (src/editor/transport) bridges them onto the kernel ApiClient.
//
// App-level concerns from the legacy model (projects / workspace / session
// files / config / multi-iframe) are intentionally omitted — only the generic
// editor data lives here.
//
// Naming note: the kernel calls an op an "op" (OpSpec.id, GraphNode.opId). The
// editor UI historically calls the same concept a "battery" and a node's op
// reference `batteryId`. We keep the UI naming here for component fidelity; the
// transport mappers translate to/from the kernel names.

export type ShapeLacingMode = 'longest' | 'shortest' | 'cross' | 'pairwise'

/** Per-port DataTree access mode: 'item' (fanout), 'list' (whole branch), 'tree' (whole tree). */
export type BatteryAccess = 'item' | 'list' | 'tree'

/** Dynamic input/output port config — a port-prefix template the runtime expands. */
export interface DynamicPortsConfig {
  /** Port name prefix, e.g. 'item_'. */
  prefix: string
  /** Label template; '$i' is replaced with the index. */
  labelTemplate: string
  /** Initial / placeholder port count. */
  minCount: number
  /** Port type for every generated slot. */
  type: string
  /** DataTree access for every generated slot (default 'item'). */
  access?: BatteryAccess
}

/** A node's input/output port descriptor. */
export interface BatteryPort {
  name: string
  type: string
  required?: boolean
  default?: unknown
  description?: string
  descriptionEn?: string
  label?: string
  /** Enum choices; when present the port row renders an inline picker. */
  options?: string[]
  /** Internal / renderer-only port — not drawn on the node UI. */
  hidden?: boolean
  access?: BatteryAccess
}

/** A panel-bound parameter (not wire-bound). */
export interface BatteryParam {
  name: string
  type: 'string' | 'number' | 'boolean' | 'select'
  default?: unknown
  description?: string
  options?: string[]
  min?: number
  max?: number
  label?: string
}

/**
 * A "battery" — the UI-facing catalog entry for an op the user can drop on the
 * canvas. Derived from a kernel OpSpec by the transport layer.
 */
export interface Battery {
  id: string
  name: string
  nameEn?: string
  /** group = composite battery; the others map to plain kernel ops. */
  type: 'ts' | 'json' | 'special' | 'ai' | 'group'
  category: string
  description: string
  descriptionEn?: string
  version: string
  inputs: BatteryPort[]
  outputs: BatteryPort[]
  params: BatteryParam[]
  iconSvg?: string
  color?: string
  tags?: string[]
  tagLabels?: string[]
  dynamicInputs?: DynamicPortsConfig
  dynamicOutputs?: DynamicPortsConfig
  lacing?: ShapeLacingMode
  principal?: string
  /** UI grouping hint (decoupled from type / file location). */
  displayGroup?: string
  /** React node-component name; defaults are derived from `type`. */
  nodeType?: string
  /** Hide the right-hand output handle (sink-shaped batteries). */
  hideOutputs?: boolean
  /** Physical/template source path hint used by template-mode grouping. */
  sourcePath?: string
  /** Optional app project-type filter hint. */
  projectTypes?: string[]
}

/** 2D layout position. */
export interface Position {
  x: number
  y: number
}

/** Canvas viewport (pan + zoom). */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** One side of an edge: a (node, port) pair. */
export interface EdgeEndpoint {
  nodeId: string
  port: string
}

export type NodeStatus = 'idle' | 'pending' | 'running' | 'completed' | 'error' | 'skipped'
export type PipelineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'stopped'

/** A node on the canvas — an instance of a Battery with its own params/layout. */
export interface PipelineNode {
  id: string
  /** Battery (op) id this node references. */
  batteryId: string
  name: string
  position: Position
  params: Record<string, unknown>
  status?: NodeStatus
  /** Whether the renderer pushes preview events for this node (default true). */
  previewEnabled?: boolean
}

/** A graph edge connecting an output port to an input port. */
export interface PipelineEdge {
  id: string
  source: EdgeEndpoint
  target: EdgeEndpoint
}

/** A group's external port mapping to an inner node port. */
export interface ExposedPort {
  portName: string
  portType: string
  /** DataTree access tier of the inner source port, mirrored onto the boundary. */
  access?: BatteryAccess
  portLabel?: string
  portLabelEn?: string
  sourceNodeId: string
  sourcePortName: string
  options?: string[]
  hidden?: boolean
  customLabel?: string
  customLabelEn?: string
  order?: number
}

/** A composite node: a packed sub-graph with explicit external ports. */
export interface NodeGroup {
  id: string
  name: string
  nameEn?: string
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  position: Position
  exposedInputs: ExposedPort[]
  exposedOutputs: ExposedPort[]
  /** Inner-view layout snapshot, key = inner node id. */
  innerLayout?: Record<string, Position>
  /** Self-contained snapshot of nested groups (persistence form). */
  _nestedGroups?: NodeGroup[]
}

/** A free-floating text annotation on the canvas. */
export interface CanvasAnnotation {
  id: string
  text: string
  position: Position
  width?: number
  height?: number
}

/** A visual bounding frame around a set of nodes (not executed). */
export interface CanvasFrame {
  id: string
  name: string
  position: Position
  width: number
  height: number
  nodeIds: string[]
  filePath?: string
  createdAt: string
  updatedAt: string
}

/** The editor's working pipeline (UI superset of the kernel Pipeline). */
export interface Pipeline {
  id: string
  name: string
  description: string
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  viewport: Viewport
  status: PipelineStatus
  createdAt: string
  updatedAt: string
  groups?: NodeGroup[]
  annotations?: CanvasAnnotation[]
  frames?: CanvasFrame[]
}

/**
 * Battery palette ordering config. Persisted by the legacy backend; on the
 * kernel backend there is no order store, so the transport derives a default
 * order from listOps() and saving is a no-op (see transport/apiAdapter).
 */
export interface BatteryOrder {
  bigLabels: string[]
  smallLabels: Record<string, string[]>
  smallLabelColors?: Record<string, string>
}

/** Battery palette category (big tag + its small tags). */
export interface BatteryCategory {
  type: string
  bigTag: string
  smallTags: string[]
}

/** Special battery id used by group shadow nodes, mirroring the kernel sentinel. */
export const GROUP_BATTERY_ID = '__group__'
