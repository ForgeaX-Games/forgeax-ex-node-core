// 💡 左侧边栏：折叠面板结构——节点信息（只读）、日志、帮助、预设文本面板、操作历史
// 不含编译信息面板；节点信息展示完整输入/输出端口及类型，只读不可编辑
// 支持右侧拖拽调整宽度；各面板支持底部拖拽调整高度，状态持久化到 localStorage
// 菜单可拖拽重排顺序（HTML5 DnD），顺序持久化到 localStorage
//
// 忠实移植说明（faithful port）：
//  ─ lucide-react 图标（ChevronDown/ChevronRight/GripVertical/Bookmark/X/Trash2/Star）
//    替换为内联 SVG，保持包零依赖；markup / CSS class / size API 全部保留。
//  ─ Tag 审查面板（TagReviewPanel）依赖 app 级 alg-tag 索引/写回后端（/api/v1/batteries/alg-tags-index
//    与 .../alg-tag PATCH），属构建期作者工具而非通用编辑器 chrome，整段延后（deferred）。
//  ─ 帮助面板（HelpPanel）原拉取 app 级 /api/v1/system/help 文档；通用编辑器中剥离该 fetch，
//    保留面板与本地占位文案，帮助文档内容延后（deferred）。
import { useState, useCallback, useRef, useEffect } from 'react'
import { usePipelineStore } from '../../stores/index.js'
import { useUIStore } from '../../stores/index.js'
import { useHistoryStore } from '../../stores/index.js'
import { getPortTypeColor, normalizeType, resolveCanonicalTypeMeta, type DomainPortTypes } from '../../utils/portTypes.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'
import type { Battery, BatteryPort } from '../../types.js'
import './LeftSidebar.css'

// ── 内联图标（替换 lucide-react，保持包零依赖；统一 lucide 风格） ──────────────
type IconProps = { size?: number; className?: string; style?: React.CSSProperties }

function svgIconProps(size: number, className?: string, style?: React.CSSProperties) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    style,
    'aria-hidden': true as const,
  }
}

function ChevronDown({ size = 16, className, style }: IconProps) {
  return <svg {...svgIconProps(size, className, style)}><polyline points="6 9 12 15 18 9" /></svg>
}

function ChevronRight({ size = 16, className, style }: IconProps) {
  return <svg {...svgIconProps(size, className, style)}><polyline points="9 18 15 12 9 6" /></svg>
}

function GripVertical({ size = 16, className, style }: IconProps) {
  return (
    <svg {...svgIconProps(size, className, style)} fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="6" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="15" cy="18" r="1.6" />
    </svg>
  )
}

function Bookmark({ size = 16, className, style }: IconProps) {
  return <svg {...svgIconProps(size, className, style)}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
}

