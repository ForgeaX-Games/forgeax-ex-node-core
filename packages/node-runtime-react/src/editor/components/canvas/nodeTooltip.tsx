// Shared tooltip utilities: TooltipState type, formatPortValue, TooltipPortal
// component, useNodeTooltip hook. Every canvas node component shares this file.
// Ported verbatim from the legacy editor (components/canvas/nodeTooltip.tsx),
// retargeted onto the editor stores. Domain value shapes (scene / geometry) are
// formatted exclusively through the injected `domainValueFormatters` — the core
// no longer hard-codes any scene-specific sentinel handling.
import { useState, useCallback, useRef, useEffect, useMemo, createContext, useContext } from 'react'
import ReactDOM from 'react-dom'
import { usePipelineStore } from '../../stores/index.js'
import { isDataTreeEntries } from '../../utils/datatreeShape.js'

export interface TooltipState {
  x: number
  y: number
  title: string
  subtitle?: string
  subtitleColor?: string
  /** Category tag line under the title (battery tooltip). */
  tagLine?: string
  /** tagLine colour, matching the big-label accent colour. */
  tagLineColor?: string
  description?: string
  valueLine?: {
    label: string
    text: string
    /** For array/dict: a compact preview line under text, e.g. ["a", "b"]. */
    extra?: string
    /** DataTree shape summary + access. */
    treeInfo?: string
    muted?: boolean
  }
}

export interface DomainValueFormatter {
  /** Singular domain value name used for compact DataTree summaries. */
  typeLabel?: string
  /** Optional plural override when `${typeLabel}s` is not correct. */
  typeLabelPlural?: string
  /** Return a one-line summary, or undefined when this formatter does not own the value. */
  format(value: unknown): string | undefined
  /** Optional secondary detail line for expanded probes/tooltips. */
  formatExtra?(value: unknown): string | undefined
  /** Optional compact summary for DataTree/list values whose items are all this domain type. */
  formatList?(values: readonly unknown[], branchSuffix: string): string | undefined
}

export type DomainValueFormatters = readonly DomainValueFormatter[]

const EMPTY_FORMATTERS: DomainValueFormatters = []

/**
 * Domain value formatters are supplied per editor instance (a React Context
 * prop), NOT a module global — two editors with different domains never clobber
 * a shared registry. UI components consume them via `useNodeValueFormatters()`.
 */
const ValueFormattersContext = createContext<DomainValueFormatters>(EMPTY_FORMATTERS)

/** Provide the domain value formatters to the editor subtree. */
export const ValueFormattersProvider = ValueFormattersContext.Provider

/**
 * Bound `formatPortValue` / `formatPortValueExtra` for the current editor's
 * domain formatters. The returned functions have a STABLE identity (so they can
 * be used inside callbacks without widening dependency arrays) yet always read
 * the latest context formatters via a ref.
 */
export function useNodeValueFormatters(): {
  formatPortValue: (value: unknown) => string
  formatPortValueExtra: (value: unknown) => string | undefined
} {
  const formatters = useContext(ValueFormattersContext)
  const ref = useRef(formatters)
  ref.current = formatters
  return useMemo(
    () => ({
      formatPortValue: (value: unknown) => formatPortValue(value, ref.current),
      formatPortValueExtra: (value: unknown) => formatPortValueExtra(value, ref.current),
    }),
    [],
  )
}

function matchDomainValue(
  value: unknown,
  formatters: DomainValueFormatters,
): { formatter: DomainValueFormatter; text: string } | undefined {
  for (const formatter of formatters) {
    const text = formatter.format(value)
    if (text !== undefined) return { formatter, text }
  }
  return undefined
}

function formatDomainValueList(
  values: readonly unknown[],
  branchSuffix: string,
  formatters: DomainValueFormatters,
): string | undefined {
  if (values.length === 0) return undefined
  for (const formatter of formatters) {
    const formatted = values.map((value) => formatter.format(value))
    if (!formatted.every((text): text is string => text !== undefined)) continue
    if (values.length === 1) return formatted[0]
    const custom = formatter.formatList?.(values, branchSuffix)
    if (custom !== undefined) return custom
    const singular = formatter.typeLabel ?? 'domain item'
    const plural = formatter.typeLabelPlural ?? `${singular}s`
    return `${values.length} ${values.length === 1 ? singular : plural}${branchSuffix}`
  }
  return undefined
}

/**
 * Resolve an input port's current value (priority: upstream connected output >
 * node.params > undefined). Input values are injected by the execution engine
 * via upstream connections, never written back to node.params, so we trace
 * edges to find the upstream node and read from nodeOutputs.
 */
