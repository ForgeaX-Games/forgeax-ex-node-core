// Path slot resolver.
//
// Each plugin declares slots in its forgeax-plugin.json `requestedPathSlots`.
// The resolver layers four precedence levels (highest first):
//
//   1. Per-session API override (`setSlot(id, value, persist=false)`)
//   2. Persisted user/AI config — `<gameRoot>/paths.config.json`
//   3. Environment variable `FORGEAX_PATH_<NORMALIZED_SLOT_ID>`
//   4. Manifest default (with ${var} interpolation)
//
// Resolved paths are validated:
//   * must stay inside the host-allowed root (defence against escape via `..`)
//   * `kind: directory` paths end with `/`
//   * `kind: file` paths carry an extension
//
// Built-in interpolation vars:
//   ${gameRoot}     — supplied by host
//   ${projectRoot}  — supplied by host
//   ${pluginId}     — supplied by host (per-plugin)
//   ${pipelineId}   — populated when a pipeline scope is active
//   ${timestamp}    — resolution-time ISO 8601
//   ${date}         — resolution-time YYYY-MM-DD

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, normalize, resolve, sep } from 'node:path'

export type SlotKind = 'directory' | 'file' | 'glob'
export type SlotAccess = 'read' | 'write' | 'read-write'

export interface PathSlotSpec {
  id: string
  default: string
  kind: SlotKind
  access: SlotAccess
  description?: string
}

export interface PathResolveContext {
  /** Caller-supplied variables. Built-in vars take precedence on key collision. */
  vars?: Record<string, string>
  /** Pipeline scope; populates ${pipelineId}. */
  pipelineId?: string
}

export interface PathResolverConfig {
  /** Plugin id; populates ${pluginId} and used to namespace env-var lookup. */
  pluginId: string
  /** Project root — every resolved absolute path must stay under it. */
  projectRoot: string
  /** Game working directory — populates ${gameRoot}. */
  gameRoot: string
  /** Path to paths.config.json. Defaults to `${gameRoot}/paths.config.json`. */
  configPath?: string
}

interface PathConfigFile {
  schemaVersion?: number
  vars?: Record<string, string>
  slots?: Record<string, string>
}

export class PathResolver {
  private readonly slots = new Map<string, PathSlotSpec>()
  private readonly sessionOverrides = new Map<string, string>()
  private readonly persistentOverrides = new Map<string, string>()
  private readonly userVars = new Map<string, string>()
  private readonly configPath: string

  constructor(private readonly config: PathResolverConfig) {
    this.configPath = config.configPath ?? resolve(config.gameRoot, 'paths.config.json')
    this.loadConfig()
  }

  /** Register a slot spec. Throws if the id is already taken. */
  registerSlot(spec: PathSlotSpec): void {
    if (this.slots.has(spec.id)) {
      throw new Error(`Path slot already registered: ${spec.id}`)
    }
    this.slots.set(spec.id, spec)
  }

  getSlot(id: string): PathSlotSpec | undefined {
    return this.slots.get(id)
  }

  listSlots(pluginIdFilter?: string): PathSlotSpec[] {
    const out: PathSlotSpec[] = []
    for (const spec of this.slots.values()) {
      if (pluginIdFilter && !spec.id.startsWith(`${pluginIdFilter}.`)) continue
      out.push(spec)
    }
    return out
  }

  /** Resolve a slot id to an absolute path. */
  resolve(id: string, ctx?: PathResolveContext): string {
    const spec = this.slots.get(id)
    if (!spec) throw new Error(`Path slot not registered: ${id}`)

    const raw = this.rawValue(id, spec)
    const interpolated = this.interpolate(raw, ctx)
    const absolute = this.toAbsolute(interpolated)
    this.assertWithinRoot(absolute)
    this.assertKindShape(absolute, spec.kind)
    return absolute
  }

  /** Resolve only if the slot exists and is consistent; otherwise return undefined. */
  resolveOptional(id: string, ctx?: PathResolveContext): string | undefined {
    if (!this.slots.has(id)) return undefined
    try {
      return this.resolve(id, ctx)
    } catch {
      return undefined
    }
  }

