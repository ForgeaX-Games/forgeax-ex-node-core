// 💡 电池选择栏（竖向版）：
//   ─ 大标签（左侧 rail，点击跳转到右侧对应分组）
//   ─ 小标签（手风琴二级，多个可同时展开 / 收起；点 + 号可展开覆盖层平铺全部电池）
//   ─ 电池条目（叶子）：图标 + 名称单行列表
// 整列纵向滚动；右侧 4px 把手可拖拽调整电池栏宽度（localStorage 持久化）
// 横向滚动相关旧逻辑（attachBatteryBarHScrollWheel / hScroll smooth refs / cards-scroll-map / tabs-scroll-left）已整体移除。
//
// Develop / Templates 共用同一套竖向手风琴；Templates 大标签=父分类、小标签=模板子目录。
// 右键菜单 / 星标 / 开发记录角标 / Tooltip / 拖拽到画布 等核心交互全部保留。
//
// 忠实移植说明（faithful port）：模板分类目录列表原由 app 级 apiService.getTemplateCategories()
// 拉取，属多项目 chrome，已在通用编辑器中剥离；templateCategories 保留为空数组，
// templates 渲染分支因此仅由通用电池数据驱动（batteryFilterMode 默认恒为 'develop'）。
import { useState, useMemo, useRef, useLayoutEffect, useEffect, memo, useCallback } from 'react'
import { usePipelineStore } from '../../stores/index.js'
import { useUIStore } from '../../stores/index.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import type { Battery } from '../../types.js'
import { useNodeTooltip, TooltipPortal } from '../canvas/nodeTooltip.js'
import type { BatteryTooltipState } from '../canvas/nodeTooltip.js'
import DevNoteModal from './DevNoteModal.js'
import { getEditorTransport } from '../../transport/index.js'
import './BatteryBar.css'
import {
  BATTERY_BAR_WIDTH_MIN,
  BATTERY_BAR_WIDTH_MAX,
  readBatteryBarWidth,
  writeBatteryBarWidth,
  readActiveBigLabels,
  writeActiveBigLabels,
  readOpenSmallMap,
  writeOpenSmallMap,
  readVScrollMap,
  writeVScrollSlot,
  vScrollKey,
  smallGroupKey,
  parseSmallGroupKey,
} from './batteryBarStorage.js'
import {
  type CatalogBattery,
  isTemplateBattery,
  getBigLabel,
  getTemplateSubfolder,
  getSmallLabel,
  formatBigLabel,
  formatBigLabelRailText,
  formatBigLabelRailRest,
  formatSmallLabel,
  applyOrder,
  sortSmallLabels,
  sortBatteriesInGroup,
} from './batteryGrouping.js'

const readWidth = readBatteryBarWidth
const writeWidth = writeBatteryBarWidth

// ── 电池条目（单行列表）：图标 + 名称 + 星标/记录角标 ────────────────────────
interface BatteryRowProps {
  battery: Battery
  langMode: string
  stars: number
  devNoteCount: number
  showDevNoteCount: boolean
  onDragStart: (e: React.DragEvent, battery: Battery) => void
  onContextMenu: (e: React.MouseEvent, battery: Battery) => void
}

const BatteryRow = memo(function BatteryRow({
  battery,
  langMode,
  stars,
  devNoteCount,
  showDevNoteCount,
  onDragStart,
  onContextMenu,
}: BatteryRowProps) {
  const { tooltip, showDelayed, hide, trackMouse } = useNodeTooltip(800)

  const displayName = langMode === 'zh' ? battery.name : (battery.nameEn || formatIdAsLabel(battery.id))
  const displayDesc = langMode === 'zh'
    ? (battery.description || battery.name)
    : (battery.descriptionEn || battery.description || displayName)

  const handleMouseEnter = useCallback(() => {
    showDelayed({
      title: displayName,
      subtitle: battery.version ? `v${battery.version}` : undefined,
      tagLine: getBatteryTagLine(battery.type, battery.category),
      tagLineColor: getBatteryTypeColor(battery.type),
      description: displayDesc,
    } satisfies BatteryTooltipState)
  }, [battery, displayName, displayDesc, showDelayed])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, battery)
  }, [battery, onContextMenu])

  // 名称右侧 meta（星 + 角标）：只有星 > 0 或开启角标才渲染，避免空列占位
  const showStars = stars > 0
  const showCount = showDevNoteCount && devNoteCount > 0
  const hasMeta = showStars || showCount
  const cappedStars = Math.min(stars, 9)   // 行内宽度有限，最多显示 9 颗

  return (
    <div
      className="battery-row"
      draggable
      onDragStart={e => onDragStart(e, battery)}
      onMouseEnter={handleMouseEnter}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
      onContextMenu={handleContextMenu}
    >
      <span className="battery-row-icon">
        {battery.iconSvg
          ? <span className="battery-row-icon-svg" dangerouslySetInnerHTML={{ __html: battery.iconSvg }} />
          : <span className="battery-row-icon-fallback">⚡</span>
        }
      </span>
      <span className="battery-row-name">{displayName}</span>
      {hasMeta && (
        <span className="battery-row-meta">
          {showStars && <span className="battery-row-stars">{'★'.repeat(cappedStars)}</span>}
          {showCount && <span className="battery-row-note-count">{devNoteCount}</span>}
        </span>
      )}
      {tooltip && <TooltipPortal tooltip={tooltip} />}
    </div>
  )
})