export function resolveInputPortValue(nodeId: string, portName: string): unknown {
  const state = usePipelineStore.getState()
  const edges = state.currentPipeline?.edges ?? []
  const connectedEdge = edges.find(
    (e) => e.target.nodeId === nodeId && e.target.port === portName,
  )
  if (connectedEdge) {
    const upstreamVal = state.nodeOutputs[connectedEdge.source.nodeId]?.[connectedEdge.source.port]
    if (upstreamVal !== undefined) return upstreamVal
  }

  const node = state.currentPipeline?.nodes.find((n) => n.id === nodeId)
  if (!node) return undefined
  if (node.params[portName] !== undefined) return node.params[portName]

  return undefined
}

/** Whether a value is a strict 2D integer grid (array of array of number). */
function isStrictGrid2D(value: unknown[]): boolean {
  if (value.length === 0) return false
  const firstRow = value[0]
  if (!Array.isArray(firstRow) || firstRow.length === 0) return false
  return typeof firstRow[0] === 'number'
}

/** "rows×cols" for a 2D grid, undefined otherwise. */
function gridDims(v: unknown): string | undefined {
  if (!Array.isArray(v) || !isStrictGrid2D(v)) return undefined
  return `${v.length}×${(v[0] as unknown[]).length}`
}

/** Format an arbitrary port value into a readable single-line string. */
export function formatPortValue(value: unknown, formatters: DomainValueFormatters = EMPTY_FORMATTERS): string {
  if (value === undefined || value === null) return '—'
  const domainText = matchDomainValue(value, formatters)?.text
  if (domainText !== undefined) return domainText
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value.length > 60 ? value.slice(0, 57) + '…' : value
  if (Array.isArray(value)) {
    if (isStrictGrid2D(value)) {
      return `grid ${value.length}×${(value[0] as unknown[]).length}`
    }
    if (isDataTreeEntries(value)) {
      const allItems = value.flatMap((e) => e.items)
      const totalItems = allItems.length
      const branches = value.length
      const branchSuffix = branches > 1 ? ` · ${branches}B` : ''

      const dims = allItems.map(gridDims).filter(Boolean) as string[]
      if (dims.length > 0) {
        const uniq = [...new Set(dims)]
        const dimsStr = uniq.length === 1 ? uniq[0] : uniq.join(' / ')
        if (dims.length === 1) return `grid ${dimsStr}`
        return `${dims.length} grids${branchSuffix} (${dimsStr})`
      }

      const domainListText = formatDomainValueList(allItems, branchSuffix, formatters)
      if (domainListText !== undefined) return domainListText

      if (totalItems === 1) return formatPortValue(allItems[0], formatters)
      return `${totalItems} items${branchSuffix}`
    }
    return `[array, ${value.length} items]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const pairsLabel = `[dict: ${entries.length} pairs]`
    if (entries.length === 0) return pairsLabel
    const MAX_KEYS = 5
    const keys = entries.slice(0, MAX_KEYS).map(([k]) => `"${k}"`)
    const keysStr = keys.join(', ') + (entries.length > MAX_KEYS ? ', …' : '')
    return `${pairsLabel}  keys: ${keysStr}`
  }
  const json = JSON.stringify(value)
  return json.length > 60 ? json.slice(0, 57) + '…' : json
}

/** Compact preview string for array/dict, appended under the summary line. */
export function formatPortValueExtra(value: unknown, formatters: DomainValueFormatters = EMPTY_FORMATTERS): string | undefined {
  const domainMatch = matchDomainValue(value, formatters)
  if (domainMatch?.formatter.formatExtra) return domainMatch.formatter.formatExtra(value)
  if (isDataTreeEntries(value)) {
    const hasGrid = value.some((e) => e.items.some((it) => gridDims(it) !== undefined))
    if (hasGrid) {
      const MAX = 6
      const parts = value.slice(0, MAX).map((e) => {
        const pathStr = `{${e.path.join(',')}}`
        const gridCount = e.items.filter((it) => gridDims(it) !== undefined).length
        return gridCount === 1 ? pathStr : `${pathStr}×${gridCount}`
      })
      return parts.join('  ') + (value.length > MAX ? `  …+${value.length - MAX}B` : '')
    }
    const allItems = value.flatMap((e) => e.items)
    if (allItems.length > 0) {
      const MAX = 4
      const items = allItems.slice(0, MAX).map((v) => JSON.stringify(v) ?? String(v))
      const preview = '[' + items.join(', ') + (allItems.length > MAX ? ', …' : '') + ']'
      return preview.length > 80 ? preview.slice(0, 77) + '…]' : preview
    }
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined
    if (isStrictGrid2D(value)) return undefined
    const MAX = 4
    const items = value.slice(0, MAX).map((v) => JSON.stringify(v) ?? String(v))
    const preview = '[' + items.join(', ') + (value.length > MAX ? ', …' : '') + ']'
    return preview.length > 80 ? preview.slice(0, 77) + '…]' : preview
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return undefined
    const MAX = 4
    const items = entries.slice(0, MAX).map(([k, v]) => `"${k}": ${JSON.stringify(v) ?? String(v)}`)
    const preview = '{' + items.join(', ') + (entries.length > MAX ? ', …' : '') + '}'
    return preview.length > 80 ? preview.slice(0, 77) + '…}' : preview
  }
  return undefined
}

/** Render the tooltip into document.body via a portal (escapes the RF transform). */
export function TooltipPortal({ tooltip }: { tooltip: TooltipState }) {
  return ReactDOM.createPortal(
    <div className="node-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      <div className="node-tooltip-header">
        <div className="node-tooltip-title">{tooltip.title}</div>
        {tooltip.subtitle && (
          <div className="node-tooltip-type" style={{ color: tooltip.subtitleColor }}>
            {tooltip.subtitle}
          </div>
        )}
      </div>
      {tooltip.tagLine && (
        <div
          className="node-tooltip-tag"
          style={tooltip.tagLineColor ? { color: tooltip.tagLineColor } : undefined}
        >
          {tooltip.tagLine}
        </div>
      )}
      {tooltip.description && <div className="node-tooltip-desc">{tooltip.description}</div>}
      {tooltip.valueLine && (
        <div className={`node-tooltip-value${tooltip.valueLine.muted ? ' muted' : ''}`}>
          <span className="node-tooltip-value-label">{tooltip.valueLine.label}</span>
          <span className="node-tooltip-value-text">{tooltip.valueLine.text}</span>
          {tooltip.valueLine.extra && (
            <span className="node-tooltip-value-extra">{tooltip.valueLine.extra}</span>
          )}
          {tooltip.valueLine.treeInfo && (
            <span className="node-tooltip-value-tree-info">{tooltip.valueLine.treeInfo}</span>
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}

export type BatteryTooltipState = Omit<TooltipState, 'x' | 'y'>

/** Unified tooltip state-management hook (delayed battery / immediate port). */
export function useNodeTooltip(batteryDelay = 1000, portDelay = 500, dragging = false) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const tooltipTypeRef = useRef<'battery' | 'port' | null>(null)
  const pendingBatteryStateRef = useRef<BatteryTooltipState | null>(null)
  const pendingPortRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startBatteryTimer = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      const state = pendingBatteryStateRef.current
      if (state) {
        const { x, y } = mousePosRef.current
        setTooltip({ ...state, x: x + 16, y: y - 8 })
        tooltipTypeRef.current = 'battery'
      }
    }, batteryDelay)
  }, [clearTimer, batteryDelay])

  const showImmediate = useCallback(
    (state: TooltipState) => {
      clearTimer()
      pendingPortRef.current = true
      timerRef.current = setTimeout(() => {
        setTooltip(state)
        tooltipTypeRef.current = 'port'
        pendingPortRef.current = false
      }, portDelay)
    },
    [clearTimer, portDelay],
  )

  const showDelayed = useCallback(
    (state: BatteryTooltipState) => {
      pendingBatteryStateRef.current = state
      startBatteryTimer()
    },
    [startBatteryTimer],
  )

  const hide = useCallback(() => {
    clearTimer()
    setTooltip(null)
    tooltipTypeRef.current = null
    pendingBatteryStateRef.current = null
    pendingPortRef.current = false
  }, [clearTimer])

  const trackMouse = useCallback(
    (e: React.MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY }
      if (pendingPortRef.current || tooltipTypeRef.current === 'port') return
      if (tooltipTypeRef.current === 'battery') {
        setTooltip(null)
        tooltipTypeRef.current = null
      }
      if (pendingBatteryStateRef.current) {
        startBatteryTimer()
      }
    },
    [startBatteryTimer],
  )

  useEffect(() => {
    if (dragging) {
      clearTimer()
      setTooltip(null)
      tooltipTypeRef.current = null
      pendingBatteryStateRef.current = null
      pendingPortRef.current = false
    }
  }, [dragging, clearTimer])

  useEffect(() => () => clearTimer(), [clearTimer])

  return { tooltip, showImmediate, showDelayed, hide, trackMouse }
}
