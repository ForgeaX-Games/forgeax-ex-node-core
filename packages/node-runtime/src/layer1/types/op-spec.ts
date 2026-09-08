// Op specification — the kernel API for an op (the kernel concept that the
// UI labels "battery"). Domain plugins call registerOp() with an OpSpec at
// boot; the executor and dispatcher consume these specs at runtime.
//
// The plugin manifest's UI-facing fields (icon, colour, tags, displayGroup,
// nodeType, projectTypes, sourcePath, createdAt, etc.) are NOT part of OpSpec.
// They live in the plugin's own metadata model and stay out of the kernel.

/** A scalar argument value carried inside an op's params or DSL nodes. */
export type Arg = string | number | boolean | null | Arg[] | { [k: string]: Arg }

/**
 * Free-form port type identifier. Core common types are 'number' / 'string' /
 * 'bool' / 'any' etc.; domain plugins use their own strings (the kernel treats
 * the value opaquely — type/colour/compat live in the editor's port-type registry).
 */
export type PortType = string

/**
 * Per-port DataTree access mode. Drives the dispatcher's fanout / regroup
 * behaviour at the function boundary.
 *   - 'item' — fanout axis: each branch × item invokes the op once
 *   - 'list' — pass the full readonly T[] of the current branch
 *   - 'tree' — pass the entire DataTree<T>
 *   - undefined → defaults to 'item' for typed ports, 'tree' for control inputs
 */
export type OpAccess = 'item' | 'list' | 'tree'

/** Multi-input lacing strategy, applied when ≥2 'item' / 'list' inputs are present. */
export type OpLacingMode = 'longest' | 'shortest' | 'cross' | 'pairwise'

/**
 * Engine behaviour declaration. Replaces the legacy "scan _-prefixed keys"
 * implicit ABI. Ops that need executor-driven side effects must declare which
 * behaviour they participate in.
 */
export type OpEngineBehavior = 'loopUnpack'

/** Input port spec. */
export interface OpInput {
  name: string
  type: PortType
  required?: boolean
  default?: Arg
  description?: string
  /** Optional English description; the i18n layer picks it up. */
  descriptionEn?: string
  /** UI-facing label. */
  label?: string
  /** Enum choices for an inline UI dropdown. */
  options?: string[]
  access?: OpAccess
}

/** Output port spec. */
export interface OpOutput {
  name: string
  type: PortType
  description?: string
  descriptionEn?: string
  label?: string
  access?: OpAccess
}

/** Param slot spec (panel-bound, not wire-bound). */
export interface OpParam {
  name: string
  type: PortType
  default?: Arg
  description?: string
  /** Enum choices. */
  options?: string[]
  min?: number
  max?: number
  label?: string
}

/**
 * Dynamic input/output config — the op declares a port-prefix template that
 * the runtime expands as the user adds connections / the op returns more
 * outputs.
 */
export interface DynamicPortsConfig {
  /** Port name prefix, e.g. 'item_'. */
  prefix: string
  /** Label template; '$i' is replaced with the index. */
  labelTemplate: string
  /** Initial / placeholder port count rendered before the op runs. */
  minCount: number
  /** Port type for every generated slot. */
  type: PortType
  /** DataTree access for every generated slot (default 'item'). */
  access?: OpAccess
}

/** Runtime-supplied execution context. */
export interface ExecutionContext {
  pipelineId: string
  /** Logger handle. */
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
  /** Cancellation signal — true once the executor aborts. */
  signal: AbortSignal
  /**
   * Plugin-supplied service bag. The kernel does not constrain its shape;
   * each plugin declares its own services interface and supplies the bag
   * at runtime.
   */
  services?: Record<string, unknown>
  /**
   * Engine-derived connection inference for the CURRENT node: the access/type
   * of the first dynamic input's upstream source port. Adaptive ops (e.g.
   * tree_merge) consume `inferredAccess` / `inferredType` from their args bag;
   * the engine injects these at execution time from this field when the node's
   * persisted params do not already lock them. Carried on the execution context
   * — never written into node.params — so it cannot collide with user params.
   */
  connectionInference?: { access?: OpAccess; type?: string }
}

/** Argument bag passed to op.execute — keys match input port + param names. */
export type ExecutionArgs = Record<string, unknown>

/** Op execution function signature. */
export type OpExecuteFn = (
  ctx: ExecutionContext,
  args: ExecutionArgs,
) => unknown | Promise<unknown>

/**
 * Full op specification. Plugins build one of these for each op they expose
 * and call registerOp(spec) at boot.
 *
 * The id is plugin-namespaced (e.g. 'wb-scene.csg.union'). Once published it
 * is permanent; renaming breaks every saved graph that references it.
 */
export interface OpSpec {
  /** Globally unique op id, plugin-namespaced. */
  id: string
  /** UI-facing name. */
  name?: string
  /** UI-facing English name (used by the i18n layer when locale === 'en'). */
  nameEn?: string
  description?: string
  descriptionEn?: string
  inputs: OpInput[]
  outputs: OpOutput[]
  params: OpParam[]
  dynamicInputs?: DynamicPortsConfig
  dynamicOutputs?: DynamicPortsConfig
  /** Multi-input alignment; only meaningful with ≥2 'item' / 'list' inputs. */
  lacing?: OpLacingMode
  /**
   * Path-authoritative input port. The output DataTree's path follows this
   * input's branch path. If absent, the dispatcher falls back to the first
   * 'item' / 'list' input.
   */
  principal?: string
  engineBehavior?: OpEngineBehavior
  /** Implementation function. */
  execute: OpExecuteFn
}

// ── Backwards-compatibility aliases ─────────────────────────────────────
//
// Plugin code that the kernel was extracted from used `Battery*` names.
// We keep type aliases so existing imports continue to compile until the
// consuming plugin updates its imports to the kernel `Op*` names.

/** @deprecated Use OpSpec. */
export type Battery = OpSpec
/** @deprecated Use OpInput. */
export type BatteryInput = OpInput
/** @deprecated Use OpOutput. */
export type BatteryOutput = OpOutput
/** @deprecated Use OpParam. */
export type BatteryParam = OpParam
/** @deprecated Use OpAccess. */
export type BatteryAccess = OpAccess
/** @deprecated Use OpLacingMode. */
export type ShapeLacingMode = OpLacingMode
/** @deprecated Use OpEngineBehavior. */
export type EngineBehavior = OpEngineBehavior
/** @deprecated Use DynamicPortsConfig. */
export type DynamicInputsConfig = DynamicPortsConfig
/** @deprecated Use DynamicPortsConfig. */
export type DynamicOutputsConfig = DynamicPortsConfig
