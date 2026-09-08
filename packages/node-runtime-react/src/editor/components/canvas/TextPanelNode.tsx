// TextPanel special node, in Panel style: supports double-click editing and
// edge-drag resizing. Ported from the legacy editor (components/canvas/TextPanelNode.tsx).
// The legacy bookmark icon (lucide-react) is replaced with an inline SVG to keep
// the package dependency-free; the markup/CSS class is preserved.
import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps, NodeResizer } from 'reactflow'
import { usePipelineStore, useUIStore, useHistoryStore } from '../../stores/index.js'
import { getPortTypeColor, normalizeType } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import { compactGridArrays } from '../../utils/gridFormat.js'
import { peelWireValue } from '../../utils/datatreeShape.js'
import {
  TooltipPortal,
  useNodeValueFormatters,
  useNodeTooltip,
  resolveInputPortValue,
  type BatteryTooltipState,
} from './nodeTooltip.js'
import './TextPanelNode.css'

/** Inline bookmark icon (replaces the legacy lucide-react Bookmark). */
function BookmarkIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

interface TextPanelNodeData {
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

// How long after the last keystroke (typing stops) before the new value is pushed
// downstream. AI streaming output flows through nodeOutputs / upstream edges and
// is unaffected by this debounce.
const TEXT_DEBOUNCE_MS = 4000

/**
 * Render an upstream single value (after peelWireValue has stripped the wire
 * wrapper) into the text the TextPanel wants to show.
 *   - string / number / boolean: String()
 *   - other object / array: pretty JSON (keeps structure for copying)
 * This is TextPanel-specific and is not shared; NameListPanel etc. have their own.
 */
function stringifyForPanel(val: unknown): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  // JSON.stringify(()=>{}) returns undefined (not a throw) and must not be
  // returned directly, otherwise the string-typed signature mismatches the
  // runtime undefined and a later .split would crash.
  try {
    const s = JSON.stringify(val, null, 2)
    return typeof s === 'string' ? s : String(val)
  } catch {
    return String(val)
  }
}