function X({ size = 16, className, style }: IconProps) {
  return (
    <svg {...svgIconProps(size, className, style)}>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function Trash2({ size = 16, className, style }: IconProps) {
  return (
    <svg {...svgIconProps(size, className, style)}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

function Star({ size = 16, className, style }: IconProps) {
  return (
    <svg {...svgIconProps(size, className, style)}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

// ── 菜单顺序配置与持久化 ──────────────────────────────────────────────────────
interface SectionConfig {
  id: string
  title: string
  titleEn: string
  defaultOpen: boolean
}

const SECTION_CONFIGS: SectionConfig[] = [
  { id: 'nodeinfo',    title: '节点信息',     titleEn: 'Node Info',     defaultOpen: true  },
  { id: 'favorites',   title: '常用节点',     titleEn: 'Favorites',     defaultOpen: true  },
  { id: 'history',     title: '操作历史',     titleEn: 'History',       defaultOpen: true  },
  { id: 'textpresets', title: '预设文本面板', titleEn: 'Text Presets',  defaultOpen: false },
  { id: 'datatypes',   title: '数据类型',     titleEn: 'Data Types',    defaultOpen: false },
  { id: 'logs',        title: '日志',         titleEn: 'Logs',          defaultOpen: false },
  { id: 'help',        title: '帮助',         titleEn: 'Help',          defaultOpen: false },
]

const DEFAULT_SECTION_ORDER = SECTION_CONFIGS.map(s => s.id)

function loadSectionOrder(): string[] {
  try {
    const raw = localStorage.getItem('sidebar-section-order')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((id: string) => DEFAULT_SECTION_ORDER.includes(id))
        const missing = DEFAULT_SECTION_ORDER.filter(id => !valid.includes(id))
        return [...valid, ...missing]
      }
    }
  } catch { /* ignore */ }
  return [...DEFAULT_SECTION_ORDER]
}

function saveSectionOrder(order: string[]): void {
  try {
    localStorage.setItem('sidebar-section-order', JSON.stringify(order))
  } catch { /* ignore */ }
}

// ── 面板初始高度（与现有 max-height 一致）────────────────────────────────────
const DEFAULT_SECTION_HEIGHT = 220

function loadSectionState(key: string, defaultOpen: boolean, defaultHeight: number): { open: boolean; height: number } {
  try {
    const raw = localStorage.getItem(`sidebar-section-${key}`)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        open: typeof parsed.open === 'boolean' ? parsed.open : defaultOpen,
        height: typeof parsed.height === 'number' ? parsed.height : defaultHeight,
      }
    }
  } catch { /* ignore */ }
  return { open: defaultOpen, height: defaultHeight }
}

// ── 折叠面板通用组件 ──────────────────────────────────────────────────────────
interface CollapsibleSectionProps {
  title: string
  storageKey: string
  defaultOpen?: boolean
  defaultHeight?: number
  children: React.ReactNode
  /** 附加到根 div 的额外 class，用于按 section 定制样式 */
  extraClass?: string
  // 拖拽排序相关
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void
  isDragOver?: boolean
}

function CollapsibleSection({
  title,
  storageKey,
  defaultOpen = true,
  defaultHeight = DEFAULT_SECTION_HEIGHT,
  children,
  extraClass,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragOver = false,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(() => loadSectionState(storageKey, defaultOpen, defaultHeight).open)
  const [height, setHeight] = useState(() => loadSectionState(storageKey, defaultOpen, defaultHeight).height)
  const heightDragRef = useRef<{ startY: number; startH: number } | null>(null)
  // 只允许从握柄发起的拖拽
  const dragAllowed = useRef(false)

  // 持久化到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(`sidebar-section-${storageKey}`, JSON.stringify({ open: isOpen, height }))
    } catch { /* ignore */ }
  }, [storageKey, isOpen, height])

  // 底部拖拽调整高度（唯一改变高度的方式）
  const onHeightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    heightDragRef.current = { startY: e.clientY, startH: height }
  }, [height])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!heightDragRef.current) return
      const delta = e.clientY - heightDragRef.current.startY
      const next = Math.max(60, Math.min(700, heightDragRef.current.startH + delta))
      setHeight(next)
    }
    const onUp = () => { heightDragRef.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div
      className={`collapsible-section${isDragOver ? ' section-drag-over' : ''}${extraClass ? ` ${extraClass}` : ''}`}
      draggable={!!onDragStart}
      onDragStart={(e) => {
        if (!dragAllowed.current) { e.preventDefault(); return }
        onDragStart?.(e)
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={(e) => {
        dragAllowed.current = false
        onDragEnd?.(e)
      }}
    >
      <button className="section-header" onClick={() => setIsOpen(prev => !prev)}>
        {/* 拖拽握柄：只有从此处按下才允许拖拽 */}
        <span
          className="section-drag-handle"
          onMouseDown={() => { dragAllowed.current = true }}
          onClick={e => e.stopPropagation()}
        >
          <GripVertical size={11} />
        </span>
        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="section-title">{title}</span>
      </button>
      {isOpen && (
        <>
          <div className="section-content" style={{ height }}>
            {children}
          </div>
          <div className="section-height-handle" onMouseDown={onHeightResizeStart} />
        </>
      )}
    </div>
  )
}

// ── 值格式化（端口当前值展示用）──────────────────────────────────────────────
function formatShortValue(v: unknown): string {
  if (v === undefined || v === null) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v.length > 22 ? v.slice(0, 20) + '…' : v
  if (Array.isArray(v)) {
    if (v.length > 0 && Array.isArray(v[0])) return `grid ${v.length}×${(v[0] as unknown[]).length}`
    return `[${v.length} items]`
  }
  return JSON.stringify(v).slice(0, 22)
}

// ── 节点信息面板（只读）───────────────────────────────────────────────────────
interface NodeInfoPanelProps {
  node: {
    id: string
    batteryId: string
    name: string
    position: { x: number; y: number }
    params: Record<string, unknown>
  } | null
  battery: Battery | null
  nodeOutputs: Record<string, Record<string, unknown>>
  domainPortTypes?: DomainPortTypes
}

function NodeInfoPanel({ node, battery, nodeOutputs, domainPortTypes }: NodeInfoPanelProps) {
  const langMode = useUIStore((s) => s.langMode)

  if (!node) {
    return <div className="panel-empty">{langMode === 'en' ? 'Select a node on the canvas' : '请在画布中选择一个节点'}</div>
  }

  const outputs = battery?.outputs ?? []
  const inputs = battery?.inputs ?? []
  const outVals = nodeOutputs[node.id] ?? {}

  const batteryDisplayName = battery
    ? (langMode === 'zh' ? battery.name : formatIdAsLabel(battery.id))
    : node.name
  const batteryDesc = battery
    ? (langMode === 'zh' ? battery.description : (battery.descriptionEn || battery.description))
    : undefined

  return (
    <div className="node-info-panel">
      {/* 基础信息 */}
      <div className="info-block">
        <InfoRow label={langMode === 'en' ? 'Name' : '名称'} value={batteryDisplayName} />
        <InfoRow label={langMode === 'en' ? 'Battery Type' : '电池类型'} value={node.batteryId} mono />
        {battery?.version  && <InfoRow label={langMode === 'en' ? 'Version' : '版本'} value={`v${battery.version}`} />}
        {battery?.category && <InfoRow label={langMode === 'en' ? 'Category' : '分类'} value={battery.category} />}
        {batteryDesc && <InfoRow label={langMode === 'en' ? 'Description' : '描述'} value={batteryDesc} />}
      </div>

      {/* 输入端口 */}
      {inputs.length > 0 && (
        <div className="port-block">
          <div className="port-block-title">{langMode === 'en' ? 'Inputs' : '输入端口'}</div>
          {inputs.map(port => (
            <PortRow key={port.name} port={port} value={node.params[port.name]} langMode={langMode} domainPortTypes={domainPortTypes} />
          ))}
        </div>
      )}

      {/* 输出端口 */}
      {outputs.length > 0 && (
        <div className="port-block">
          <div className="port-block-title">{langMode === 'en' ? 'Outputs' : '输出端口'}</div>
          {outputs.map(port => (
            <PortRow key={port.name} port={port} value={outVals[port.name]} isOutput langMode={langMode} domainPortTypes={domainPortTypes} />
          ))}
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className={`info-value${mono ? ' info-mono' : ''}`}>{value}</span>
    </div>
  )
}

function PortRow({ port, value, isOutput, langMode, domainPortTypes }: { port: BatteryPort; value: unknown; isOutput?: boolean; langMode?: string; domainPortTypes?: DomainPortTypes }) {
  const canonical = normalizeType(port.type)
  const color = getPortTypeColor(canonical, domainPortTypes)
  const hasVal = value !== undefined && value !== null

  const displayName = langMode === 'zh' ? (port.label ?? port.name) : port.name
  const displayDesc = langMode === 'zh' ? port.description : (port.descriptionEn || port.description)

  return (
    <div className="port-row">
      <div className="port-dot" style={{ background: color, flexShrink: 0 }} />
      <div className="port-info">
        <span className="port-name">{displayName}</span>
        <span className="port-type">{canonical}</span>
        {displayDesc && <span className="port-desc">{displayDesc}</span>}
      </div>
      {hasVal && (
        <span className={`port-value ${isOutput ? 'port-value--out' : 'port-value--in'}`}>
          {formatShortValue(value)}
        </span>
      )}
    </div>
  )
}

// ── 数据类型面板 ──────────────────────────────────────────────────────────────
// 每次电池列表更新时重新读取，确保展示最新类型数据
function DataTypesPanel({ domainPortTypes }: { domainPortTypes?: DomainPortTypes }) {
  const batteries = usePipelineStore(s => s.batteries)
  const langMode  = useUIStore(s => s.langMode)
  const [types, setTypes] = useState(() => resolveCanonicalTypeMeta(domainPortTypes))

  useEffect(() => {
    // 电池更新或领域类型变化时重新读取规范类型（含 domain 注入的类型）
    setTypes(resolveCanonicalTypeMeta(domainPortTypes))
  }, [batteries, domainPortTypes])

  return (
    <div className="data-types-panel">
      {types.map(({ type, desc, descEn, aliases }) => {
        const color = getPortTypeColor(type, domainPortTypes)
        return (
          <div key={type} className="dtype-row">
            <div className="dtype-dot" style={{ background: color }} />
            <div className="dtype-body">
              <span className="dtype-name">{type}</span>
              <span className="dtype-desc">{langMode === 'en' ? descEn : desc}</span>
              {aliases.map(a => (
                <span key={a} className="dtype-alias">{a}</span>
              ))}
            </div>
            <span className="dtype-hex">{color}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── 日志面板 ──────────────────────────────────────────────────────────────────
function LogsPanel({ logs }: { logs: string[] }) {
  const langMode = useUIStore(s => s.langMode)
  if (!logs || logs.length === 0) return <div className="panel-empty">{langMode === 'en' ? 'No logs' : '暂无日志'}</div>
  return (
    <div className="logs-panel">
      {logs.map((log, i) => (
        <div key={i} className="log-line">{log}</div>
      ))}
    </div>
  )
}

// ── 帮助面板 ──────────────────────────────────────────────────────────────────
// 忠实移植：原拉取 app 级 /api/v1/system/help 文档，通用编辑器中剥离该 fetch，
// 仅保留面板与本地占位文案（帮助文档内容延后）。
function HelpPanel() {
  const langMode = useUIStore(s => s.langMode)
  const en = langMode === 'en'
  return (
    <div className="help-panel">
      <p className="help-p">
        {en
          ? 'Help content is provided by the host application.'
          : '帮助文档由宿主应用提供。'}
      </p>
    </div>
  )
}

// ── 预设文本面板 ──────────────────────────────────────────────────────────────
// 展示保存的文本预设列表，支持拖拽到画布生成 TextPanel 节点，支持删除
function TextPresetsPanel() {
  const textPresets   = useUIStore((s) => s.textPresets)
  const removeTextPreset = useUIStore((s) => s.removeTextPreset)
  const batteries     = usePipelineStore((s) => s.batteries)
  const langMode      = useUIStore((s) => s.langMode)

  // 拖拽开始：stopPropagation 阻止冒泡到 CollapsibleSection（父级 draggable）避免其 e.preventDefault() 取消拖拽
  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, text: string) => {
    e.stopPropagation()
    const textPanelBattery = batteries.find(b => b.id === 'text_panel')
    if (!textPanelBattery) {
      console.warn('[TextPresetsPanel] text_panel battery not found in registry')
      return
    }
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('application/battery', JSON.stringify(textPanelBattery))
    e.dataTransfer.setData('application/preset-text', text)
  }, [batteries])

  if (textPresets.length === 0) {
    return (
      <div className="panel-empty text-presets-empty">
        {langMode === 'en'
          ? <>No presets. Click the <Bookmark size={11} style={{ display: 'inline', verticalAlign: 'middle' }} /> on a text panel to save.</>
          : <>暂无预设。在工作区文本面板右上角点击 <Bookmark size={11} style={{ display: 'inline', verticalAlign: 'middle' }} /> 保存</>
        }
      </div>
    )
  }

  return (
    <div className="text-presets-panel">
      {textPresets.map((preset) => (
        <div
          key={preset.id}
          className="text-preset-item"
          draggable
          onDragStart={(e) => handleDragStart(e, preset.text)}
        >
          <div className="text-preset-content">{preset.text}</div>
          <button
            className="text-preset-delete"
            onClick={() => removeTextPreset(preset.id)}
            title={langMode === 'en' ? 'Delete preset' : '删除此预设'}
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ── 操作历史面板 ──────────────────────────────────────────────────────────────
// 展示用户在画布中执行的可回退操作（添加/删除/移动节点、连线/断线、复制粘贴等）
// 最新操作在最上方；支持一键清空
const ACTION_TYPE_ICONS: Record<string, string> = {
  add_node:         '＋',
  delete_node:      '✕',
  move_node:        '↔',
  move_nodes_batch: '↔↔',
  connect_edge:     '→',
  delete_edge:      '✂',
  paste_nodes:      '⎘',
  resize_node:      '⤡',
  edit_text:        '✎',
  change_param:     '⊞',
  toggle_value:     '◎',
  toggle_preview:   '◑',
  load_pipeline:    '⊙',
  group_nodes:      '▣',
  ungroup_nodes:    '▤',
}

function HistoryPanel() {
  const entries      = useHistoryStore(s => s.entries)
  const cursor       = useHistoryStore(s => s.cursor)
  const clearHistory = useHistoryStore(s => s.clearHistory)
  const langMode     = useUIStore(s => s.langMode)
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
    <div className="history-panel">
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
        <div className="panel-empty history-empty">
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

// ── 常用节点收藏面板 ──────────────────────────────────────────────────────────
// 展示用户收藏的电池列表，支持：
//  1. 从电池栏拖入此面板完成收藏（application/battery，无 favorite-sort 标记）
//  2. 面板内卡片拖拽重排（application/favorite-sort 标记），顺序持久化到 localStorage
//  3. 拖出到画布生成节点（行为与电池栏一致）
//  4. 悬停显示删除按钮，点击移除收藏
function FavoritesPanel() {
  const favoriteBatteries       = useUIStore((s) => s.favoriteBatteries)
  const addFavoriteBattery      = useUIStore((s) => s.addFavoriteBattery)
  const removeFavoriteBattery   = useUIStore((s) => s.removeFavoriteBattery)
  const reorderFavoriteBatteries = useUIStore((s) => s.reorderFavoriteBatteries)
  const langMode                = useUIStore((s) => s.langMode)

  // 外层面板 drag-over 高亮（仅新增收藏时，排除内部排序）
  const [isDragOver, setIsDragOver] = useState(false)
  // 当前悬停的排序目标 batteryId
  const [sortOverId, setSortOverId] = useState<string | null>(null)
  // 正在拖动的收藏卡片 batteryId（用于排序）
  const sortDragId = useRef<string | null>(null)

  // ── 外层面板：接收从电池栏拖入的新收藏 ──────────────────────────────────
  const handlePanelDragOver = useCallback((e: React.DragEvent) => {
    // 内部排序拖拽不触发外层高亮
    if (e.dataTransfer.types.includes('application/favorite-sort')) return
    if (e.dataTransfer.types.includes('application/battery')) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }, [])

  const handlePanelDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }, [])

  const handlePanelDrop = useCallback((e: React.DragEvent) => {
    // 内部排序的 drop 已被卡片自己消费，此处只处理新增
    if (e.dataTransfer.types.includes('application/favorite-sort')) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const batteryData = e.dataTransfer.getData('application/battery')
    if (!batteryData) return
    try {
      const battery = JSON.parse(batteryData)
      addFavoriteBattery(battery)
    } catch (err) {
      console.warn('[FavoritesPanel] Failed to parse battery data:', err)
    }
  }, [addFavoriteBattery])

  // ── 卡片拖拽：同时携带 favorite-sort（排序）和 battery（画布放置） ────────
  const handleCardDragStart = useCallback((e: React.DragEvent, fav: { batteryId: string; batteryJson: string }) => {
    e.stopPropagation()
    sortDragId.current = fav.batteryId
    e.dataTransfer.effectAllowed = 'copyMove'
    // 排序标记（值为被拖动的 batteryId）
    e.dataTransfer.setData('application/favorite-sort', fav.batteryId)
    // 同时携带 battery 数据，支持拖到画布
    e.dataTransfer.setData('application/battery', fav.batteryJson)
  }, [])

  const handleCardDragEnd = useCallback(() => {
    sortDragId.current = null
    setSortOverId(null)
  }, [])

  // 排序目标卡片的 dragOver / drop
  const handleCardDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    if (!e.dataTransfer.types.includes('application/favorite-sort')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setSortOverId(targetId)
  }, [])

  const handleCardDrop = useCallback((e: React.DragEvent, targetId: string) => {
    if (!e.dataTransfer.types.includes('application/favorite-sort')) return
    e.preventDefault()
    e.stopPropagation()
    const fromId = e.dataTransfer.getData('application/favorite-sort')
    setSortOverId(null)
    sortDragId.current = null
    if (fromId && fromId !== targetId) {
      reorderFavoriteBatteries(fromId, targetId)
    }
  }, [reorderFavoriteBatteries])

  return (
    <div
      className={`favorites-panel${isDragOver ? ' favorites-panel--drag-over' : ''}`}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
    >
      {favoriteBatteries.length === 0 ? (
        <div className="favorites-empty">
          <Star size={14} className="favorites-empty-icon" />
          <span>{langMode === 'en' ? 'Drag a node from the battery bar to add a favorite' : '从电池栏拖入节点以收藏'}</span>
        </div>
      ) : (
        <div className="favorites-grid">
          {favoriteBatteries.map((fav) => {
            let displayName = fav.name
            let iconSvg: string | undefined
            try {
              const b = JSON.parse(fav.batteryJson)
              displayName = langMode === 'zh' ? b.name : formatIdAsLabel(b.id)
              iconSvg = b.iconSvg
            } catch { /* ignore */ }
            const isSortOver = sortOverId === fav.batteryId && sortDragId.current !== fav.batteryId
            return (
              <div
                key={fav.batteryId}
                className={`favorites-card${isSortOver ? ' favorites-card--sort-over' : ''}`}
                draggable
                onDragStart={(e) => handleCardDragStart(e, fav)}
                onDragEnd={handleCardDragEnd}
                onDragOver={(e) => handleCardDragOver(e, fav.batteryId)}
                onDrop={(e) => handleCardDrop(e, fav.batteryId)}
                title={langMode === 'en' ? `${fav.name}\nDrag within panel to reorder\nDrop on canvas to place node` : `${fav.name}\n面板内拖拽可重新排序\n拖到画布以放置节点`}
              >
                <button
                  className="favorites-card-del"
                  onClick={(e) => { e.stopPropagation(); removeFavoriteBattery(fav.batteryId) }}
                  title={langMode === 'en' ? 'Remove from favorites' : '从收藏中移除'}
                >
                  <X size={9} />
                </button>
                <span className="favorites-card-icon">
                  {iconSvg
                    ? <span className="favorites-card-icon-svg" dangerouslySetInnerHTML={{ __html: iconSvg }} />
                    : '⚡'
                  }
                </span>
                <span className="favorites-card-name">{displayName}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── 主组件：带右侧拖拽调整宽度 + 菜单拖拽排序 ───────────────────────────────
interface LeftSidebarProps {
  /** Domain port types injected by the host app (scene / geometry), so the node-info
   *  port dots and the data-type legend resolve domain colours without a global. */
  domainPortTypes?: DomainPortTypes
}

function LeftSidebar({ domainPortTypes }: LeftSidebarProps = {}) {
  // 精确 selector：只在各自字段变化时重渲染，滑条拖动不触发节点未选中时的重渲染
  const selectedNode = usePipelineStore(s => s.selectedNode)
  const batteries    = usePipelineStore(s => s.batteries)
  const logs         = usePipelineStore(s => s.logs)
  const nodeOutputs  = usePipelineStore(s => s.nodeOutputs)
  const langMode     = useUIStore(s => s.langMode)

  // 可拖宽：记录当前宽度
  const [width, setWidth] = useState(220)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startW: width }
  }, [width])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const delta = e.clientX - dragRef.current.startX
      const next = Math.max(160, Math.min(480, dragRef.current.startW + delta))
      setWidth(next)
    }
    const onUp = () => { dragRef.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  // 菜单拖拽排序状态
  const [sectionOrder, setSectionOrder] = useState<string[]>(loadSectionOrder)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dragItemId = useRef<string | null>(null)

  const handleDragStart = useCallback((id: string) => (e: React.DragEvent) => {
    dragItemId.current = id
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((id: string) => (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(id)
  }, [])

  const handleDrop = useCallback((id: string) => (e: React.DragEvent) => {
    e.preventDefault()
    const from = dragItemId.current
    if (!from || from === id) { setDragOverId(null); return }
    setSectionOrder(prev => {
      const next = [...prev]
      const fromIdx = next.indexOf(from)
      const toIdx = next.indexOf(id)
      if (fromIdx === -1 || toIdx === -1) return prev
      next.splice(fromIdx, 1)
      next.splice(toIdx, 0, from)
      saveSectionOrder(next)
      return next
    })
    dragItemId.current = null
    setDragOverId(null)
  }, [])

  const handleDragEnd = useCallback(() => {
    dragItemId.current = null
    setDragOverId(null)
  }, [])

  const battery = selectedNode
    ? (batteries.find(b => b.id === selectedNode.batteryId) ?? null)
    : null

  const renderSection = (id: string) => {
    const config = SECTION_CONFIGS.find(s => s.id === id)
    if (!config) return null
    return (
      <CollapsibleSection
        key={id}
        title={langMode === 'en' ? config.titleEn : config.title}
        storageKey={id}
        defaultOpen={config.defaultOpen}
        extraClass={id === 'favorites' ? 'collapsible-section--favorites' : undefined}
        isDragOver={dragOverId === id}
        onDragStart={handleDragStart(id)}
        onDragOver={handleDragOver(id)}
        onDrop={handleDrop(id)}
        onDragEnd={handleDragEnd}
      >
        {id === 'nodeinfo'    && <NodeInfoPanel node={selectedNode} battery={battery} nodeOutputs={nodeOutputs} domainPortTypes={domainPortTypes} />}
        {id === 'favorites'   && <FavoritesPanel />}
        {id === 'history'     && <HistoryPanel />}
        {id === 'textpresets' && <TextPresetsPanel />}
        {id === 'datatypes'   && <DataTypesPanel domainPortTypes={domainPortTypes} />}
        {id === 'logs'        && <LogsPanel logs={logs} />}
        {id === 'help'        && <HelpPanel />}
      </CollapsibleSection>
    )
  }

  return (
    <div className="left-sidebar" style={{ width, minWidth: width }}>
      <div className="left-sidebar-scroll">
        {sectionOrder.map(renderSection)}
      </div>

      {/* 右侧拖拽调整宽度的把手，始终贴右侧全高显示 */}
      <div className="sidebar-resize-handle" onMouseDown={onResizeStart} />
    </div>
  )
}

export default LeftSidebar
