// NumberSlider special node, in Number Slider style.
// Interaction: drag the track to change value | double-click to type a value |
// right-click to edit range and precision.
// When wired, the left name cell shows the downstream port name (single link =
// port name, multi = port name xN).
// Ported from the legacy editor (components/canvas/NumberSliderNode.tsx).
import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { Handle, Position, type NodeProps } from 'reactflow'
import { usePipelineStore, useUIStore, useHistoryStore } from '../../stores/index.js'
import { getPortTypeColor } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import CustomSelect from './CustomSelect.js'
import {
  TooltipPortal,
  useNodeValueFormatters,
  useNodeTooltip,
  type BatteryTooltipState,
} from './nodeTooltip.js'
import type { Battery } from '../../types.js'
import './NumberSliderNode.css'

const PRECISION_OPTIONS = [
  { value: 0, label: 'Integer (0)' },
  { value: 1, label: '0.0' },
  { value: 2, label: '0.00' },
  { value: 3, label: '0.000' },
  { value: 4, label: '0.0000' },
]

interface NumberSliderNodeData {
  battery: Battery
  params: Record<string, unknown>
}

function NumberSliderNode({ id, data, selected, dragging }: NodeProps<NumberSliderNodeData>) {
  const { params } = data

  const [value, setValue] = useState(typeof params.value === 'number' ? params.value : 0)
  const [min, setMin] = useState(typeof params.min === 'number' ? params.min : 0)
  const [max, setMax] = useState(typeof params.max === 'number' ? params.max : 100)
  const [precision, setPrecision] = useState(typeof params.precision === 'number' ? params.precision : 0)

  // Double-click edit mode.
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  // Context-menu state.
  const [showCtxMenu, setShowCtxMenu] = useState(false)
  const [ctxMenuPos, setCtxMenuPos] = useState({ x: 0, y: 0 })
  const [ctxMin, setCtxMin] = useState('')
  const [ctxMax, setCtxMax] = useState('')
  const [ctxPrecision, setCtxPrecision] = useState(0)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const edges     = usePipelineStore(s => s.currentPipeline?.edges ?? [])
  const pipeNodes = usePipelineStore(s => s.currentPipeline?.nodes ?? [])
  const batteries = usePipelineStore(s => s.batteries)
  const langMode = useUIStore(s => s.langMode)
  const favoriteBatteries = useUIStore(s => s.favoriteBatteries)
  const addFavoriteBattery = useUIStore(s => s.addFavoriteBattery)
  const removeFavoriteBattery = useUIStore(s => s.removeFavoriteBattery)
  const { tooltip, showImmediate, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()

  // Round a value to the given precision.
  const roundTo = useCallback((v: number, p: number) => {
    const factor = Math.pow(10, p)
    return Math.round(v * factor) / factor
  }, [])

  const commit = useCallback((v: number, p: number = precision, lo: number = min, hi: number = max) => {
    const clamped = Math.min(hi, Math.max(lo, roundTo(v, p)))
    setValue(clamped)
    updateNodeParam(id, 'value', clamped)
  }, [id, min, max, precision, roundTo, updateNodeParam])

  // ===== Track drag (Pointer Events, no HTML range input) =====
  const trackRef = useRef<HTMLDivElement>(null)

  // batteryNameRef: read the latest node name inside the pointerup closure
  // (avoid capturing the name variable from the initial render).
  const batteryNameRef = useRef(data.battery?.name ?? id)
  batteryNameRef.current = data.battery?.name ?? id

  const handleTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isEditing) return
    e.preventDefault()
    e.stopPropagation()

    const { currentPipeline } = usePipelineStore.getState()
    if (currentPipeline) {
      useHistoryStore.getState().record('change_param', currentPipeline, {
        nodeIds: [id],
        label: `Change parameter: ${batteryNameRef.current}`,
        labelEn: `Change parameter: ${batteryNameRef.current}`,
      })
    }

    const track = e.currentTarget
    const update = (clientX: number) => {
      const rect = track.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const next = min + pct * (max - min)
      commit(next)
    }
    update(e.clientX)
    const onMove = (ev: PointerEvent) => {
      update(ev.clientX)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [isEditing, min, max, commit, id, value])

  // ===== Double-click to enter edit mode =====
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const { currentPipeline } = usePipelineStore.getState()
    if (currentPipeline) {
      useHistoryStore.getState().record('change_param', currentPipeline, {
        nodeIds: [id],
        label: `Change parameter: ${data.battery?.nameEn ?? data.battery?.id ?? id}`,
        labelEn: `Change parameter: ${data.battery?.nameEn ?? data.battery?.id ?? id}`,
      })
    }
    setEditText(String(value))
    setIsEditing(true)
  }, [value, id, data.battery?.nameEn, data.battery?.id])

  useEffect(() => {
    if (isEditing) {
      editInputRef.current?.select()
    }
  }, [isEditing])

  const commitEdit = useCallback(() => {
    const parsed = parseFloat(editText)
    if (!isNaN(parsed)) {
      commit(parsed)
    }
    setIsEditing(false)
  }, [editText, commit])

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') commitEdit()
    else if (e.key === 'Escape') setIsEditing(false)
  }, [commitEdit])

  // ===== Context menu =====
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMin(String(min))
    setCtxMax(String(max))
    setCtxPrecision(precision)
    setCtxMenuPos({ x: e.clientX, y: e.clientY })
    setShowCtxMenu(true)
  }, [min, max, precision])

  const applyCtxMenu = useCallback(() => {
    const newMin = parseFloat(ctxMin)
    const newMax = parseFloat(ctxMax)
    const validRange = !isNaN(newMin) && !isNaN(newMax) && newMin < newMax
    const ctxLabel = `Adjust parameters: ${data.battery?.nameEn ?? data.battery?.id ?? id} range/precision`
    const { currentPipeline } = usePipelineStore.getState()
    if (currentPipeline) {
      useHistoryStore.getState().record('change_param', currentPipeline, {
        nodeIds: [id],
        label: ctxLabel,
        labelEn: `Change parameter: ${data.battery?.name ?? id} range/precision`,
      })
    }
    if (validRange) {
      setMin(newMin)
      setMax(newMax)
      updateNodeParam(id, 'min', newMin)
      updateNodeParam(id, 'max', newMax)
      commit(value, ctxPrecision, newMin, newMax)
    } else {
      commit(value, ctxPrecision)
    }
    setPrecision(ctxPrecision)
    updateNodeParam(id, 'precision', ctxPrecision)
    setShowCtxMenu(false)
  }, [ctxMin, ctxMax, ctxPrecision, id, value, commit, updateNodeParam, data.battery])

  // Close the context menu on outside click.
  useEffect(() => {
    if (!showCtxMenu) return
    const onOutside = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setShowCtxMenu(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [showCtxMenu])

  const fillPct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0
  const displayValue = precision === 0
    ? String(Math.round(value))
    : value.toFixed(precision)

  // Simplify the bound display (avoid overly long numbers).
  const fmtBound = (n: number) =>
    Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(3)).toString()

  const outputColor = getPortTypeColor('number')
  const isFavorite = favoriteBatteries.some(f => f.batteryId === data.battery.id)

  const handleFavoriteToggle = useCallback(() => {
    if (isFavorite) removeFavoriteBattery(data.battery.id)
    else addFavoriteBattery(data.battery)
    setShowCtxMenu(false)
  }, [isFavorite, data.battery, addFavoriteBattery, removeFavoriteBattery])

  // When wired, show the downstream port name (single link = port name, multi = port name xN).
  const downstreamLabel = useMemo(() => {
    const outEdges = edges.filter(e => e.source.nodeId === id)
    if (outEdges.length === 0) return null
    if (outEdges.length === 1) {
      const e = outEdges[0]
      const targetNode = pipeNodes.find(n => n.id === e.target.nodeId)
      if (!targetNode) return null
      const targetBattery = batteries.find(b => b.id === targetNode.batteryId)
      if (!targetBattery) return null
      const inputPort = targetBattery.inputs?.find(p => p.name === e.target.port)
      if (!inputPort) return null
      return langMode === 'zh' ? (inputPort.label || inputPort.name) : inputPort.name
    }
    // Multi-link: show a default name + xN to avoid ambiguity from a single port name.
    const defaultName = langMode === 'zh'
      ? (data.battery?.name || '数值')
      : (data.battery?.nameEn || formatIdAsLabel(data.battery?.id || 'number_const'))
    return `${defaultName} x${outEdges.length}`
  }, [edges, pipeNodes, batteries, id, langMode])

  const name = downstreamLabel ?? (langMode === 'zh'
    ? (data.battery?.name || '数值')
    : (data.battery?.nameEn || formatIdAsLabel(data.battery?.id || 'number_const')))

  const showOutputPortTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const outputVal = usePipelineStore.getState().nodeOutputs[id]?.value
    const valueLine = outputVal !== undefined
      ? { label: 'output:', text: formatPortValue(outputVal), extra: formatPortValueExtra(outputVal) }
      : { label: 'value:', text: formatPortValue(value), extra: formatPortValueExtra(value) }
    const out = data.battery.outputs[0]
    const portDesc = out ? (langMode === 'zh' ? out.description : (out.descriptionEn || out.description)) : undefined
    showImmediate({
      x: e.clientX + 16, y: e.clientY - 8,
      title: langMode === 'zh' ? (out?.label ?? 'value') : (out?.name ?? 'value'),
      subtitle: 'Number', subtitleColor: outputColor,
      description: portDesc,
      valueLine,
    })
  }, [id, value, langMode, outputColor, data.battery, showImmediate])

  const showBatteryTooltip = useCallback(() => {
    const batteryDesc = langMode === 'zh'
      ? data.battery.description
      : (data.battery.descriptionEn || data.battery.description)
    showDelayed({
      title: langMode === 'zh' ? data.battery.name : (data.battery.nameEn || formatIdAsLabel(data.battery.id)),
      subtitle: data.battery.version ? `v${data.battery.version}` : undefined,
      tagLine: getBatteryTagLine(data.battery.type, data.battery.category ?? 'special'),
      tagLineColor: getBatteryTypeColor(data.battery.type),
      description: batteryDesc,
    } satisfies BatteryTooltipState)
  }, [data.battery, langMode, showDelayed])

  return (
    <div
      className={`ns-node${selected ? ' selected' : ''}`}
      onContextMenu={handleContextMenu}
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
    >
      {/* Left: name cell. */}
      <div className="ns-name-cell">
        <span className="ns-name">{name}</span>
      </div>

      {/* Right: slider area. */}
      <div className="ns-slider-cell">
        {/* Primary interaction: the track, or an input field. */}
        {isEditing ? (
          <input
            ref={editInputRef}
            className="ns-edit-input nodrag nowheel"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={commitEdit}
          />
        ) : (
          <div
            ref={trackRef}
            className="ns-track nodrag"
            onPointerDown={handleTrackPointerDown}
            onDoubleClick={handleDoubleClick}
          >
            {/* Fill region. */}
            <div className="ns-fill" style={{ width: `${fillPct}%` }} />
            {/* Drag grip (small vertical line, node-editor style). */}
            <div className="ns-grip" style={{ left: `${fillPct}%` }} />
            {/* Current value text. */}
            <span className="ns-val">{displayValue}</span>
          </div>
        )}

        {/* Min / max range annotations. */}
        <div className="ns-bounds">
          <span className="ns-bound">{fmtBound(min)}</span>
          <span className="ns-bound">{fmtBound(max)}</span>
        </div>
      </div>

      {/* Context menu: edit range + precision (portal to document.body so it is not
          occluded by other nodes). */}
      {showCtxMenu && ReactDOM.createPortal(
        <div
          ref={ctxMenuRef}
          className="ns-ctx-menu"
          style={{ left: ctxMenuPos.x, top: ctxMenuPos.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="ns-ctx-title">Slider Settings</div>

          <button type="button" className="ns-ctx-favorite" onClick={handleFavoriteToggle}>
            {isFavorite ? '⭐ Remove from Favorites' : '⭐ Add to Favorites'}
          </button>

          <div className="ns-ctx-row">
            <label className="ns-ctx-label">Min</label>
            <input
              className="ns-ctx-input"
              type="number"
              value={ctxMin}
              onChange={e => setCtxMin(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
            />
          </div>

          <div className="ns-ctx-row">
            <label className="ns-ctx-label">Max</label>
            <input
              className="ns-ctx-input"
              type="number"
              value={ctxMax}
              onChange={e => setCtxMax(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
            />
          </div>

          <div className="ns-ctx-row">
            <label className="ns-ctx-label">Precision</label>
            <CustomSelect
              className="ns-select"
              value={ctxPrecision}
              onChange={v => setCtxPrecision(Number(v))}
              options={PRECISION_OPTIONS}
            />
          </div>

          <div className="ns-ctx-actions">
            <button className="ns-ctx-btn ns-ctx-btn--apply" onClick={applyCtxMenu}>Apply</button>
            <button className="ns-ctx-btn" onClick={() => setShowCtxMenu(false)}>Cancel</button>
          </div>
        </div>,
        document.body
      )}

      {/* Output port: events bound directly on the Handle to avoid a wrapper
          breaking ReactFlow positioning. */}
      <Handle
        type="source"
        position={Position.Right}
        id="value"
        style={{
          background: outputColor,
          border: `2px solid ${outputColor}`,
          width: 10,
          height: 10,
        }}
        onMouseEnter={showOutputPortTooltip}
        onMouseLeave={hide}
      />

      {tooltip && <TooltipPortal tooltip={tooltip} />}
    </div>
  )
}

export default memo(NumberSliderNode)