function TextPanelNode({ id, data, selected, dragging }: NodeProps<TextPanelNodeData>) {
  const { params } = data
  const [isEditing, setIsEditing] = useState(false)
  const [localText, setLocalText] = useState(typeof params.text === 'string' ? params.text : '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Debounce timer that triggers downstream execution from keyboard input.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Whether there is pending text awaiting flush (checked on blur/unmount).
  const pendingFlushRef = useRef(false)

  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const schedulePersistSession = usePipelineStore((s) => s.schedulePersistSession)
  const nodeOutputs = usePipelineStore((s) => s.nodeOutputs)
  const addTextPreset = useUIStore((s) => s.addTextPreset)
  // Save button animation state: idle / saved (green) / empty (red shake).
  const [saveAnim, setSaveAnim] = useState<'idle' | 'saved' | 'empty'>('idle')
  // Determine whether the input port has an upstream link via the edge table
  // (not via the output result), to avoid hasInput being misjudged true after
  // execution writes nodeOutputs, which would disable editing.
  const hasUpstreamEdge = usePipelineStore(
    (s) => (s.currentPipeline?.edges ?? []).some(
      e => e.target.nodeId === id && e.target.port === 'input'
    )
  )
  const langMode = useUIStore(s => s.langMode)
  const { tooltip, showImmediate, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()

  const outputValue = nodeOutputs[id]?.output
  // The wire form [{path, items:[T]}] makes String() emit "[object Object]";
  // peel to a single item first, then stringify. Multi branch / multi item (rare,
  // TextPanel upstream access:item is almost always a single cell) goes through
  // JSON serialization to keep structure.
  const peeledOutput = peelWireValue(outputValue)
  const hasInput = hasUpstreamEdge && peeledOutput !== undefined && peeledOutput !== null
  const rawDisplayText = hasInput ? stringifyForPanel(peeledOutput) : localText
  const displayText = compactGridArrays(rawDisplayText)

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!hasInput) {
      setIsEditing(true)
    }
  }, [hasInput])

  const handleFocus = useCallback(() => {
    const { currentPipeline } = usePipelineStore.getState()
    if (currentPipeline) {
      useHistoryStore.getState().record('edit_text', currentPipeline, {
        nodeIds: [id],
        label: `Edit text: ${data.battery?.name ?? id}`,
        labelEn: `Edit text: ${data.battery?.name ?? id}`,
      })
    }
  }, [id, data.battery?.name])

  // Immediately push the current localText downstream (cancel the pending debounce
  // and trigger one downstream execution).
  //
  // This must NOT go through the non-silent updateNodeParam path: silent=true has
  // already written the latest text into the store (handleChange does this on each
  // keystroke), so calling updateNodeParam would see Object.is(stored, latest) ===
  // true and early-return without triggering incrementalExecute. That bug is the
  // root cause of "panel input needs a refresh to take effect": on debounce / blur
  // / unmount fire, downstream never receives the new value.
  // Correct approach: call incrementalExecute directly, bypassing updateNodeParam's
  // early-return.
  const flushTextNow = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (!pendingFlushRef.current) return
    pendingFlushRef.current = false
    void usePipelineStore.getState().incrementalExecute(id, false)
  }, [id])

  const handleBlur = useCallback(() => {
    setIsEditing(false)
    flushTextNow()
  }, [flushTextNow])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setLocalText(value)
    // Sync to store immediately (silent=true: UI / refresh / AI node manual run all
    // read the latest value), without triggering execution.
    updateNodeParam(id, 'text', value, true)
    pendingFlushRef.current = true
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      if (!pendingFlushRef.current) return
      pendingFlushRef.current = false
      // Call incrementalExecute directly; see flushTextNow on the Object.is early-return.
      void usePipelineStore.getState().incrementalExecute(id, false)
    }, TEXT_DEBOUNCE_MS)
  }, [id, updateNodeParam])

  useEffect(() => {
    return () => {
      // On unmount, if input is still pending, flush downstream immediately to
      // avoid losing data.
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
        if (pendingFlushRef.current) {
          pendingFlushRef.current = false
          void usePipelineStore.getState().incrementalExecute(id, false)
        }
      }
    }
  }, [id])

  // Save the current text as a preset: trigger a shake animation when empty,
  // otherwise write to the UI store.
  const handleSavePreset = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!localText.trim()) {
      setSaveAnim('empty')
      setTimeout(() => setSaveAnim('idle'), 800)
      return
    }
    addTextPreset(localText)
    setSaveAnim('saved')
    setTimeout(() => setSaveAnim('idle'), 1000)
  }, [localText, addTextPreset])

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const el = textareaRef.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [isEditing])

  const inputColor = getPortTypeColor('any')
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
    const outputVal = usePipelineStore.getState().nodeOutputs[id]?.[out.name]
    const valueLine = outputVal !== undefined
      ? { label: 'output:', text: formatPortValue(outputVal), extra: formatPortValueExtra(outputVal) }
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
      title: langMode === 'zh' ? data.battery.name : (data.battery.nameEn || formatIdAsLabel(data.battery.id)),
      subtitle: data.battery.version ? `v${data.battery.version}` : undefined,
      tagLine: getBatteryTagLine(data.battery.type ?? '', data.battery.category ?? 'special'),
      tagLineColor: getBatteryTypeColor(data.battery.type ?? ''),
      description: batteryDesc,
    } satisfies BatteryTooltipState)
  }, [data.battery, langMode, showDelayed])

  return (
    <div
      className={[
        'text-panel-node',
        selected ? 'selected' : '',
        isEditing ? 'editing' : '',
        hasInput ? 'has-input' : '',
      ].filter(Boolean).join(' ')}
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
    >
      <NodeResizer
        minWidth={120}
        minHeight={60}
        isVisible={selected}
        lineClassName="text-panel-resize-line"
        handleClassName="text-panel-resize-handle"
        onResizeEnd={(_event, params) => {
          updateNodeParam(id, '_nodeWidth', params.width, true)
          updateNodeParam(id, '_nodeHeight', params.height, true)
          schedulePersistSession('text-panel-resize')
        }}
      />

      {/* Input port: left-center, events bound directly on the Handle to avoid a
          wrapper breaking ReactFlow positioning. */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{
          background: inputColor,
          border: `2px solid ${inputColor}`,
          width: 10,
          height: 10,
        }}
        onMouseEnter={showInputPortTooltip}
        onMouseLeave={hide}
      />

      {/* Title bar. */}
      <div className="text-panel-header">
        <span className="text-panel-title">
          {langMode === 'zh'
            ? (data.battery?.name || '面板')
            : (data.battery?.nameEn || formatIdAsLabel(data.battery?.id || 'text_panel'))}
        </span>
        {/* Save-as-preset button: hidden when there is an upstream link (upstream
            data is not user-typed content). */}
        {!hasInput && (
          <button
            className={`text-panel-save-btn${saveAnim !== 'idle' ? ` text-panel-save-btn--${saveAnim}` : ''}`}
            onClick={handleSavePreset}
            title={saveAnim === 'empty' ? 'Text is empty, cannot save' : 'Save as preset'}
          >
            <BookmarkIcon size={10} />
          </button>
        )}
      </div>

      {/* Body area. */}
      <div
        className="text-panel-body"
        onDoubleClick={handleDoubleClick}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            className="text-panel-textarea nodrag nowheel"
            value={localText}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={e => e.stopPropagation()}
            spellCheck={false}
          />
        ) : (
          <div className="text-panel-content">
            {displayText
              ? displayText.split('\n').map((line, i) => (
                  <span key={i} className="text-panel-line">{line}</span>
                ))
              : <span className="text-panel-placeholder">Double-click to enter text…</span>
            }
          </div>
        )}
      </div>

      {/* Output port: right-center. */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
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

export default memo(TextPanelNode)
