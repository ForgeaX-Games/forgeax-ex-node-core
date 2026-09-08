// Port data-type utilities: core type set, alias normalisation, colour mapping
// and connection-compatibility checks. Domain plugins may register their own
// types (for example scene or lowpoly geometry) without teaching the core about
// those runtime values.

/**
 * Built-in common data types. `list` / `array` are demoted to legacy spellings
 * and map to `any`; DataTree container semantics are expressed by port access.
 *
 * Note on `grid` / `point3d`: these read as domain-flavoured but are retained in
 * the core set for now. `grid` is produced/consumed by common batteries (e.g.
 * datatree grid panels), so it is genuinely common; `point3d` is a downsink
 * candidate to `domainPortTypes` once every plugin that emits it registers it via
 * the domain prop.
 */
export type CorePortType =
  | 'number'
  | 'string'
  | 'bool'
  | 'grid'
  | 'dict'
  | 'image'
  | 'point3d'
  | 'object'
  | 'any'

export type CanonicalType = CorePortType | string

export interface PortTypeRegistration {
  type: string
  desc: string
  descEn: string
  aliases?: string[]
  color: string
  compatibleWith?: string[]
}

export type DomainPortTypes = readonly PortTypeRegistration[]

/**
 * Alias -> canonical type map. Keeps old batteries using int / float / str /
 * boolean / list working; list/array have no dedicated canonical type and are
 * treated as `any`.
 */
const TYPE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  int: 'number',
  float: 'number',
  str: 'string',
  boolean: 'bool',
  list: 'any',
  array: 'any',
})

/** Normalise an arbitrary type string to a canonical type. */
export function normalizeType(type: string): string {
  const lower = type.toLowerCase().trim()
  return TYPE_ALIASES[lower] ?? lower
}

/**
 * Highlight colour per canonical type, for handle dots and port badges.
 * Frozen single source of truth — no mutable copy layer (the former
 * `registerPortTypes` write path was removed; domains supply colours via the
 * `domainPortTypes` prop instead of mutating this map).
 */
export const PORT_TYPE_COLORS: Record<string, string> = Object.freeze({
  number: '#5b9cf6',
  string: '#4ade80',
  bool: '#fbbf24',
  grid: '#c084fc',
  dict: '#f472b6',
  image: '#2dd4bf',
  point3d: '#a78bfa',
  object: '#94a3b8',
  any: '#e2e8f0',
})

/** Fallback colour for unknown types (visual degradation only). */
const DEFAULT_PORT_COLOR = '#6b7280'

function findDomainPortType(type: string, domainPortTypes?: DomainPortTypes): PortTypeRegistration | undefined {
  if (!domainPortTypes) return undefined
  const canonical = normalizeType(type)
  return domainPortTypes.find((entry) => {
    if (normalizeType(entry.type) === canonical) return true
    return entry.aliases?.some((alias) => normalizeType(alias) === canonical) ?? false
  })
}

/** Colour for a port type. Normalises aliases; unknown -> grey. */
export function getPortTypeColor(type: string, domainPortTypes?: DomainPortTypes): string {
  const canonical = normalizeType(type) as CanonicalType
  const domainType = findDomainPortType(canonical, domainPortTypes)
  if (domainType) return domainType.color
  return PORT_TYPE_COLORS[canonical] ?? DEFAULT_PORT_COLOR
}

/**
 * Type-compatibility matrix (canonical type -> connectable canonical types).
 * Inputs are normalised first, so the matrix only covers canonical types.
 */
const DEFAULT_COMPAT_ENTRIES: Array<[string, string[]]> = [
  ['number', ['number', 'string']],
  ['string', ['string', 'grid']],
  ['bool', ['bool', 'string']],
  ['grid', ['grid']],
  ['dict', ['dict', 'object']],
  ['object', ['object', 'dict']],
  ['image', ['image']],
  ['point3d', ['point3d']],
]

// Single source of truth: the compat lookup is derived from DEFAULT_COMPAT_ENTRIES
// rather than duplicating the same matrix as a second literal.
const COMPAT_MAP: Record<string, Set<string>> = Object.fromEntries(
  DEFAULT_COMPAT_ENTRIES.map(([type, compatible]) => [type, new Set(compatible)]),
)

/** Whether sourceType -> targetType may be connected. `any` is bidirectional. */
export function isTypeCompatible(sourceType: string, targetType: string, domainPortTypes?: DomainPortTypes): boolean {
  const src = normalizeType(sourceType)
  const tgt = normalizeType(targetType)

  if (src === 'any' || tgt === 'any') return true
  if (src === tgt) return true

  const domainType = findDomainPortType(src, domainPortTypes)
  if (domainType?.compatibleWith?.map(normalizeType).includes(tgt)) return true

  return COMPAT_MAP[src]?.has(tgt) ?? false
}

/** Per-type UI metadata (data-type panels etc). */
export interface CanonicalTypeMeta {
  type: string
  desc: string
  descEn: string
  aliases: string[]
}

/**
 * Frozen core type legend — single source of truth, no mutable copy layer.
 * Consumers that need a mutable working copy clone it (e.g. `[...CANONICAL_TYPE_META]`
 * or via `resolveCanonicalTypeMeta`, which also folds in domain types).
 */
export const CANONICAL_TYPE_META: readonly CanonicalTypeMeta[] = Object.freeze([
  { type: 'number', desc: '数值', descEn: 'Number', aliases: ['int', 'float'] },
  { type: 'string', desc: '字符串', descEn: 'String', aliases: ['str'] },
  { type: 'bool', desc: '布尔', descEn: 'Boolean', aliases: ['boolean'] },
  { type: 'grid', desc: '二维网格', descEn: '2D Grid', aliases: [] },
  { type: 'dict', desc: '字典', descEn: 'Dict', aliases: [] },
  { type: 'image', desc: '图像', descEn: 'Image', aliases: [] },
  { type: 'point3d', desc: '三维点', descEn: 'Point3D', aliases: [] },
  { type: 'object', desc: '对象', descEn: 'Object', aliases: [] },
  { type: 'any', desc: '任意类型', descEn: 'Any', aliases: [] },
])

/**
 * Build the data-type legend (canonical core types + any consumer-supplied
 * domain types) from an explicit `domainPortTypes` prop. Replaces the former
 * module-global `registerPortTypes` side effect: the legend is derived per
 * render from the prop, so two editors with different domains never clobber a
 * shared global. Domain entries that re-describe a core type override its
 * desc/aliases in place; brand-new domain types are appended.
 */
export function resolveCanonicalTypeMeta(domainPortTypes?: DomainPortTypes): CanonicalTypeMeta[] {
  const meta = CANONICAL_TYPE_META.map((m) => ({ ...m, aliases: [...m.aliases] }))
  if (!domainPortTypes) return meta
  for (const entry of domainPortTypes) {
    const canonical = normalizeType(entry.type)
    const aliases = entry.aliases ?? []
    const existing = meta.find((m) => m.type === canonical)
    if (existing) {
      existing.desc = entry.desc
      existing.descEn = entry.descEn
      existing.aliases = [...aliases]
    } else {
      meta.push({ type: canonical, desc: entry.desc, descEn: entry.descEn, aliases: [...aliases] })
    }
  }
  return meta
}
