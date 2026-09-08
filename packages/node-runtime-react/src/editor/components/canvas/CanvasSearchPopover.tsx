// Canvas double-click search popover: pops up at the cursor when the user
// double-clicks empty canvas; typing a query and clicking a result inserts that
// battery at the double-click position. Ported from the legacy editor
// (components/canvas/CanvasSearchPopover.tsx).
//
// Design notes:
//   - The classic node-editor habit (Blueprint / Blender): double-click empty
//     canvas to quick-search and insert a node.
//   - The popover mounts inside Canvas and is positioned by screen coordinates,
//     so it does not follow canvas pan / zoom.
//   - Results use onMouseDown rather than onClick to avoid the input-blur race
//     that would clear the query.
//
// Callbacks supplied by Canvas:
//   - onClose: Esc / outside click / after selection.
//   - onPickBattery: the picked battery is handed back to Canvas, which inserts
//     it with the same logic as a palette drop.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Battery } from '../../types.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'
import { RELAY_BATTERY_ID, RELAY_INPUT_PORT, RELAY_OUTPUT_PORT } from './RelayNode.js'
import './CanvasSearchPopover.css'

interface CanvasSearchPopoverProps {
  batteries: Battery[]
  langMode: 'zh' | 'en'
  /** The popover top-left screen (client) coordinate, set by the double-click. */
  screenX: number
  screenY: number
  onClose: () => void
  /** Fired when a result is picked; Canvas inserts it like a palette drop. */
  onPickBattery: (battery: Battery) => void
}

const POPOVER_WIDTH = 320
const POPOVER_MAX_HEIGHT = 320
const VIEWPORT_MARGIN = 8

export const RELAY_SEARCH_BATTERY: Battery = {
  id: RELAY_BATTERY_ID,
  name: 'Relay',
  nameEn: 'Relay',
  type: 'special',
  category: 'editor',
  description: 'Wire pass-through relay',
  descriptionEn: 'Wire pass-through relay',
  version: '1.0.0',
  inputs: [{ name: RELAY_INPUT_PORT, type: 'any', label: 'input' }],
  outputs: [{ name: RELAY_OUTPUT_PORT, type: 'any', label: 'output' }],
  params: [],
  tags: ['relay', 'wire', 'route'],
}

// Inline magnifier glyph (replaces the lucide-react Search icon — the faithful
// editor stays dependency-free of lucide).
function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="canvas-search-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function fuzzyMatch(b: Battery, query: string): boolean {
  if (!query.trim()) return true
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const fields = [
    b.id,
    b.name,
    b.description ?? '',
    b.descriptionEn ?? '',
    b.nameEn ?? '',
    b.category,
    ...(b.tags ?? []),
    ...(b.tagLabels ?? []),
  ].map((f) => f.toLowerCase())
  return tokens.every((token) => fields.some((field) => field.includes(token)))
}

export function CanvasSearchPopover({
  batteries,
  langMode,
  screenX,
  screenY,
  onClose,
  onPickBattery,
}: CanvasSearchPopoverProps) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchableBatteries = useMemo(() => {
    if (batteries.some((b) => b.id === RELAY_BATTERY_ID)) return batteries
    return [...batteries, RELAY_SEARCH_BATTERY]
  }, [batteries])

  // Position: clamp to the viewport bottom-right so it never runs off-screen.
  const style = useMemo<React.CSSProperties>(() => {
    const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN
    const maxTop = window.innerHeight - POPOVER_MAX_HEIGHT - VIEWPORT_MARGIN
    return {
      left: Math.max(VIEWPORT_MARGIN, Math.min(screenX, maxLeft)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(screenY, maxTop)),
      width: POPOVER_WIDTH,
    }
  }, [screenX, screenY])

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [])

  // Close on outside click.
  useEffect(() => {
    const handleDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!rootRef.current) return
      if (target && rootRef.current.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handleDocMouseDown)
    return () => document.removeEventListener('mousedown', handleDocMouseDown)
  }, [onClose])

  // Filtered results (cap at 50 to keep the list snappy).
  const filtered = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      return searchableBatteries.slice().sort((a, b) => a.id.localeCompare(b.id)).slice(0, 50)
    }
    return searchableBatteries.filter((b) => fuzzyMatch(b, trimmed)).slice(0, 50)
  }, [searchableBatteries, query])

  // Reset the active index when the query changes.
  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  // Keep the active item visible.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const el = list.querySelector<HTMLDivElement>(`[data-idx="${activeIdx}"]`)
    // scrollIntoView is absent in non-DOM/jsdom environments — guard it.
    if (el) el.scrollIntoView?.({ block: 'nearest' })
  }, [activeIdx])

  const handlePick = useCallback((b: Battery) => {
    onPickBattery(b)
    onClose()
  }, [onPickBattery, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = filtered[activeIdx]
      if (target) handlePick(target)
    }
  }, [filtered, activeIdx, handlePick, onClose])

  return (
    <div
      ref={rootRef}
      className="canvas-search-popover"
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="canvas-search-input-row">
        <SearchIcon size={14} />
        <input
          ref={inputRef}
          type="text"
          placeholder={langMode === 'en' ? 'Search nodes...' : '搜索节点... 名称 / 标签 / 描述'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <span className="canvas-search-count">{filtered.length}</span>
      </div>
      <div className="canvas-search-list" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="canvas-search-empty">
            {langMode === 'en' ? 'No matching nodes' : '未找到匹配节点'}
          </div>
        ) : (
          filtered.map((b, idx) => {
            const name = langMode === 'zh' ? b.name : (b.nameEn || formatIdAsLabel(b.id))
            const desc = langMode === 'zh'
              ? (b.description || '')
              : (b.descriptionEn || b.description || '')
            return (
              <div
                key={b.id}
                data-idx={idx}
                className={`canvas-search-item${idx === activeIdx ? ' is-active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handlePick(b)
                }}
                onMouseEnter={() => setActiveIdx(idx)}
              >
                <div className="canvas-search-item-icon">
                  {b.iconSvg
                    ? <span className="canvas-search-icon-svg" dangerouslySetInnerHTML={{ __html: b.iconSvg }} />
                    : <span className="canvas-search-icon-fallback">⬡</span>}
                </div>
                <div className="canvas-search-item-body">
                  <div className="canvas-search-item-name">{name}</div>
                  {desc && <div className="canvas-search-item-desc">{desc}</div>}
                  <div className="canvas-search-item-meta">
                    <span className="canvas-search-item-category">{b.category}</span>
                    {b.tags && b.tags.length > 0 && (
                      <span className="canvas-search-item-tags">
                        {b.tags.slice(0, 3).join(' · ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
      <div className="canvas-search-hint">
        {langMode === 'en'
          ? '↑↓ navigate · Enter insert · Esc close'
          : '↑↓ 切换 · 回车插入 · Esc 关闭'}
      </div>
    </div>
  )
}

export default CanvasSearchPopover
