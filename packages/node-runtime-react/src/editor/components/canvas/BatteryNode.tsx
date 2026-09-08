// React Flow custom battery node: the primary node renderer — a single op node
// with its title and left/right input/output ports. Ported faithfully from the
// legacy editor (components/canvas/BatteryNode.tsx), retargeted onto the editor
// stores + utils.
//
// Decoupling note: the legacy multi-value sub-layer preview state
// ("N/M closed") and the EDITOR_SUBLAYER_OPENALL WebSocket broadcast both drove
// a separate renderer iframe that does not exist in the generic editor. The
// `previewStatusInfo` computation is preserved verbatim, but `subLayerVisible`
// is sourced as an empty map (no such store field here) so the sub-layer branch
// is inert — exactly as it is when no sub-layers are reported. The primary
// preview-disabled / preview-off-indicator behaviour is identical to legacy.
import { memo, useState, useCallback, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { Handle, Position, type NodeProps } from 'reactflow'
import type { Battery, BatteryPort } from '../../types.js'
import { getPortTypeColor, normalizeType, type DomainPortTypes } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import { getPortAccess, formatDataTreeSummary, resolvePrincipalInputName } from '../../utils/datatreeShape.js'
import { usePipelineStore, useUIStore, useHistoryStore } from '../../stores/index.js'
import {
  TooltipPortal,
  useNodeValueFormatters,
  useNodeTooltip,
  resolveInputPortValue,
  type TooltipState,
  type BatteryTooltipState,
} from './nodeTooltip.js'
import './BatteryNode.css'

/** Inline options picker for a port row: an arrow button popping a portal dropdown. */
export function PortOptionsPicker({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setDropPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen((o) => !o)
  }

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return
      if (dropRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        className={`bn-port-options-btn nodrag${open ? ' bn-port-options-btn--open' : ''}`}
        onMouseDown={handleMouseDown}
        type="button"
        title={value}
      >
        <svg viewBox="0 0 10 6" width="8" height="5" aria-hidden="true">
          <path
            d="M1 1l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open &&
        ReactDOM.createPortal(
          <div
            ref={dropRef}
            className="custom-select-dropdown"
            style={{ top: dropPos.top, left: dropPos.left, minWidth: 200 }}
            role="listbox"
          >
            {options.map((opt) => (
              <div
                key={opt}
                className={`custom-select-option${opt === value ? ' custom-select-option--active' : ''}`}
                role="option"
                aria-selected={opt === value}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange(opt)
                  setOpen(false)
                }}
              >
                {opt}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

interface BatteryNodeData {
  battery: Battery
  params: Record<string, unknown>
}

function PortAccessMarker({ port, side }: { port: BatteryPort; side: 'input' | 'output' }) {
  const access = getPortAccess(port)
  if (access === 'item') return null
  return (
    <span
      className={`port-access-marker port-access-marker--${side} port-access-marker--${access}`}
      aria-hidden="true"
    />
  )
}

function buildSummaryLine(value: unknown, port: BatteryPort): string | undefined {
  const summary = formatDataTreeSummary(value)
  if (!summary) return undefined
  return `${summary} · access ${getPortAccess(port)}`
}

/** A single context-menu item. */
export interface ContextMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

export interface ContextMenuState {
  x: number
  y: number
  /** Node ids this action targets (single select = 1, multi = many). */
  nodeIds: string[]
  /** The right-clicked node's current preview state. */
  previewEnabled: boolean
  /** When true, hide the fixed preview-toggle item; show only extraItems. */
  hidePreview?: boolean
  /** Extra items appended after the preview toggle. */
  extraItems?: ContextMenuItem[]
}

/**
 * Right-click context menu, mounted to document.body (portal); closes on
 * outside click or Escape. Supports extra items.
 */
export function ContextMenuPortal({
  menu,
  onClose,
  onAction,
}: {
  menu: ContextMenuState
  onClose: () => void
  onAction: (nodeIds: string[], enabled: boolean) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const isBatch = menu.nodeIds.length > 1
  const targetEnabled = !menu.previewEnabled
  const label = menu.previewEnabled
    ? isBatch
      ? `Disable Preview (${menu.nodeIds.length} node(s))`
      : 'Disable Preview'
    : isBatch
      ? `Enable Preview (${menu.nodeIds.length} node(s))`
      : 'Enable Preview'

  return ReactDOM.createPortal(
    <div ref={menuRef} className="node-context-menu" style={{ left: menu.x, top: menu.y }}>
      {!menu.hidePreview && (
        <div
          className="node-context-menu-item"
          onMouseDown={(e) => {
            e.stopPropagation()
            onAction(menu.nodeIds, targetEnabled)
            onClose()
          }}
        >
          {label}
        </div>
      )}
      {menu.extraItems?.map((item, i) => (
        <div
          key={i}
          className={`node-context-menu-item${item.danger ? ' node-context-menu-item--danger' : ''}`}
          onMouseDown={(e) => {
            e.stopPropagation()
            item.onClick()
            onClose()
          }}
        >
          {item.label}
        </div>
      ))}
    </div>,
    document.body,
  )
}

function BatteryNode({ id, data, selected, dragging, domainPortTypes }: NodeProps<BatteryNodeData> & { domainPortTypes?: DomainPortTypes }) {
  const { battery } = data
  const { tooltip, showImmediate, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()

  // options port selected value (key = port.name; init params > default > options[0])
  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const [portSelections, setPortSelections] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const inp of battery.inputs) {
      if (inp.options?.length) {
        const stored = data.params[inp.name]
        init[inp.name] = typeof stored === 'string' ? stored : String(inp.default ?? inp.options[0] ?? '')
      }
    }
    return init
  })

  const handlePortOptionChange = useCallback(
    (portName: string, v: string) => {
      setPortSelections((prev) => ({ ...prev, [portName]: v }))
      updateNodeParam(id, portName, v)
    },
    [id, updateNodeParam],
  )

  // dynamic input ports: split inputs into fixed + dynamically generated slots
  const dynCfg = battery.dynamicInputs
  const portCount = dynCfg
    ? typeof data.params?.portCount === 'number'
      ? Math.max(dynCfg.minCount, data.params.portCount)
      : dynCfg.minCount
    : 0
  const fixedInputs = dynCfg
    ? battery.inputs.filter((inp) => !inp.name.startsWith(dynCfg.prefix))
    : battery.inputs
  const dynamicPorts: BatteryPort[] = dynCfg
    ? Array.from({ length: portCount }, (_, i) => ({
        name: `${dynCfg.prefix}${i}`,
        label: dynCfg.labelTemplate.replace('$i', String(i)),
        type: dynCfg.type,
        access: dynCfg.access,
      }))
    : []

  const principalInputName = resolvePrincipalInputName(battery)

  // dynamic output ports (symmetric split/merge with dynamicInputs)
  const dynOutCfg = battery.dynamicOutputs
  const dynOutPortsFromStore = usePipelineStore((s) =>
    dynOutCfg ? s.dynamicOutputPorts[id] : undefined,
  )
  const dynOutPortsFromParams =
    dynOutCfg && Array.isArray(data.params._dynOutPorts)
      ? (data.params._dynOutPorts as Array<{ name: string; type: string; label: string }>)
      : undefined
  const dynOutPortsResolved = dynOutPortsFromStore ?? dynOutPortsFromParams
  const isPlaceholder = dynOutCfg && !dynOutPortsResolved
  const fixedOutputs: BatteryPort[] = battery.hideOutputs ? [] : battery.outputs.filter((o) => !o.hidden)
  const dynOutPorts: BatteryPort[] = battery.hideOutputs
    ? []
    : dynOutCfg
    ? (dynOutPortsResolved ??
      Array.from({ length: dynOutCfg.minCount }, (_, i) => ({
        name: `${dynOutCfg.prefix}${i}`,
        label: dynOutCfg.labelTemplate.replace('$i', String(i)),
        type: dynOutCfg.type,
        access: dynOutCfg.access,
      })))
    : []
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const langMode = useUIStore((s) => s.langMode)
  const en = langMode === 'en'

  const previewEnabled = usePipelineStore(
    useCallback(
      (s) => s.currentPipeline?.nodes.find((n) => n.id === id)?.previewEnabled !== false,
      [id],
    ),
  )

  const setNodePreview = usePipelineStore((s) => s.setNodePreview)

  // Sub-layer visibility lives on a separate renderer frame absent from the
  // generic editor; with no such store field this resolves to an empty map and
  // the multi-value "N/M closed" branch below stays inert (legacy parity when
  // no sub-layers are reported).
  const subLayerVisible: Record<string, boolean> = {}

  const nodeOutputData = usePipelineStore(useCallback((s) => s.nodeOutputs[id], [id]))

  // detailed preview status: single grid -> "preview off", multi -> "N/M closed"
  const previewStatusInfo = (() => {
    if (!previewEnabled) {
      return { status: 'disabled', label: en ? 'Preview Off' : '预览关闭', allClosed: true }
    }
    if (!nodeOutputData) {
      return { status: 'enabled', label: '', allClosed: false }
    }
    let totalSubLayers = 0
    let closedSubLayers = 0
    for (const [portName, value] of Object.entries(nodeOutputData)) {
      if (Array.isArray(value)) {
        const isGridArray = value.length > 0 && Array.isArray(value[0]) && Array.isArray(value[0][0])
        if (isGridArray) {
          totalSubLayers += value.length
          for (let i = 0; i < value.length; i++) {
            const key = `${id}:${portName}:${i}`
            if (subLayerVisible[key] === false) {
              closedSubLayers++
            }
          }
        }
      }
    }
    if (totalSubLayers === 0) {
      return { status: 'enabled', label: '', allClosed: false }
    }
    if (closedSubLayers === 0) {
      return { status: 'enabled', label: '', allClosed: false }
    }
    if (closedSubLayers === totalSubLayers) {
      return { status: 'all-closed', label: en ? 'Preview Off' : '预览关闭', allClosed: true }
    }
    return {
      status: 'partial-closed',
      label: en ? `${closedSubLayers}/${totalSubLayers} Off` : `${closedSubLayers}/${totalSubLayers}关闭`,
      allClosed: false,
    }
  })()

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()

      const { selectedNodeIds, currentPipeline } = usePipelineStore.getState()
      const nodePreview = currentPipeline?.nodes.find((n) => n.id === id)?.previewEnabled !== false

      const targetIds =
        selectedNodeIds.length > 1 && selectedNodeIds.includes(id) ? selectedNodeIds : [id]

      // "Add/Remove from Favorites" reuses the shared favorites store that also
      // backs the left sidebar FavoritesPanel (single source of favorites).
      const { favoriteBatteries, addFavoriteBattery, removeFavoriteBattery } = useUIStore.getState()
      const isFavorite = favoriteBatteries.some((f) => f.batteryId === battery.id)

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        nodeIds: targetIds,
        previewEnabled: nodePreview,
        extraItems: [
          {
            label: isFavorite ? '⭐ Remove from Favorites' : '⭐ Add to Favorites',
            onClick: () => {
              if (isFavorite) removeFavoriteBattery(battery.id)
              else addFavoriteBattery(battery)
            },
          },
        ],
      })
      hide()
    },
    [id, battery, hide],
  )

  const handlePreviewAction = useCallback(
    (nodeIds: string[], enabled: boolean) => {
      const isBatch = nodeIds.length > 1
      const batteryLabel = battery.nameEn || battery.id || battery.name
      const previewLabel = isBatch
        ? `${enabled ? 'Enable' : 'Disable'} preview (${nodeIds.length} node(s))`
        : `${enabled ? 'Enable' : 'Disable'} preview: ${batteryLabel}`
      const previewLabelEn = isBatch
        ? `${enabled ? 'Enable' : 'Disable'} preview (${nodeIds.length} nodes)`
        : `${enabled ? 'Enable' : 'Disable'} preview: ${batteryLabel}`
      const { currentPipeline } = usePipelineStore.getState()
      if (currentPipeline) {
        useHistoryStore.getState().record('toggle_preview', currentPipeline, {
          nodeIds,
          label: previewLabel,
          labelEn: previewLabelEn,
        })
      }
      setNodePreview(nodeIds, enabled)
    },
    [setNodePreview, battery.nameEn, battery.id, battery.name],
  )

  /** Hover input port: immediately show name, type, description and current value. */
  const showInputPortTooltip = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, port: BatteryPort) => {
      const canonical = normalizeType(port.type)
      const color = getPortTypeColor(canonical, domainPortTypes)
      const inputVal = resolveInputPortValue(id, port.name)
      let valueLine: TooltipState['valueLine']
      if (inputVal !== undefined) {
        valueLine = {
          label: 'value:',
          text: formatPortValue(inputVal),
          extra: formatPortValueExtra(inputVal),
          treeInfo: buildSummaryLine(inputVal, port),
        }
      } else if (port.default !== undefined) {
        valueLine = {
          label: 'default:',
          text: formatPortValue(port.default),
          extra: formatPortValueExtra(port.default),
          treeInfo: buildSummaryLine(port.default, port),
          muted: true,
        }
      }
      const portDesc = langMode === 'zh' ? port.description : port.descriptionEn || port.description
      showImmediate({
        x: e.clientX + 16,
        y: e.clientY - 8,
        title: langMode === 'zh' ? port.label || port.name : port.name,
        subtitle: `${canonical.charAt(0).toUpperCase() + canonical.slice(1)} · ${getPortAccess(port)}`,
        subtitleColor: color,
        description: portDesc,
        valueLine,
      })
    },
    [id, langMode, showImmediate, domainPortTypes],
  )

  /** Hover output port: immediately show name, type, description and last output value. */
  const showOutputPortTooltip = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, port: BatteryPort) => {
      const canonical = normalizeType(port.type)
      const color = getPortTypeColor(canonical, domainPortTypes)

      const state = usePipelineStore.getState()
      const outputVal = state.nodeOutputs[id]?.[port.name]

      const valueLine: TooltipState['valueLine'] =
        outputVal !== undefined
          ? {
              label: 'output:',
              text: formatPortValue(outputVal),
              extra: formatPortValueExtra(outputVal),
              treeInfo: buildSummaryLine(outputVal, port),
            }
          : { label: 'output:', text: langMode === 'zh' ? '暂无计算结果' : 'no result', muted: true }

      const portDesc = langMode === 'zh' ? port.description : port.descriptionEn || port.description
      showImmediate({
        x: e.clientX + 16,
        y: e.clientY - 8,
        title: langMode === 'zh' ? port.label || port.name : port.name,
        subtitle: `${canonical.charAt(0).toUpperCase() + canonical.slice(1)} · ${getPortAccess(port)}`,
        subtitleColor: color,
        description: portDesc,
        valueLine,
      })
    },
    [id, langMode, showImmediate, domainPortTypes],
  )

  /** Hover the node body (anywhere): after 1s show name, version/category, description. */
  const showBatteryTooltip = useCallback(() => {
    const batteryDesc = langMode === 'zh' ? battery.description : battery.descriptionEn || battery.description
    const batteryTitle = langMode === 'zh' ? battery.name : battery.nameEn || formatIdAsLabel(battery.id)
    showDelayed({
      title: batteryTitle,
      subtitle: battery.version ? `v${battery.version}` : undefined,
      tagLine: getBatteryTagLine(battery.type, battery.category),
      tagLineColor: getBatteryTypeColor(battery.type),
      description: batteryDesc,
    } satisfies BatteryTooltipState)
  }, [battery, langMode, showDelayed])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  // Click the preview-status label: re-enable preview when disabled. (The
  // legacy sub-layer open-all WebSocket broadcast targeted a renderer frame
  // absent here; without sub-layers the indicator only ever signals "disabled".)
  const handlePreviewIndicatorClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!previewEnabled) {
        setNodePreview([id], true)
      }
    },
    [id, previewEnabled, setNodePreview],
  )

  const shouldShowDisabled = !previewEnabled || previewStatusInfo.allClosed

  return (
    <div
      className={`battery-node ${selected ? 'selected' : ''} ${shouldShowDisabled ? 'preview-disabled' : ''}`}
      data-battery-type={battery.type}
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
      onContextMenu={handleContextMenu}
    >
      {/* Title bar: zh name or en identifier; preview-off indicator when disabled. */}
      <div className="node-header">
        <span className="node-title">
          {langMode === 'zh' ? battery.name : battery.nameEn || formatIdAsLabel(battery.id)}
        </span>
        {previewStatusInfo.label && (
          <span
            className={`preview-off-indicator ${previewStatusInfo.status === 'partial-closed' ? 'partial' : ''}`}
            onClick={handlePreviewIndicatorClick}
            title="Click to enable preview"
          >
            {previewStatusInfo.label}
          </span>
        )}
      </div>

      {/* Port region: inputs on the left, outputs on the right. */}
      <div className="node-ports">
        <div className="input-ports">
          {fixedInputs.map((input) => {
            const canonical = normalizeType(input.type)
            const color = getPortTypeColor(canonical, domainPortTypes)
            const isPrincipal = input.name === principalInputName
            return (
              <div
                key={input.name}
                className={`port input-port${isPrincipal ? ' input-port--principal' : ''}`}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={input.name}
                  style={{ background: color, border: `2px solid ${color}`, width: 10, height: 10 }}
                  onMouseEnter={(e) => showInputPortTooltip(e, input)}
                  onMouseLeave={hide}
                />
                <PortAccessMarker port={input} side="input" />
                <span className="port-label">
                  {langMode === 'zh' ? input.label || input.name : input.name}
                </span>
                {input.options && input.options.length > 0 && (
                  <PortOptionsPicker
                    value={portSelections[input.name] ?? String(input.default ?? input.options[0] ?? '')}
                    options={input.options}
                    onChange={(v) => handlePortOptionChange(input.name, v)}
                  />
                )}
              </div>
            )
          })}
          {dynamicPorts.map((port) => {
            const canonical = normalizeType(port.type)
            const color = getPortTypeColor(canonical, domainPortTypes)
            const isPrincipal = port.name === principalInputName
            return (
              <div
                key={port.name}
                className={`port input-port${isPrincipal ? ' input-port--principal' : ''}`}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={port.name}
                  style={{ background: color, border: `2px solid ${color}`, width: 10, height: 10 }}
                  onMouseEnter={(e) => showInputPortTooltip(e, port)}
                  onMouseLeave={hide}
                />
                <PortAccessMarker port={port} side="input" />
                <span className="port-label">{port.label}</span>
              </div>
            )
          })}
        </div>

        <div className="output-ports">
          {fixedOutputs.map((output) => {
            const canonical = normalizeType(output.type)
            const color = getPortTypeColor(canonical, domainPortTypes)
            return (
              <div key={output.name} className="port output-port">
                <span className="port-label">
                  {langMode === 'zh' ? output.label || output.name : output.name}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={output.name}
                  style={{ background: color, border: `2px solid ${color}`, width: 10, height: 10 }}
                  onMouseEnter={(e) => showOutputPortTooltip(e, output)}
                  onMouseLeave={hide}
                />
                <PortAccessMarker port={output} side="output" />
              </div>
            )
          })}
          {dynOutPorts.map((output) => {
            const canonical = normalizeType(output.type)
            const color = getPortTypeColor(canonical, domainPortTypes)
            return (
              <div
                key={output.name}
                className={`port output-port${isPlaceholder ? ' output-port--placeholder' : ''}`}
              >
                <span className="port-label">
                  {langMode === 'zh' ? output.label || output.name : output.name}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={output.name}
                  style={{
                    background: isPlaceholder ? 'var(--color-border)' : color,
                    border: `2px solid ${isPlaceholder ? 'var(--color-border)' : color}`,
                    width: 10,
                    height: 10,
                  }}
                  onMouseEnter={(e) => showOutputPortTooltip(e, output)}
                  onMouseLeave={hide}
                />
                <PortAccessMarker port={output} side="output" />
              </div>
            )
          })}
        </div>
      </div>

      {tooltip && <TooltipPortal tooltip={tooltip} />}
      {contextMenu && (
        <ContextMenuPortal menu={contextMenu} onClose={closeContextMenu} onAction={handlePreviewAction} />
      )}
    </div>
  )
}

export default memo(BatteryNode)
