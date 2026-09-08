// Boolean toggle node: node-editor style two-cell horizontal layout (name cell |
// value cell). Mirrors the NumberSlider structure; clicking the value cell
// toggles true/false and the color tracks state. When wired, the left name cell
// shows the downstream port name (single link = port name, multi = port name xN).
// Ported from the legacy editor (components/canvas/ToggleNode.tsx).
import { memo, useState, useCallback, useMemo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { usePipelineStore, useUIStore, useHistoryStore } from '../../stores/index.js'
import { getPortTypeColor } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import {
  TooltipPortal,
  useNodeValueFormatters,
  useNodeTooltip,
  type BatteryTooltipState,
} from './nodeTooltip.js'
import type { Battery } from '../../types.js'
import './ToggleNode.css'

interface ToggleNodeData {
  battery: Battery
  params: Record<string, unknown>
}

function ToggleNode({ id, data, selected, dragging }: NodeProps<ToggleNodeData>) {
  const { params } = data

  const [enabled, setEnabled] = useState(Boolean(params.value ?? params.enabled ?? false))
  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const edges     = usePipelineStore(s => s.currentPipeline?.edges ?? [])
  const pipeNodes = usePipelineStore(s => s.currentPipeline?.nodes ?? [])
  const batteries = usePipelineStore(s => s.batteries)
  const langMode = useUIStore(s => s.langMode)
  const { tooltip, showImmediate, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const next = !enabled
    const toggleLabel = `Toggle: ${data.battery?.name ?? id} -> ${next ? 'ON' : 'OFF'}`
    const { currentPipeline } = usePipelineStore.getState()
    if (currentPipeline) {
      useHistoryStore.getState().record('toggle_value', currentPipeline, {
        nodeIds: [id],
        label: toggleLabel,
        labelEn: `Toggle: ${data.battery?.name ?? id} -> ${next ? 'ON' : 'OFF'}`,
      })
    }
    setEnabled(next)
    updateNodeParam(id, 'value', next)
  }, [enabled, id, updateNodeParam, data.battery])

  const outputColor = getPortTypeColor('boolean')

  const showOutputPortTooltip = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const outputVal = usePipelineStore.getState().nodeOutputs[id]?.value
    const currentVal = outputVal !== undefined ? outputVal : enabled
    const out = data.battery.outputs[0]
    const portDesc = out ? (langMode === 'zh' ? out.description : (out.descriptionEn || out.description)) : undefined
    showImmediate({
      x: e.clientX + 16, y: e.clientY - 8,
      title: langMode === 'zh' ? (out?.label ?? 'value') : (out?.name ?? 'value'),
      subtitle: 'Bool', subtitleColor: outputColor,
      description: portDesc,
      valueLine: { label: 'value:', text: formatPortValue(currentVal), extra: formatPortValueExtra(currentVal) },
    })
  }, [id, enabled, langMode, outputColor, data.battery, showImmediate])

  const showBatteryTooltip = useCallback(() => {
    const batteryDesc = langMode === 'zh'
      ? data.battery.description
      : (data.battery.descriptionEn || data.battery.description)
    showDelayed({
      title: langMode === 'zh' ? data.battery.name : formatIdAsLabel(data.battery.id),
      subtitle: data.battery.version ? `v${data.battery.version}` : undefined,
      tagLine: getBatteryTagLine(data.battery.type, data.battery.category ?? 'special'),
      tagLineColor: getBatteryTypeColor(data.battery.type),
      description: batteryDesc,
    } satisfies BatteryTooltipState)
  }, [data.battery, langMode, showDelayed])

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
    const defaultName = langMode === 'zh' ? (data.battery?.name || 'Bool') : formatIdAsLabel(data.battery?.id || 'toggle')
    return `${defaultName} x${outEdges.length}`
  }, [edges, pipeNodes, batteries, id, langMode])

  const displayName = downstreamLabel ?? (langMode === 'zh'
    ? (data.battery?.name || 'Bool')
    : formatIdAsLabel(data.battery?.id || 'toggle'))

  return (
    <div
      className={`toggle-node${selected ? ' selected' : ''}${enabled ? ' on' : ''}`}
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
    >
      {/* Left name cell (drag region). */}
      <div className="tg-name-cell">
        <span className="tg-name">{displayName}</span>
      </div>

      {/* Right value cell (click to toggle). */}
      <div className="tg-value-cell nodrag" onClick={handleToggle}>
        <div className={`tg-switch${enabled ? ' on' : ''}`}>
          <div className="tg-thumb" />
        </div>
      </div>

      {/* Output port (events bound directly on the Handle). */}
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

export default memo(ToggleNode)
