// Settings dropdown reference panels: the operation-history panel and the
// data-types legend. Ported faithfully from the legacy editor
// (components/toolbar/EditorSettingsPanels.tsx); store/util imports retargeted
// to ../../stores and ../../utils. The lucide-react Trash2 icon is replaced by
// an inline SVG to keep the package dependency-free (matching S3/S4); markup,
// CSS classes and the size API are preserved.
import { useEffect, useState } from 'react'
import { useHistoryStore, usePipelineStore, useUIStore } from '../../stores/index.js'
import { resolveCanonicalTypeMeta, getPortTypeColor } from '../../utils/portTypes.js'
import type { DomainPortTypes } from '../../utils/portTypes.js'
import type { HistoryEntryView } from '../../sync/editorBridge.js'
import './EditorSettingsPanels.css'

function Trash2({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

interface SettingsHistoryPanelProps {
  /** Custom clear handler (e.g. mirror mode broadcasting to a central pane). */
  onClear?: () => void
  /**
   * Mirror data (side-pane mode, fed by the editor sync bridge). When supplied,
   * the list renders from it instead of the local history store — used where the
   * editor runs in a different iframe so the local store would be empty.
   */
  mirror?: { entries: ReadonlyArray<HistoryEntryView>; cursor: number }
}

export function SettingsHistoryPanel({ onClear, mirror }: SettingsHistoryPanelProps = {}) {
  const localEntries = useHistoryStore(s => s.entries)
  const localCursor = useHistoryStore(s => s.cursor)
  const localClear = useHistoryStore(s => s.clearHistory)
  const entries: ReadonlyArray<HistoryEntryView> = mirror ? mirror.entries : localEntries
  const cursor = mirror ? mirror.cursor : localCursor
  const clearHistory = onClear ?? localClear
  const langMode = useUIStore(s => s.langMode)
  const en = langMode === 'en'

  const undoCount = cursor
  const redoCount = entries.length - cursor
  const canUndo = undoCount > 0
  const canRedo = redoCount > 0

  const formatTime = (ts: number): string => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  }

  return (
    <div className="settings-history-panel">
      <div className="history-toolbar">
        <div className="history-undo-redo">
          <span className="history-total-count" title={en ? `${entries.length} operation(s)` : `共 ${entries.length} 条操作记录`}>
            {entries.length} {en ? 'step(s)' : '步'}
          </span>
          <span
            className={`history-undo-badge${canUndo ? ' history-undo-badge--active' : ''}`}
            title={canUndo ? (en ? `Undo ${undoCount} step(s) (Ctrl+Z)` : `可撤销 ${undoCount} 步（Ctrl+Z）`) : (en ? 'Nothing to undo' : '没有可撤销的操作')}
          >
            ↩ {undoCount}
          </span>
          <span
            className={`history-undo-badge${canRedo ? ' history-undo-badge--active history-undo-badge--redo' : ''}`}
            title={canRedo ? (en ? `Redo ${redoCount} step(s) (Ctrl+Y)` : `可恢复 ${redoCount} 步（Ctrl+Y）`) : (en ? 'Nothing to redo' : '没有可恢复的操作')}
          >
            ↪ {redoCount}
          </span>
        </div>
        <button
          className="history-clear-btn"
          onClick={clearHistory}
          title={en ? 'Clear history' : '清空历史记录'}
        >
          <Trash2 size={10} />
          <span>{en ? 'Clear' : '清空'}</span>
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="settings-panel-empty">
          {en ? 'No actions yet. Add nodes or connect edges to start recording.' : '暂无操作记录。在工作区拖入节点、连线或移动节点后会自动记录。'}
        </div>
      ) : (
        <div className="history-list">
          {[...entries].reverse().map((entry, revIdx) => {
            const realIdx = entries.length - 1 - revIdx
            const isActive = realIdx < cursor
            const isCurrent = realIdx === cursor - 1
            const displayLabel = en ? (entry.labelEn ?? entry.label) : entry.label
            return (
              <div
                key={entry.id}
                className={`history-item${isCurrent ? ' history-item--latest' : ''}${!isActive ? ' history-item--undone' : ''}`}
              >
                <span className="history-icon">
                  {ACTION_TYPE_ICONS[entry.type] ?? '·'}
                </span>
                <div className="history-body">
                  <span className="history-label">{displayLabel}</span>
                  <span className="history-time">{formatTime(entry.timestamp)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const ACTION_TYPE_ICONS: Record<string, string> = {
  add_node: '＋',
  delete_node: '✕',
  move_node: '↔',
  move_nodes_batch: '↔↔',
  connect_edge: '→',
  delete_edge: '✂',
  paste_nodes: '⎘',
  resize_node: '⤡',
  edit_text: '✎',
  change_param: '⊞',
  toggle_value: '◎',
  toggle_preview: '◑',
  load_pipeline: '⊙',
  group_nodes: '▣',
  ungroup_nodes: '▤',
  batch_applied: '⚡',
}

export function SettingsDataTypesPanel({ domainPortTypes }: { domainPortTypes?: DomainPortTypes } = {}) {
  const batteries = usePipelineStore(s => s.batteries)
  const langMode = useUIStore(s => s.langMode)
  // Legend = canonical core types + any consumer-supplied domain types, derived
  // from the `domainPortTypes` prop (single source of truth — no module global).
  const [types, setTypes] = useState(() => resolveCanonicalTypeMeta(domainPortTypes))

  useEffect(() => {
    setTypes(resolveCanonicalTypeMeta(domainPortTypes))
  }, [batteries, domainPortTypes])

  return (
    <div className="settings-data-types-panel">
      {types.map(({ type, desc, descEn, aliases }) => {
        const color = getPortTypeColor(type, domainPortTypes)
        return (
          <div key={type} className="dtype-row">
            <div className="dtype-dot" style={{ background: color }} />
            <div className="dtype-body">
              <span className="dtype-name">{type}</span>
              <span className="dtype-desc">{langMode === 'en' ? descEn : desc}</span>
              {aliases.map(alias => (
                <span key={alias} className="dtype-alias">{alias}</span>
              ))}
            </div>
            <span className="dtype-hex">{color}</span>
          </div>
        )
      })}
    </div>
  )
}
