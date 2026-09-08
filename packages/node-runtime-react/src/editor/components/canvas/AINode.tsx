// AI battery node: same overall structure as BatteryNode with four differences:
// (1) a resident preview area (2) a run button (3) an inline icon picker for
// options ports (4) a red theme + AI/IMG badge. Ported from the legacy editor
// (components/canvas/AINode.tsx).
//
// Note: ai-node__body / ai-node__preview do NOT carry nodrag, otherwise ReactFlow
// skips selection logic for that region; nodrag goes on the buttons only.
//
// The AI text/image endpoints are configurable (default to the legacy paths) so a
// consumer can point them at its own transport.
import { memo, useState, useCallback, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import { getPortTypeColor, normalizeType } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import { getPortAccess, resolvePrincipalInputName } from '../../utils/datatreeShape.js'
import type { BatteryPort } from '../../types.js'
import {
  TooltipPortal,
  useNodeValueFormatters,
  useNodeTooltip,
  resolveInputPortValue,
  type TooltipState,
  type BatteryTooltipState,
} from './nodeTooltip.js'
import { imageRefToSrc } from '../../utils/imageRef.js'
import './AINode.css'

// Module-level concurrency semaphore: shared by all AINode instances, capping
// simultaneous AI API calls at 2.
const AI_CONCURRENCY_LIMIT = 2
const aiConcurrency = { active: 0 }

let aiTextEndpoint = '/api/v1/ai/text'
let aiImageEndpoint = '/api/v1/ai/image'

/** Override the AI text/image endpoints used by AINode. */
export function configureAINodeEndpoints(endpoints: { text?: string; image?: string }): void {
  if (endpoints.text) aiTextEndpoint = endpoints.text
  if (endpoints.image) aiImageEndpoint = endpoints.image
}

/** Port shape marker: access:item not drawn (the default dot Handle is the visual); list=square, tree=fork. */
function PortAccessMarker({ port, side }: { port: BatteryPort; side: 'input' | 'output' }) {
  const shape = getPortAccess(port)
  if (shape === 'item') return null
  return (
    <span
      className={`port-access-marker port-access-marker--${side} port-access-marker--${shape}`}
      aria-hidden="true"
    />
  )
}

/** Inline icon picker for a port row: a small arrow button popping a portal dropdown. */
function PortOptionsPicker({
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
    setOpen(o => !o)
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
        className={`ai-port-options-btn nodrag${open ? ' ai-port-options-btn--open' : ''}`}
        onMouseDown={handleMouseDown}
        type="button"
        title={value}
      >
        <svg viewBox="0 0 10 6" width="8" height="5" aria-hidden="true">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && ReactDOM.createPortal(
        <div
          ref={dropRef}
          className="custom-select-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: 200 }}
          role="listbox"
        >
          {options.map(opt => (
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
        document.body
      )}
    </>
  )
}

interface AINodeData {
  battery: {
    id: string
    name: string
    type: string
    nameEn?: string
    version?: string
    category?: string
    description?: string
    descriptionEn?: string
    inputs?: BatteryPort[]
    outputs?: BatteryPort[]
  }
  params: Record<string, unknown>
}

function AINode({ id, data, selected, dragging }: NodeProps<AINodeData>) {
  const { battery, params } = data
  const isImage = (battery.outputs ?? []).some(o => o.name === 'image')
  const inputs = battery.inputs ?? []
  const outputs = battery.outputs ?? []

  const principalInputName = resolvePrincipalInputName({ principal: undefined, inputs })

  const langMode = useUIStore(s => s.langMode)
  const edges = usePipelineStore(s => s.currentPipeline?.edges ?? [])
  const nodeOutputs = usePipelineStore(s => s.nodeOutputs)
  const updateNodeParam = usePipelineStore(s => s.updateNodeParam)
  const setNodeOutput = usePipelineStore(s => s.setNodeOutput)

  // Each options port keeps an independent selected value; key = port.name.
  const [portSelections, setPortSelections] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const inp of battery.inputs ?? []) {
      if (inp.options?.length) {
        const stored = params[inp.name]
        init[inp.name] = typeof stored === 'string' ? stored : String(inp.default ?? inp.options[0] ?? '')
      }
    }
    return init
  })
  // Back-compat: selectedModel points at the current value of the model port.
  const selectedModel = portSelections['model'] ?? 'gemini-2.0-flash'
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState('')
  // Panel-like mode: initialize from params (same as TextPanel.localText). On
  // restart data.params has already been restored from session, so no extra
  // aiOutputs mechanism is needed.
  const [textResult, setTextResult] = useState(
    typeof params._gen_result === 'string' ? params._gen_result : ''
  )
  // Encoded ImageRef (JSON); port and persistence field both use _gen_image.
  const [imageResultRef, setImageResultRef] = useState<string>(
    typeof params._gen_image === 'string' ? params._gen_image : ''
  )
  const { tooltip, showImmediate, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()
  const abortRef = useRef<AbortController | null>(null)

  const getPromptValue = useCallback(() => {
    const edge = edges.find(e => e.target.nodeId === id && e.target.port === 'prompt')
    if (edge) {
      const upstream = nodeOutputs[edge.source.nodeId]?.[edge.source.port]
      return typeof upstream === 'string' ? upstream : String(upstream ?? '')
    }
    return typeof params.prompt === 'string' ? params.prompt : ''
  }, [edges, nodeOutputs, id, params.prompt])

  const getInputImage = useCallback((): string[] => {
    const edge = edges.find(e => e.target.nodeId === id && e.target.port === 'image')
    if (edge) {
      const upstream = nodeOutputs[edge.source.nodeId]?.[edge.source.port]
      if (Array.isArray(upstream)) return upstream.map(v => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
      if (typeof upstream === 'string' && upstream.trim()) return [upstream.trim()]
    }
    return []
  }, [edges, nodeOutputs, id])

  const handlePortOptionChange = useCallback(
    (portName: string, v: string) => {
      setPortSelections(prev => ({ ...prev, [portName]: v }))
      updateNodeParam(id, portName, v)
    },
    [id, updateNodeParam]
  )

  const handleRun = useCallback(async () => {
    if (isRunning) {
      abortRef.current?.abort()
      setIsRunning(false)
      return
    }
    if (aiConcurrency.active >= AI_CONCURRENCY_LIMIT) {
      setError(`Concurrency limit ${AI_CONCURRENCY_LIMIT}; wait for other tasks to finish before running`)
      return
    }
    setIsRunning(true)
    setError('')
    setTextResult('')
    setImageResultRef('')
    aiConcurrency.active++
    const controller = new AbortController()
    abortRef.current = controller
    try {
      if (isImage) {
        const resp = await fetch(aiImageEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: getPromptValue(), images: getInputImage(), nodeId: id }),
          signal: controller.signal,
        })
        const json = (await resp.json()) as { data?: { image?: string }; message?: string }
        if (!resp.ok) throw new Error(json.message ?? 'Image generation failed')
        const imageRef = typeof json.data?.image === 'string' ? json.data.image : ''
        if (!imageRef) throw new Error('Image generated but no asset reference returned')
        setImageResultRef(imageRef)
        setNodeOutput(id, 'image', imageRef)
        setNodeOutput(id, 'error', '')
        updateNodeParam(id, '_gen_image', imageRef)
        updateNodeParam(id, '_gen_error', '')
      } else {
        const resp = await fetch(aiTextEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: getPromptValue(), model: selectedModel }),
          signal: controller.signal,
        })
        const json = (await resp.json()) as { data?: { result?: string }; message?: string }
        if (!resp.ok) throw new Error(json.message ?? 'Inference failed')
        const result = json.data?.result ?? ''
        // Write the preview area (local state) and output port (nodeOutputs) in sync.
        setTextResult(result)
        setNodeOutput(id, 'result', result)
        setNodeOutput(id, 'error', '')
        updateNodeParam(id, '_gen_result', result)
        updateNodeParam(id, '_gen_error', '')
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        const message = String(e)
        setError(message)
        setNodeOutput(id, 'error', message)
        updateNodeParam(id, '_gen_error', message)
      }
    } finally {
      aiConcurrency.active--
      setIsRunning(false)
      abortRef.current = null
    }
  }, [isRunning, isImage, getPromptValue, getInputImage, selectedModel, id, updateNodeParam, setNodeOutput])

  const showInputPortTooltip = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, port: BatteryPort) => {
      const canonical = normalizeType(port.type)
      const inputVal = resolveInputPortValue(id, port.name)
      const valueLine: TooltipState['valueLine'] = inputVal !== undefined
        ? { label: 'value:', text: formatPortValue(inputVal), extra: formatPortValueExtra(inputVal) }
        : port.default !== undefined
          ? { label: 'default:', text: formatPortValue(port.default), extra: formatPortValueExtra(port.default), muted: true }
          : undefined
      const portDesc = langMode === 'zh' ? port.description : (port.descriptionEn || port.description)
      showImmediate({ x: e.clientX + 16, y: e.clientY - 8,
        title: langMode === 'zh' ? (port.label ?? port.name) : port.name,
        subtitle: canonical.charAt(0).toUpperCase() + canonical.slice(1), subtitleColor: getPortTypeColor(canonical),
        description: portDesc, valueLine })
    }, [id, langMode, showImmediate])

  const showOutputPortTooltip = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, port: BatteryPort) => {
      const canonical = normalizeType(port.type)
      const outputVal = usePipelineStore.getState().nodeOutputs[id]?.[port.name]
      const valueLine: TooltipState['valueLine'] = outputVal !== undefined
        ? { label: 'output:', text: formatPortValue(outputVal), extra: formatPortValueExtra(outputVal) }
        : { label: 'output:', text: langMode === 'zh' ? '暂无计算结果' : 'no result', muted: true }
      const portDesc = langMode === 'zh' ? port.description : (port.descriptionEn || port.description)
      showImmediate({ x: e.clientX + 16, y: e.clientY - 8,
        title: langMode === 'zh' ? (port.label ?? port.name) : port.name,
        subtitle: canonical.charAt(0).toUpperCase() + canonical.slice(1), subtitleColor: getPortTypeColor(canonical),
        description: portDesc, valueLine })
    }, [id, langMode, showImmediate])

  const showBatteryTooltip = useCallback(() => {
    const batteryDesc = langMode === 'zh' ? battery.description : (battery.descriptionEn || battery.description)
    showDelayed({
      title: langMode === 'zh' ? battery.name : formatIdAsLabel(battery.id),
      subtitle: `v${battery.version ?? '1.0'}`,
      tagLine: getBatteryTagLine(battery.type, battery.category ?? 'ai'),
      tagLineColor: getBatteryTypeColor(battery.type),
      description: batteryDesc,
    } satisfies BatteryTooltipState)
  }, [battery, langMode, showDelayed])

  return (
    <div
      className={`battery-node ai-node${selected ? ' selected' : ''}`}
      data-battery-type="ai"
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
    >
      {/* Title bar: same as BatteryNode plus an AI/IMG badge. */}
      <div className="node-header">
        <span className="node-title">
          {langMode === 'zh' ? battery.name : formatIdAsLabel(battery.id)}
        </span>
        <span className="ai-badge">{isImage ? 'IMG' : 'AI'}</span>
      </div>

      {/* Port region: identical structure to BatteryNode. */}
      <div className="node-ports">
        <div className="input-ports">
          {inputs.map(inp => {
            const canonical = normalizeType(inp.type)
            const color = getPortTypeColor(canonical)
            const isPrincipal = inp.name === principalInputName
            return (
              <div
                key={inp.name}
                className={`port input-port${isPrincipal ? ' input-port--principal' : ''}`}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={inp.name}
                  style={{ background: color, border: `2px solid ${color}`, width: 10, height: 10 }}
                  onMouseEnter={e => showInputPortTooltip(e, inp)}
                  onMouseLeave={hide}
                />
                <PortAccessMarker port={inp} side="input" />
                <span className="port-label">
                  {langMode === 'zh' ? (inp.label ?? inp.name) : inp.name}
                </span>
                {/* options port: append a small icon picker after the label, not taking row width. */}
                {inp.options && inp.options.length > 0 && (
                  <PortOptionsPicker
                    value={portSelections[inp.name] ?? String(inp.default ?? inp.options[0] ?? '')}
                    options={inp.options}
                    onChange={(v) => handlePortOptionChange(inp.name, v)}
                  />
                )}
              </div>
            )
          })}
        </div>

        <div className="output-ports">
          {outputs.map(out => {
            const canonical = normalizeType(out.type)
            const color = getPortTypeColor(canonical)
            return (
              <div
                key={out.name}
                className="port output-port"
              >
                <span className="port-label">
                  {langMode === 'zh' ? (out.label ?? out.name) : out.name}
                </span>
                <PortAccessMarker port={out} side="output" />
                <Handle
                  type="source"
                  position={Position.Right}
                  id={out.name}
                  style={{ background: color, border: `2px solid ${color}`, width: 10, height: 10 }}
                  onMouseEnter={e => showOutputPortTooltip(e, out)}
                  onMouseLeave={hide}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Run button region: no nodrag/nowheel on the wrapper, only nodrag on the button. */}
      <div className="ai-node__body">
        <button
          className={`ai-run-btn nodrag${isRunning ? ' ai-run-btn--running' : ''}`}
          onClick={handleRun}
          title={isRunning ? (langMode === 'zh' ? '点击取消' : 'Click to cancel') : (langMode === 'zh' ? '运行' : 'Run')}
        >
          {isRunning ? (
            <>
              <span className="ai-run-spinner" />
              <span>{langMode === 'zh' ? '运行中… 点击取消' : 'Running… click to cancel'}</span>
            </>
          ) : (
            <>
              <span>▶</span>
              <span>{langMode === 'zh' ? '运行' : 'Run'}</span>
            </>
          )}
        </button>
      </div>

      {/* Resident preview area. */}
      <div className="ai-node__preview">
        <div className="ai-node__preview-body">
          {isImage ? (
            imageResultRef ? (
              <div className="ai-node__image-grid">
                <img
                  src={imageRefToSrc(imageResultRef)}
                  alt="ai-image"
                  className="ai-node__preview-img"
                />
              </div>
            ) : error ? (
              <div className="ai-node__error">{error}</div>
            ) : (
              <div className="ai-node__empty">{langMode === 'zh' ? '暂无计算结果' : 'No result'}</div>
            )
          ) : textResult.length > 0 ? (
            <div className="ai-node__text-result">{textResult}</div>
          ) : error ? (
            <div className="ai-node__error">{error}</div>
          ) : (
            <div className="ai-node__empty">{langMode === 'zh' ? '暂无计算结果' : 'No result'}</div>
          )}
        </div>
      </div>

      {tooltip && <TooltipPortal tooltip={tooltip} />}
    </div>
  )
}

export default memo(AINode)