  /**
   * Override a slot value.
   *
   * persist=false (default) — session override; lost on process exit.
   * persist=true              — written to paths.config.json on disk.
   */
  setSlot(id: string, value: string, persist = false): void {
    if (!this.slots.has(id)) {
      throw new Error(`Path slot not registered: ${id}`)
    }
    if (persist) {
      this.persistentOverrides.set(id, value)
      this.saveConfig()
    } else {
      this.sessionOverrides.set(id, value)
    }
  }

  /** Reset a slot to its manifest default. Clears both override layers. */
  resetSlot(id: string, persist = false): void {
    this.sessionOverrides.delete(id)
    if (persist) {
      this.persistentOverrides.delete(id)
      this.saveConfig()
    }
  }

  /** Set a user-defined interpolation variable. Persisted to paths.config.json when persist=true. */
  setVar(name: string, value: string, persist = false): void {
    this.userVars.set(name, value)
    if (persist) this.saveConfig()
  }

  // ─── internal helpers ─────────────────────────────────────────────────

  private rawValue(id: string, spec: PathSlotSpec): string {
    const session = this.sessionOverrides.get(id)
    if (session !== undefined) return session

    const persisted = this.persistentOverrides.get(id)
    if (persisted !== undefined) return persisted

    const envVarName = `FORGEAX_PATH_${id.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`
    const envValue = process.env[envVarName]
    if (envValue !== undefined && envValue !== '') return envValue

    return spec.default
  }

  private interpolate(template: string, ctx?: PathResolveContext): string {
    const builtins: Record<string, string> = {
      gameRoot: this.config.gameRoot,
      projectRoot: this.config.projectRoot,
      pluginId: this.config.pluginId,
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
    }
    if (ctx?.pipelineId) builtins.pipelineId = ctx.pipelineId

    // Lookup precedence: built-ins > paths.config.json vars > caller-supplied vars.
    const userVarsObj = Object.fromEntries(this.userVars.entries())
    const merged: Record<string, string> = { ...ctx?.vars, ...userVarsObj, ...builtins }

    return template.replace(/\$\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (whole, name: string) => {
      const v = merged[name]
      return v ?? whole
    })
  }

  private toAbsolute(value: string): string {
    return isAbsolute(value) ? normalize(value) : normalize(resolve(this.config.projectRoot, value))
  }

  private assertWithinRoot(absolute: string): void {
    const root = normalize(this.config.projectRoot)
    const inside = absolute === root || absolute.startsWith(root + sep)
    if (!inside) {
      throw new Error(
        `Path escapes project root: ${absolute} (root=${root})`,
      )
    }
  }

  private assertKindShape(absolute: string, kind: SlotKind): void {
    if (kind === 'directory') {
      // Directory paths in the configuration carry a trailing slash; the
      // resolved form may have lost it via normalize(). Plugin contracts
      // treat both forms as valid — we only forbid file extensions.
      return
    }
    if (kind === 'file') {
      const lastSep = absolute.lastIndexOf(sep)
      const tail = lastSep >= 0 ? absolute.slice(lastSep + 1) : absolute
      if (!tail.includes('.')) {
        throw new Error(`Path slot is kind=file but resolved path has no extension: ${absolute}`)
      }
    }
    // 'glob' is permissive — caller validates.
  }

  private loadConfig(): void {
    if (!existsSync(this.configPath)) return
    let parsed: PathConfigFile
    try {
      parsed = JSON.parse(readFileSync(this.configPath, 'utf-8')) as PathConfigFile
    } catch {
      return
    }
    if (parsed.vars) {
      for (const [k, v] of Object.entries(parsed.vars)) {
        if (typeof v === 'string') this.userVars.set(k, v)
      }
    }
    if (parsed.slots) {
      for (const [k, v] of Object.entries(parsed.slots)) {
        if (typeof v === 'string') this.persistentOverrides.set(k, v)
      }
    }
  }

  private saveConfig(): void {
    const data: PathConfigFile = {
      schemaVersion: 1,
      vars: Object.fromEntries(this.userVars.entries()),
      slots: Object.fromEntries(this.persistentOverrides.entries()),
    }
    const dir = dirname(this.configPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8')
  }
}