interface ContextMenuState {
  x: number
  y: number
  battery: Battery
}

interface DevNoteTarget {
  id: string
  name: string
}

function BatteryBar() {
  const { batteries, categories, batteryOrder, saveBatteryOrder } = usePipelineStore()
  const langMode = useUIStore((s) => s.langMode)
  const batteryStars = useUIStore((s) => s.batteryStars)
  const batteryDevNotes = useUIStore((s) => s.batteryDevNotes)
  const showDevNoteCount = useUIStore((s) => s.showDevNoteCount)
  const adjustBatteryStars = useUIStore((s) => s.adjustBatteryStars)
  const favoriteBatteries = useUIStore((s) => s.favoriteBatteries)
  const addFavoriteBattery = useUIStore((s) => s.addFavoriteBattery)
  const removeFavoriteBattery = useUIStore((s) => s.removeFavoriteBattery)
  // 多项目：当前激活项目类型（用于按 projectTypes 过滤）
  const activeProjectType = useUIStore((s) => s.activeProjectType)
  // Develop / Templates 切换（切换按钮在 Toolbar，此处只读取模式驱动渲染分支）
  const batteryFilterMode = useUIStore((s) => s.batteryFilterMode)
  // searchQuery 当前由画布双击搜索浮层（CanvasSearchPopover）驱动，BatteryBar 内部不再有写入入口；
  // 这里仍订阅状态用于显示搜索结果计数 / 切换扁平搜索视图。setter 暂未使用但保留预留接口。
  const [searchQuery, setSearchQuery] = useState('')
  void setSearchQuery
  const [focusedBigLabel, setFocusedBigLabel] = useState<string | null>(() => readActiveBigLabels()[0] ?? null)
  // 小标签展开集合：按当前激活大标签维度独立存储
  const [, setOpenSmallLabels] = useState<Record<string, string[]>>(readOpenSmallMap)
  const [templateCategories, setTemplateCategories] = useState<string[]>([])

  useEffect(() => {
    if (batteryFilterMode !== 'templates') return
    void getEditorTransport().api.listTemplateCategories()
      .then((cats) => setTemplateCategories([...cats]))
      .catch(() => setTemplateCategories([]))
  }, [batteryFilterMode])

  // ── 右键菜单状态 ────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // ── 开发记录弹窗状态（多实例：同一电池只保留一个）
  const [devNoteTargets, setDevNoteTargets] = useState<DevNoteTarget[]>([])

  // ── 大标签拖拽排序状态 ──────────────────────────────────────────────────
  const [dragBigLabel, setDragBigLabel] = useState<string | null>(null)
  const [dragOverBigLabel, setDragOverBigLabel] = useState<string | null>(null)
  const [isRailExpanded, setIsRailExpanded] = useState(false)
  const [isRailExpansionSuppressed, setIsRailExpansionSuppressed] = useState(false)

  // ── 小标签拖拽排序状态 ──────────────────────────────────────────────────
  const [dragSmallLabel, setDragSmallLabel] = useState<string | null>(null)
  const [dragOverSmallLabel, setDragOverSmallLabel] = useState<string | null>(null)

  // ── 小标签展开覆盖层（+ 号点开后，绝对定位的多列网格平铺该小标签全部电池） ─
  const [expandedSmallLabel, setExpandedSmallLabel] = useState<string | null>(null)
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties | null>(null)

  // ── DOM refs ────────────────────────────────────────────────────────────
  const scrollerRef = useRef<HTMLDivElement>(null)         // 整体纵向滚动容器
  const smallHeaderRefs = useRef<Record<string, HTMLDivElement | null>>({})  // 每个小标签头部 DOM（用于覆盖层定位）
  const bigSectionRefs = useRef<Record<string, HTMLDivElement | null>>({})    // 每个大标签内容分组 DOM（用于 rail 跳转）
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedBigLabelRef = useRef<string | null>(focusedBigLabel)
  const bigLabelsRef = useRef<string[]>([])

  useEffect(() => {
    focusedBigLabelRef.current = focusedBigLabel
  }, [focusedBigLabel])

  // ── 宽度拖拽 ─────────────────────────────────────────────────────────────
  const [width, setWidth] = useState<number>(readWidth)
  const widthRef = useRef<number>(width)
  useEffect(() => { widthRef.current = width }, [width])

  const onResizeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthRef.current
    document.body.classList.add('bb-resizing')
    const onMove = (m: MouseEvent) => {
      const next = Math.max(BATTERY_BAR_WIDTH_MIN, Math.min(BATTERY_BAR_WIDTH_MAX, startW + (m.clientX - startX)))
      setWidth(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('bb-resizing')
      writeWidth(widthRef.current)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  // ── 纵向滚动持久化 ──────────────────────────────────────────────────────
  const scrollKey = useMemo(
    () => vScrollKey(searchQuery),
    [searchQuery]
  )

  // 切换大标签 / 搜索语境时恢复滚动位置（双 rAF 确保 DOM 已渲染）
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const map = readVScrollMap()
    const saved = map[scrollKey] ?? 0
    const apply = () => {
      const s = scrollerRef.current
      if (!s) return
      const max = Math.max(0, s.scrollHeight - s.clientHeight)
      s.scrollTop = Math.min(Math.max(0, saved), max)
    }
    requestAnimationFrame(() => requestAnimationFrame(apply))
  }, [scrollKey])

  const syncFocusedBigLabelFromScroll = useCallback(() => {
    const labels = bigLabelsRef.current
    if (searchQuery || labels.length === 0) return
    const scroller = scrollerRef.current
    if (!scroller) return

    // 右侧列表按大标签 section 顺序渲染；滚动顶部进入哪个 section，左侧 rail 就高亮哪个大标签。
    const markerTop = scroller.scrollTop + 4
    let nextFocused = labels[0] ?? null
    for (const label of labels) {
      const section = bigSectionRefs.current[label]
      if (!section) continue
      if (section.offsetTop <= markerTop) nextFocused = label
      else break
    }

    if (nextFocused && focusedBigLabelRef.current !== nextFocused) {
      focusedBigLabelRef.current = nextFocused
      setFocusedBigLabel(nextFocused)
      writeActiveBigLabels([nextFocused])
    }
  }, [searchQuery])

  const persistScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    syncFocusedBigLabelFromScroll()
    if (scrollSaveTimerRef.current != null) clearTimeout(scrollSaveTimerRef.current)
    scrollSaveTimerRef.current = setTimeout(() => {
      scrollSaveTimerRef.current = null
      const s = scrollerRef.current
      if (s) writeVScrollSlot(scrollKey, s.scrollTop)
    }, 120)
  }, [scrollKey, syncFocusedBigLabelFromScroll])

  useEffect(() => () => {
    if (scrollSaveTimerRef.current != null) clearTimeout(scrollSaveTimerRef.current)
  }, [])

  // ── 小标签展开覆盖层定位（点 + 号后从该小标签头下方展开到容器底部） ────
  useLayoutEffect(() => {
    if (!expandedSmallLabel || !scrollerRef.current) {
      setOverlayStyle(null)
      return
    }
    const scroller = scrollerRef.current
    const headerEl = smallHeaderRefs.current[expandedSmallLabel]
    if (!headerEl) {
      setOverlayStyle(null)
      return
    }
    // 用 getBoundingClientRect 差值取 header 底部位置（避坑 2026-03-17：不要 offsetTop+gap 累加）
    const calc = () => {
      const sRect = scroller.getBoundingClientRect()
      const hRect = headerEl.getBoundingClientRect()
      const top = hRect.bottom - sRect.top + scroller.scrollTop
      setOverlayStyle({
        position: 'absolute',
        left: 0,
        right: 0,
        top,
        bottom: 0,
      })
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [expandedSmallLabel])

  const resolveSmallLabel = useCallback((b: Battery) => {
    return batteryFilterMode === 'templates' ? getTemplateSubfolder(b) : getSmallLabel(b)
  }, [batteryFilterMode])

  // ── 派生：大标签列表（原始） ─────────────────────────────────────────────
  const rawBigLabels = useMemo(() => {
    if (batteryFilterMode === 'templates') {
      const templateBatteries = batteries.filter(b => isTemplateBattery(b))
      const tags = new Set<string>([
        ...templateCategories,
        ...templateBatteries.map(b => b.category || getBigLabel(b)),
      ])
      return [...tags].sort()
    }

    const tsTags: string[] = []
    const otherTags: string[] = []
    const seenTs = new Set<string>()
    const seenOther = new Set<string>()

    const matchesProjectType = (b: Battery): boolean => {
      if (!activeProjectType) return true
      const types = (b as CatalogBattery).projectTypes
      if (!types || types.length === 0) return true
      if (types.includes('both')) return true
      return types.includes(activeProjectType)
    }

    if (categories.length > 0) {
      const visibleBigTags = new Set(
        batteries.filter(b => b.type === 'ts' && matchesProjectType(b))
          .map(b => getBigLabel(b))
      )
      categories.forEach(c => {
        if (c.type !== 'ts') return
        if (!visibleBigTags.has(c.bigTag)) return
        if (seenTs.has(c.bigTag)) return
        seenTs.add(c.bigTag)
        tsTags.push(c.bigTag)
      })
    } else {
      batteries.filter(b => b.type === 'ts' && matchesProjectType(b)).forEach(b => {
        const label = getBigLabel(b)
        if (seenTs.has(label)) return
        seenTs.add(label)
        tsTags.push(label)
      })
    }

    batteries.forEach(b => {
      if (b.type === 'ts') return
      if (isTemplateBattery(b)) return
      if (!matchesProjectType(b)) return
      const label = getBigLabel(b)
      if (seenOther.has(label)) return
      seenOther.add(label)
      otherTags.push(label)
    })

    return [...tsTags.sort(), ...otherTags.sort()]
  }, [batteries, categories, activeProjectType, batteryFilterMode, templateCategories])

  // 应用持久化排序后的大标签列表（用于渲染）
  const bigLabels = useMemo(
    () => applyOrder(batteryOrder.bigLabels, rawBigLabels),
    [rawBigLabels, batteryOrder.bigLabels]
  )

  useEffect(() => {
    bigLabelsRef.current = bigLabels
  }, [bigLabels])

  const fuzzyMatch = (b: Battery, query: string): boolean => {
    if (!query.trim()) return true
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const fields = [
      b.id,
      b.name,
      b.description ?? '',
      b.category,
      ...(b.tags ?? []),
      ...(b.tagLabels ?? []),
    ].map(f => f.toLowerCase())
    return tokens.every(token => fields.some(field => field.includes(token)))
  }

  const matchesProjectType = useCallback((b: Battery): boolean => {
    if (!activeProjectType) return true
    const types = (b as CatalogBattery).projectTypes
    if (!types || types.length === 0) return true
    if (types.includes('both')) return true
    return types.includes(activeProjectType)
  }, [activeProjectType])

  const visibleBatteries = useMemo(() => {
    let result = batteries
    if (batteryFilterMode === 'templates') {
      result = result.filter(b => isTemplateBattery(b))
    } else {
      result = result.filter(b => !isTemplateBattery(b))
    }
    return result.filter(matchesProjectType)
  }, [batteries, batteryFilterMode, matchesProjectType])

  const searchBatteries = useMemo(
    () => visibleBatteries.filter(b => fuzzyMatch(b, searchQuery)),
    [visibleBatteries, searchQuery]
  )

  const searchResultCount = useMemo(() => {
    if (!searchQuery) return 0
    return searchBatteries.length
  }, [searchBatteries, searchQuery])

  const getRawSmallLabelsForBig = useCallback((bigLabel: string): string[] => {
    if (batteryFilterMode === 'templates') {
      const seen = new Set<string>()
      const result: string[] = []
      visibleBatteries
        .filter(b => isTemplateBattery(b) && b.category === bigLabel)
        .forEach(b => {
          const small = getTemplateSubfolder(b)
          if (seen.has(small)) return
          seen.add(small)
          result.push(small)
        })
      return result.sort()
    }

    const catEntry = categories.find(c => c.bigTag === bigLabel)
    if (catEntry) return [...catEntry.smallTags].sort()
    const seen = new Set<string>()
    const result: string[] = []
    visibleBatteries
      .filter(b => getBigLabel(b) === bigLabel)
      .forEach(b => {
        const small = getSmallLabel(b)
        if (seen.has(small)) return
        seen.add(small)
        result.push(small)
      })
    return result.sort()
  }, [batteryFilterMode, categories, visibleBatteries])

  const groupBatteriesBySmall = useCallback((items: Battery[], bigLabel: string | null): Record<string, Battery[]> => {
    const groups: Record<string, Battery[]> = {}
    items.forEach(b => {
      const small = resolveSmallLabel(b)
      if (!groups[small]) groups[small] = []
      groups[small].push(b)
    })
    for (const [small, groupItems] of Object.entries(groups)) {
      groups[small] = sortBatteriesInGroup(groupItems, bigLabel, small)
    }
    return groups
  }, [resolveSmallLabel])

  const getBatteriesForBig = useCallback((bigLabel: string): Battery[] => {
    return visibleBatteries.filter(b => {
      const big = batteryFilterMode === 'templates'
        ? (b.category || getBigLabel(b))
        : getBigLabel(b)
      return big === bigLabel
    })
  }, [batteryFilterMode, visibleBatteries])

  const getSmallLabelsToRender = useCallback((bigLabel: string, groupedBySmall: Record<string, Battery[]>): string[] => {
    const rawSmallLabels = getRawSmallLabelsForBig(bigLabel)
    const allSmall = new Set([...rawSmallLabels, ...Object.keys(groupedBySmall)])
    const sorted = sortSmallLabels([...allSmall], bigLabel)
    return applyOrder(batteryOrder.smallLabels[bigLabel] ?? [], sorted)
  }, [batteryOrder.smallLabels, getRawSmallLabelsForBig])

  const searchGroupedBySmall = useMemo(
    () => groupBatteriesBySmall(searchBatteries, null),
    [groupBatteriesBySmall, searchBatteries]
  )

  const searchSmallLabelsToRender = useMemo(
    () => sortSmallLabels(Object.keys(searchGroupedBySmall), null),
    [searchGroupedBySmall]
  )

  const expandedOverlayItems = useMemo(() => {
    if (!expandedSmallLabel) return []
    const parsed = parseSmallGroupKey(expandedSmallLabel)
    if (!parsed) return []
    if (parsed.bigLabel === '__search__') return searchGroupedBySmall[parsed.smallLabel] ?? []
    const grouped = groupBatteriesBySmall(getBatteriesForBig(parsed.bigLabel), parsed.bigLabel)
    return grouped[parsed.smallLabel] ?? []
  }, [expandedSmallLabel, getBatteriesForBig, groupBatteriesBySmall, searchGroupedBySmall])

  const toggleSmallOpen = useCallback((openKey: string, smallLabel: string) => {
    setOpenSmallLabels(prev => {
      const cur = new Set(prev[openKey] ?? [])
      if (cur.has(smallLabel)) cur.delete(smallLabel)
      else cur.add(smallLabel)
      const next = { ...prev, [openKey]: [...cur] }
      writeOpenSmallMap(next)
      return next
    })
    // 切换某个小标签的开合时，若它正处于覆盖层展开态，则一并收起覆盖层
    setExpandedSmallLabel(prev => (prev === smallGroupKey(openKey, smallLabel) ? null : prev))
  }, [])

  // ── 大标签 rail 点击：始终跳转到该组最前端 ───────────────────────────────
  const handleRailBigLabelClick = (label: string) => {
    setIsRailExpanded(false)
    setIsRailExpansionSuppressed(true)
    setFocusedBigLabel(label)
    writeActiveBigLabels([label])
    setExpandedSmallLabel(null)
    requestAnimationFrame(() => {
      const s = scrollerRef.current
      const section = bigSectionRefs.current[label]
      if (!s || !section) return
      const max = Math.max(0, s.scrollHeight - s.clientHeight)
      s.scrollTop = Math.min(Math.max(0, section.offsetTop), max)
    })
  }

  const handleRailMouseEnter = () => {
    if (!isRailExpansionSuppressed) setIsRailExpanded(true)
  }

  const handleRailMouseLeave = () => {
    setIsRailExpanded(false)
    setIsRailExpansionSuppressed(false)
  }

  const handleScrollerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 点击空白处收起覆盖层
    if (e.target === e.currentTarget) setExpandedSmallLabel(null)
  }

  // ── 拖拽排序：大标签 ─────────────────────────────────────────────────────
  const handleTabDragStart = (e: React.DragEvent, label: string) => {
    e.stopPropagation()
    setDragBigLabel(label)
    e.dataTransfer.setData('application/tab-reorder', label)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleTabDragEnd = () => {
    setDragBigLabel(null)
    setDragOverBigLabel(null)
  }

  const handleTabDragOver = (e: React.DragEvent, label: string) => {
    if (!e.dataTransfer.types.includes('application/tab-reorder')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverBigLabel !== label) setDragOverBigLabel(label)
  }

  const handleTabDragLeave = () => setDragOverBigLabel(null)

  const handleTabDrop = (e: React.DragEvent, targetLabel: string) => {
    if (!e.dataTransfer.types.includes('application/tab-reorder')) return
    e.preventDefault()
    const sourceLabel = dragBigLabel
    if (!sourceLabel || sourceLabel === targetLabel) return
    const newOrder = [...bigLabels]
    const fromIdx = newOrder.indexOf(sourceLabel)
    const toIdx = newOrder.indexOf(targetLabel)
    if (fromIdx === -1 || toIdx === -1) return
    newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, sourceLabel)
    saveBatteryOrder({ bigLabels: newOrder, smallLabels: batteryOrder.smallLabels })
    setDragBigLabel(null)
    setDragOverBigLabel(null)
  }

  // ── 拖拽排序：小标签 ─────────────────────────────────────────────────────
  const handleGroupDragStart = (e: React.DragEvent, small: string) => {
    e.stopPropagation()
    setDragSmallLabel(small)
    e.dataTransfer.setData('application/group-reorder', small)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleGroupDragEnd = () => {
    setDragSmallLabel(null)
    setDragOverSmallLabel(null)
  }

  const handleGroupDragOver = (e: React.DragEvent, small: string) => {
    if (!e.dataTransfer.types.includes('application/group-reorder')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverSmallLabel !== small) setDragOverSmallLabel(small)
  }

  const handleGroupDragLeave = () => setDragOverSmallLabel(null)

  const handleGroupDrop = (e: React.DragEvent, bigLabel: string, smallLabelsInSection: string[], targetSmall: string) => {
    if (!e.dataTransfer.types.includes('application/group-reorder')) return
    e.preventDefault()
    const sourceSmall = dragSmallLabel
    if (!sourceSmall || sourceSmall === targetSmall) return
    const newOrder = [...smallLabelsInSection]
    const fromIdx = newOrder.indexOf(sourceSmall)
    const toIdx = newOrder.indexOf(targetSmall)
    if (fromIdx === -1 || toIdx === -1) return
    newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, sourceSmall)
    saveBatteryOrder({
      bigLabels: batteryOrder.bigLabels,
      smallLabels: { ...batteryOrder.smallLabels, [bigLabel]: newOrder },
    })
    setDragSmallLabel(null)
    setDragOverSmallLabel(null)
  }

  // ── 电池行：拖入画布 ─────────────────────────────────────────────────────
  // stopPropagation 防止冒泡到父级 .bb-small-section 的 onDragStart（小标签拖排），
  // 否则 handleGroupDragStart 会把 effectAllowed 覆盖为 'move'，画布 onDrop 不触发
  const handleDragStart = (e: React.DragEvent, battery: Battery) => {
    e.stopPropagation()
    e.dataTransfer.setData('application/battery', JSON.stringify(battery))
    e.dataTransfer.effectAllowed = 'copy'
  }

  // ── 右键菜单 ────────────────────────────────────────────────────────────
  const handleRowContextMenu = useCallback((e: React.MouseEvent, battery: Battery) => {
    setContextMenu({ x: e.clientX, y: e.clientY, battery })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  useEffect(() => {
    if (!contextMenu) return
    const handler = () => closeContextMenu()
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu, closeContextMenu])

  const handleContextMenuAddStar = useCallback(() => {
    if (!contextMenu) return
    adjustBatteryStars(contextMenu.battery.id, 1)
    closeContextMenu()
  }, [contextMenu, adjustBatteryStars, closeContextMenu])

  const handleContextMenuRemoveStar = useCallback(() => {
    if (!contextMenu) return
    adjustBatteryStars(contextMenu.battery.id, -1)
    closeContextMenu()
  }, [contextMenu, adjustBatteryStars, closeContextMenu])

  const handleContextMenuAddFavorite = useCallback(() => {
    if (!contextMenu) return
    addFavoriteBattery(contextMenu.battery)
    closeContextMenu()
  }, [contextMenu, addFavoriteBattery, closeContextMenu])

  const handleContextMenuRemoveFavorite = useCallback(() => {
    if (!contextMenu) return
    removeFavoriteBattery(contextMenu.battery.id)
    closeContextMenu()
  }, [contextMenu, removeFavoriteBattery, closeContextMenu])

  const contextMenuIsFavorite = contextMenu
    ? favoriteBatteries.some((f) => f.batteryId === contextMenu.battery.id)
    : false

  const handleContextMenuDevNote = useCallback(() => {
    if (!contextMenu) return
    const battery = contextMenu.battery
    const displayName = langMode === 'zh' ? battery.name : (battery.nameEn || formatIdAsLabel(battery.id))
    setDevNoteTargets(prev => {
      if (prev.some(t => t.id === battery.id)) return prev
      return [...prev, { id: battery.id, name: displayName }]
    })
    closeContextMenu()
  }, [contextMenu, langMode, closeContextMenu])

  // 渲染单个电池条目（普通列表 + 覆盖层共用）
  const renderBatteryRow = (battery: Battery) => (
    <BatteryRow
      key={battery.id}
      battery={battery}
      langMode={langMode}
      stars={batteryStars[battery.id] ?? 0}
      devNoteCount={batteryDevNotes[battery.id]?.length ?? 0}
      showDevNoteCount={showDevNoteCount}
      onDragStart={handleDragStart}
      onContextMenu={handleRowContextMenu}
    />
  )

  return (
    <aside
      className={`battery-bar battery-bar--vertical${batteryFilterMode === 'templates' ? ' mode-templates' : ''}`}
      style={{ width, minWidth: width }}
    >
      {/* 搜索结果计数（仅在搜索时显示） */}
      {searchQuery && (
        <div className="search-result-count">
          {searchResultCount > 0
            ? (langMode === 'en' ? `Found ${searchResultCount} node(s)` : `找到 ${searchResultCount} 个节点`)
            : (langMode === 'en' ? 'No matching nodes' : '未找到匹配节点')}
        </div>
      )}

      {/* ── Develop / Templates：竖向手风琴（大标签 → 小标签 → 电池行） ─── */}
      <div className="bb-body">
        {bigLabels.length > 0 && (
          <nav
            className={`bb-big-rail${isRailExpanded ? ' bb-big-rail--expanded' : ''}`}
            aria-label={langMode === 'en' ? 'Battery categories' : '电池大标签'}
            onMouseEnter={handleRailMouseEnter}
            onMouseLeave={handleRailMouseLeave}
          >
            {bigLabels.map(label => {
              const isActive = focusedBigLabel === label
              const fullLabel = formatBigLabel(label)
              const railText = formatBigLabelRailText(label)
              const railRest = formatBigLabelRailRest(label)
              return (
                <button
                  key={label}
                  type="button"
                  className={[
                    'bb-rail-button',
                    `tab-${label}`,
                    isActive ? 'active' : '',
                    dragBigLabel === label ? 'tab-dragging' : '',
                    dragOverBigLabel === label && dragBigLabel !== label ? 'tab-drag-over' : '',
                  ].filter(Boolean).join(' ')}
                  aria-label={fullLabel}
                  aria-current={isActive ? 'true' : undefined}
                  draggable
                  onDragStart={e => handleTabDragStart(e, label)}
                  onDragEnd={handleTabDragEnd}
                  onDragOver={e => handleTabDragOver(e, label)}
                  onDragLeave={handleTabDragLeave}
                  onDrop={e => handleTabDrop(e, label)}
                  onClick={() => handleRailBigLabelClick(label)}
                >
                  <span className="bb-rail-button-short">{railText}</span>
                  {railRest && <span className="bb-rail-button-rest">{railRest}</span>}
                </button>
              )
            })}
          </nav>
        )}

        <div
          className={`bb-scroller${expandedSmallLabel ? ' bb-scroller--has-overlay' : ''}`}
          ref={scrollerRef}
          onScroll={persistScroll}
          onClick={handleScrollerClick}
        >
          {bigLabels.length === 0 && (
            <div className="battery-empty">
              {batteryFilterMode === 'templates'
                ? (langMode === 'en' ? 'No templates' : '暂无模板')
                : (langMode === 'en' ? 'No batteries' : '暂无电池')}
            </div>
          )}

          {searchQuery && (
            <div className="bb-small-list">
              {searchSmallLabelsToRender.length === 0 && (
                <div className="battery-empty-small">
                  {batteryFilterMode === 'templates'
                    ? (langMode === 'en' ? 'No templates' : '暂无模板')
                    : (langMode === 'en' ? 'No batteries' : '暂无电池')}
                </div>
              )}
              {searchSmallLabelsToRender.map(smallLabel => {
                const sectionKey = '__search__'
                const groupKey = smallGroupKey(sectionKey, smallLabel)
                const items = searchGroupedBySmall[smallLabel] ?? []
                const isOpen = true
                const isExpandedOverlay = expandedSmallLabel === groupKey
                return (
                  <div
                    key={groupKey}
                    className={[
                      'bb-small-section',
                      isOpen ? 'bb-small-section--open' : '',
                      isExpandedOverlay ? 'bb-small-section--overlay' : '',
                      dragSmallLabel === smallLabel ? 'group-dragging' : '',
                      dragOverSmallLabel === smallLabel && dragSmallLabel !== smallLabel ? 'group-drag-over' : '',
                    ].filter(Boolean).join(' ')}
                    draggable
                    onDragStart={e => handleGroupDragStart(e, smallLabel)}
                    onDragEnd={handleGroupDragEnd}
                    onDragOver={e => handleGroupDragOver(e, smallLabel)}
                    onDragLeave={handleGroupDragLeave}
                    onDrop={e => handleGroupDrop(e, sectionKey, searchSmallLabelsToRender, smallLabel)}
                  >
                    <div
                      className="bb-small-header"
                      ref={el => { smallHeaderRefs.current[groupKey] = el }}
                    >
                      <button
                        className="bb-small-toggle"
                        onClick={() => toggleSmallOpen(sectionKey, smallLabel)}
                      >
                        <span className={`bb-chevron bb-chevron--sm${isOpen ? ' bb-chevron--open' : ''}`} aria-hidden>▶</span>
                        <span className="bb-small-text">
                          {batteryFilterMode === 'templates'
                            ? formatIdAsLabel(smallLabel)
                            : formatSmallLabel(smallLabel)}
                        </span>
                        <span className="bb-small-count">{items.length}</span>
                      </button>
                    </div>

                    {isOpen && !isExpandedOverlay && (
                      <div className="bb-row-list">
                        {items.length === 0 && (
                          <div className="battery-empty-small">
                            {langMode === 'en' ? 'No batteries' : '暂无电池'}
                          </div>
                        )}
                        {items.map(renderBatteryRow)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!searchQuery && bigLabels.map((bigLabel, index) => {
            const groupedBySmall = groupBatteriesBySmall(getBatteriesForBig(bigLabel), bigLabel)
            const smallLabelsToRender = getSmallLabelsToRender(bigLabel, groupedBySmall)
            return (
              <div
                key={bigLabel}
                className={`bb-big-content-section${index > 0 ? ' bb-big-content-section--separated' : ''}`}
                ref={el => { bigSectionRefs.current[bigLabel] = el }}
              >
                {smallLabelsToRender.length === 0 && (
                  <div className="battery-empty-small">
                    {batteryFilterMode === 'templates'
                      ? (langMode === 'en' ? 'No templates' : '暂无模板')
                      : (langMode === 'en' ? 'No batteries' : '暂无电池')}
                  </div>
                )}
                {smallLabelsToRender.map(smallLabel => {
                  const groupKey = smallGroupKey(bigLabel, smallLabel)
                  const items = groupedBySmall[smallLabel] ?? []
                  const isOpen = true
                  const isExpandedOverlay = expandedSmallLabel === groupKey
                  return (
                    <div
                      key={groupKey}
                      className={[
                        'bb-small-section',
                        isOpen ? 'bb-small-section--open' : '',
                        isExpandedOverlay ? 'bb-small-section--overlay' : '',
                        dragSmallLabel === smallLabel ? 'group-dragging' : '',
                        dragOverSmallLabel === smallLabel && dragSmallLabel !== smallLabel ? 'group-drag-over' : '',
                      ].filter(Boolean).join(' ')}
                      draggable
                      onDragStart={e => handleGroupDragStart(e, smallLabel)}
                      onDragEnd={handleGroupDragEnd}
                      onDragOver={e => handleGroupDragOver(e, smallLabel)}
                      onDragLeave={handleGroupDragLeave}
                      onDrop={e => handleGroupDrop(e, bigLabel, smallLabelsToRender, smallLabel)}
                    >
                      <div
                        className="bb-small-header"
                        ref={el => { smallHeaderRefs.current[groupKey] = el }}
                      >
                        <button
                          className="bb-small-toggle"
                          onClick={() => toggleSmallOpen(bigLabel, smallLabel)}
                        >
                          <span className={`bb-chevron bb-chevron--sm${isOpen ? ' bb-chevron--open' : ''}`} aria-hidden>▶</span>
                          <span className="bb-small-text">
                            {batteryFilterMode === 'templates'
                              ? formatIdAsLabel(smallLabel)
                              : formatSmallLabel(smallLabel)}
                          </span>
                          <span className="bb-small-count">{items.length}</span>
                        </button>
                      </div>

                      {isOpen && !isExpandedOverlay && (
                        <div className="bb-row-list">
                          {items.length === 0 && (
                            <div className="battery-empty-small">
                              {langMode === 'en' ? 'No batteries' : '暂无电池'}
                            </div>
                          )}
                          {items.map(renderBatteryRow)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}

          {/* 小标签 + 号展开覆盖层：从该小标签头部下方铺到容器底部，多列网格平铺该组全部电池 */}
          {expandedSmallLabel && overlayStyle && (
            <div
              className="bb-expanded-overlay"
              style={overlayStyle}
              onClick={e => e.stopPropagation()}
            >
              <div className="bb-expanded-overlay-grid">
                {expandedOverlayItems.map(renderBatteryRow)}
                {expandedOverlayItems.length === 0 && (
                  <div className="battery-empty-small">
                    {langMode === 'en' ? 'No batteries' : '暂无电池'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右侧拖拽宽度把手 */}
      <div
        className="bb-resize-handle"
        onMouseDown={onResizeMouseDown}
        title={langMode === 'en' ? 'Drag to resize' : '拖动调整宽度'}
      />

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <div
          className="battery-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="battery-context-menu-item" onClick={handleContextMenuAddStar}>
            ★ Add Star
          </div>
          <div className="battery-context-menu-item" onClick={handleContextMenuRemoveStar}>
            ☆ Remove Star
          </div>
          {contextMenuIsFavorite ? (
            <div className="battery-context-menu-item" onClick={handleContextMenuRemoveFavorite}>
              ⭐ Remove from Favorites
            </div>
          ) : (
            <div className="battery-context-menu-item" onClick={handleContextMenuAddFavorite}>
              ⭐ Add to Favorites
            </div>
          )}
          <div className="battery-context-menu-item" onClick={handleContextMenuDevNote}>
            📝 Dev Notes
          </div>
        </div>
      )}

      {/* 开发记录弹窗（多实例，每个电池独立一个，按 index 错开位置） */}
      {devNoteTargets.map((target, idx) => (
        <DevNoteModal
          key={target.id}
          batteryId={target.id}
          batteryName={target.name}
          index={idx}
          onClose={() => setDevNoteTargets(prev => prev.filter(t => t.id !== target.id))}
        />
      ))}
    </aside>
  )
}

export default BatteryBar
