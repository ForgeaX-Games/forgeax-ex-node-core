// DataTree port-shape visual helpers: pure rendering helpers, no compute.
// Produces port icons + tooltip summaries from the wire-side DataTreeEntry[]
// shape. Ported verbatim from the legacy editor (utils/datatreeShape.ts),
// retargeted onto the editor types module.

import type { BatteryAccess, BatteryPort } from '../types.js'

/** DataTree access getter (defaults to 'item'). */
export function getPortAccess(port?: Pick<BatteryPort, 'access'>): BatteryAccess {
  return port?.access ?? 'item'
}

interface DataTreeEntryShape {
  path: number[]
  items: unknown[]
}

/** Whether a value is the wire DataTreeEntry[] shape (path/items arrays). */
export function isDataTreeEntries(v: unknown): v is DataTreeEntryShape[] {
  if (!Array.isArray(v) || v.length === 0) return false
  const first = v[0]
  if (typeof first !== 'object' || first === null) return false
  const e = first as { path?: unknown; items?: unknown }
  return Array.isArray(e.path) && Array.isArray(e.items)
}

/**
 * Peel the first item of the first entry from a wire value (DataTreeEntry[]);
 * non-wire values are returned unchanged. Only single-entry / single-item
 * shapes degrade safely.
 */
export function peelWireValue(v: unknown): unknown {
  if (!isDataTreeEntries(v)) return v
  if (v.length !== 1) return v
  const items = v[0].items
  if (items.length !== 1) return v
  return items[0]
}

function describeItemType(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

/** Tooltip DataTree summary: 'branches: N · items: M · types: T1,T2'. */
export function formatDataTreeSummary(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (isDataTreeEntries(value)) {
    let itemTotal = 0
    const types = new Set<string>()
    for (const entry of value) {
      itemTotal += entry.items.length
      for (const it of entry.items) types.add(describeItemType(it))
    }
    const typesArr = Array.from(types).slice(0, 4).join(',') || 'empty'
    return `branches: ${value.length} · items: ${itemTotal} · types: ${typesArr}`
  }
  if (Array.isArray(value)) {
    return `branches: 1 · items: ${value.length} · types: ${describeItemType(value[0] ?? null)}`
  }
  return `branches: 1 · items: 1 · types: ${describeItemType(value)}`
}

/**
 * The battery's principal input port name (default fallback: the first
 * access=item|list input). Used for the principal-port visual marker.
 */
export function resolvePrincipalInputName(battery: {
  principal?: string
  inputs: Array<Pick<BatteryPort, 'name' | 'access'>>
}): string | undefined {
  if (battery.principal) return battery.principal
  return battery.inputs.find((p) => {
    const a = p.access ?? 'item'
    return a === 'item' || a === 'list'
  })?.name
}
