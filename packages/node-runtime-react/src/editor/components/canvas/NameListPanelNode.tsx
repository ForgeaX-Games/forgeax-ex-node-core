// NameListPanel special node: a panel that renders each entry of a name list on
// its own line and auto-widens to fit. Ported from the legacy editor
// (components/canvas/NameListPanelNode.tsx).
import { memo, useCallback, useEffect, useRef } from 'react'
import { Handle, Position, type NodeProps, NodeResizer, useReactFlow } from 'reactflow'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import { getPortTypeColor, normalizeType } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import { peelWireValue } from '../../utils/datatreeShape.js'
import {
  TooltipPortal,
  useNodeValueFormatters,
  useNodeTooltip,
  resolveInputPortValue,
  type BatteryTooltipState,
} from './nodeTooltip.js'
import './NameListPanelNode.css'

interface NameListPanelNodeData {
  battery: {
    id: string
    name: string
    type?: string
    nameEn?: string
    version?: string
    category?: string
    description?: string
    descriptionEn?: string
    inputs: Array<{ name: string; type: string; label?: string; description?: string; descriptionEn?: string; default?: unknown }>
    outputs: Array<{ name: string; type: string; label?: string; description?: string; descriptionEn?: string }>
  }
  params: Record<string, unknown>
}

// Measure string pixel width in a monospace font via a hidden canvas.
// getContext('2d') is null in non-DOM/jsdom environments — fall back to a
// monospace char-width estimate so the module loads + renders without a crash.
const measureCtx = document.createElement('canvas').getContext('2d')
if (measureCtx) measureCtx.font = '0.72rem "Courier New", Consolas, monospace'

function measureTextWidth(text: string): number {
  if (measureCtx) return measureCtx.measureText(text).width
  return text.length * 7 // monospace fallback (~7px/char)
}

/**
 * Format the peeled "bare value" into panel body text:
 *   - string: shown directly (typical: a g_preview DSL text that cannot be JSON.parse'd)
 *   - array: one JSON.stringify item per line (the original name_list_panel use)
 *   - object (incl. Geometry / other DSL): JSON.stringify(2-space) for readability
 *   - null/undefined: '' (let the caller show the "no content" placeholder)
 */
function formatNameList(val: unknown): string {
  if (val === null || val === undefined) return ''

  if (typeof val === 'string') {
    if (val.length === 0) return ''
    // Try JSON.parse first (compat with the old usage where name_list_panel took a
    // JSON string array directly); on failure treat as plain text (g_preview DSL
    // multi-line strings go here) and return as-is.
    try {
      const parsed = JSON.parse(val)
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) return '[]'
        return '[\n' + parsed.map(item => '  ' + JSON.stringify(item)).join(',\n') + '\n]'
      }
      return val
    } catch {
      return val
    }
  }

  if (Array.isArray(val)) {
    if (val.length === 0) return '[]'
    return '[\n' + val.map(item => '  ' + JSON.stringify(item)).join(',\n') + '\n]'
  }

  // Fallback: Geometry / other plain object goes to pretty JSON.
  try {
    return JSON.stringify(val, null, 2)
  } catch {
    return String(val)
  }
}

// Minimum width (px) needed for the content lines.
// padding: left 10 + right 10 = 20px; port handles ~14px each.
const PADDING_H = 20 + 14 * 2
const MIN_WIDTH = 180
const MAX_AUTO_WIDTH = 800

function calcAutoWidth(text: string): number {
  if (!text) return MIN_WIDTH
  const lines = text.split('\n')
  const maxLineWidth = Math.max(...lines.map(l => measureTextWidth(l)))
  const needed = Math.ceil(maxLineWidth) + PADDING_H
  return Math.max(MIN_WIDTH, Math.min(needed, MAX_AUTO_WIDTH))
}

/**
 * Placeholder text: dispatch a three-state message by "has upstream edge" x
 * "received output".
 *
 * The NameListPanel UI is reused by several semantically different batteries
 * (name_list_panel, g_preview, ...); the same displayText="" can stem from
 * completely different states:
 *   1. no edge          -> "Waiting for geometry input…" / "Waiting for input…"
 *   2. edge but no result -> "(computing…)"
 *   3. edge but empty result -> "(empty)"  — prevent the user thinking it did not run
 */
function getPlaceholderText(
  batteryId: string | undefined,
  langMode: 'zh' | 'en',
  state: 'no-edge' | 'computing' | 'empty',
): string {
  if (state === 'no-edge') {
    if (batteryId === 'g_preview') {
      return langMode === 'zh' ? '等待几何输入…' : 'Waiting for geometry input…'
    }
    return langMode === 'zh' ? '等待输入…' : 'Waiting for input…'
  }
  if (state === 'computing') {
    return langMode === 'zh' ? '(等待计算)' : '(computing…)'
  }
  return langMode === 'zh' ? '(空)' : '(empty)'
}

function NameListPanelNode({ id, data, selected, dragging }: NodeProps<NameListPanelNodeData>) {
  const updateNodeParam   = usePipelineStore((s) => s.updateNodeParam)
  const schedulePersistSession = usePipelineStore((s) => s.schedulePersistSession)
  const nodeOutputs       = usePipelineStore((s) => s.nodeOutputs)
  const langMode          = useUIStore(s => s.langMode)
  const { setNodes }      = useReactFlow()
  const { tooltip, showImmediate, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()

  // Determine the presence of an upstream edge via the edge table (cannot rely on
  // whether nodeOutputs has a value — after a new link the backend may not have
  // returned NODE_OUTPUT yet, so nodeOutputs is briefly undefined; that state is
  // "computing", not "no-edge", and the placeholders differ).
  const hasUpstreamEdge = usePipelineStore(
    (s) => (s.currentPipeline?.edges ?? []).some(
      e => e.target.nodeId === id && e.target.port === 'input'
    )
  )

  const outputValue = nodeOutputs[id]?.output
  // Feeding the wire form [{path, items:[T]}] straight into formatNameList yields
  // [{"path":[],"items":[...]}] JSON noise; peel to a single item first, then let
  // formatNameList pick a render strategy by value type.
  const peeledOutput = peelWireValue(outputValue)
  const displayText = formatNameList(peeledOutput ?? null)

  // Three-state placeholder: no edge / edge but no result yet / edge but empty result.
  const placeholderState: 'no-edge' | 'computing' | 'empty' = !hasUpstreamEdge
    ? 'no-edge'
    : (outputValue === undefined ? 'computing' : 'empty')

  // Whether the user has manually widened the node (a stored value means don't auto-override).
  const userResizedRef = useRef(typeof data.params._nodeWidth === 'number')

  // Auto-widen on content change (no longer auto-intervenes after a manual resize).
  useEffect(() => {
    if (userResizedRef.current) return
    const w = calcAutoWidth(displayText)
    setNodes(nds => nds.map(n => n.id === id ? { ...n, style: { ...n.style, width: w } } : n))
    updateNodeParam(id, '_nodeWidth', w, true)
  }, [displayText, id, setNodes, updateNodeParam])

  const inputColor  = getPortTypeColor('any')
  const outputColor = getPortTypeColor('string')

  const showInputPortTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const inp = data.battery.inputs[0]
    if (!inp) return
    const canonical = normalizeType(inp.type)
    const inputVal = resolveInputPortValue(id, inp.name)
    const valueLine = inputVal !== undefined
      ? { label: 'value:', text: formatPortValue(inputVal), extra: formatPortValueExtra(inputVal) }
      : inp.default !== undefined
        ? { label: 'default:', text: formatPortValue(inp.default), extra: formatPortValueExtra(inp.default), muted: true as const }
        : undefined
    const portDesc = langMode === 'zh' ? inp.description : (inp.descriptionEn || inp.description)
    showImmediate({
      x: e.clientX + 16, y: e.clientY - 8,
      title: langMode === 'zh' ? (inp.label ?? inp.name) : inp.name,
      subtitle: canonical.charAt(0).toUpperCase() + canonical.slice(1), subtitleColor: getPortTypeColor(canonical),
      description: portDesc, valueLine,
    })
  }, [id, langMode, data.battery.inputs, showImmediate])

  const showOutputPortTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const out = data.battery.outputs[0]
    if (!out) return
    const canonical = normalizeType(out.type)
    const outVal = usePipelineStore.getState().nodeOutputs[id]?.[out.name]
    const valueLine = outVal !== undefined
      ? { label: 'output:', text: formatPortValue(outVal), extra: formatPortValueExtra(outVal) }
      : { label: 'output:', text: langMode === 'zh' ? '暂无计算结果' : 'no result', muted: true as const }
    const portDesc = langMode === 'zh' ? out.description : (out.descriptionEn || out.description)
    showImmediate({
      x: e.clientX + 16, y: e.clientY - 8,
      title: langMode === 'zh' ? (out.label ?? out.name) : out.name,
      subtitle: canonical.charAt(0).toUpperCase() + canonical.slice(1), subtitleColor: getPortTypeColor(canonical),
      description: portDesc, valueLine,
    })
  }, [id, langMode, data.battery.outputs, showImmediate])

  const showBatteryTooltip = useCallback(() => {
    const batteryDesc = langMode === 'zh' ? data.battery.description : (data.battery.descriptionEn || data.battery.description)
    showDelayed({
      title: langMode === 'zh' ? data.battery.name : formatIdAsLabel(data.battery.id),
      subtitle: data.battery.version ? `v${data.battery.version}` : undefined,
      tagLine: getBatteryTagLine(data.battery.type ?? '', data.battery.category ?? 'special'),
      tagLineColor: getBatteryTypeColor(data.battery.type ?? ''),
      description: batteryDesc,
    } satisfies BatteryTooltipState)
  }, [data.battery, langMode, showDelayed])

  return (
    <div
      className={['nlp-node', selected ? 'selected' : ''].filter(Boolean).join(' ')}
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
    >
      <NodeResizer
        minWidth={MIN_WIDTH}
        minHeight={60}
        isVisible={selected}
        lineClassName="nlp-resize-line"
        handleClassName="nlp-resize-handle"
        onResizeEnd={(_event, params) => {
          // After a manual widen, disable auto-widen override.
          userResizedRef.current = true
          updateNodeParam(id, '_nodeWidth', params.width, true)
          updateNodeParam(id, '_nodeHeight', params.height, true)
          schedulePersistSession('namelist-panel-resize')
        }}
      />

      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{ background: inputColor, border: `2px solid ${inputColor}`, width: 10, height: 10 }}
        onMouseEnter={showInputPortTooltip}
        onMouseLeave={hide}
      />

      <div className="nlp-header">
        <span className="nlp-title">
          {langMode === 'zh'
            ? (data.battery?.name || '名称清单预览')
            : formatIdAsLabel(data.battery?.id || 'name_list_panel')}
        </span>
      </div>

      <div className="nlp-body">
        <div className="nlp-content">
          {displayText
            ? displayText.split('\n').map((line, i) => (
                <span key={i} className="nlp-line">{line}</span>
              ))
            : <span className="nlp-placeholder">{getPlaceholderText(data.battery?.id, langMode, placeholderState)}</span>
          }
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{ background: outputColor, border: `2px solid ${outputColor}`, width: 10, height: 10 }}
        onMouseEnter={showOutputPortTooltip}
        onMouseLeave={hide}
      />

      {tooltip && <TooltipPortal tooltip={tooltip} />}
    </div>
  )
}

export default memo(NameListPanelNode)
