// JSON battery node: a title bar + a center JSON preview area (fixed size, content
// does not expand the node) + a right-side string output port. Ported from the
// legacy editor (components/canvas/JsonNode.tsx).
import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps, NodeResizer } from 'reactflow'
import { getPortTypeColor } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import { compactGridArrays } from '../../utils/gridFormat.js'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import {
  TooltipPortal,
  useNodeValueFormatters,
  useNodeTooltip,
  type BatteryTooltipState,
} from './nodeTooltip.js'
import './JsonNode.css'

interface JsonNodeData {
  battery: {
    id: string
    name: string
    type: string
    nameEn?: string
    version?: string
    category?: string
    description?: string
    descriptionEn?: string
    jsonContent?: string
    outputs: Array<{ name: string; type: string; label?: string }>
  }
  params: Record<string, unknown>
}

function JsonNode({ id, data, selected, dragging }: NodeProps<JsonNodeData>) {
  const { battery } = data

  const langMode = useUIStore(s => s.langMode)
  const { tooltip, showImmediate, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()
  const updateNodeParam = usePipelineStore(s => s.updateNodeParam)
  const schedulePersistSession = usePipelineStore(s => s.schedulePersistSession)

  const executedValue = usePipelineStore(s => s.nodeOutputs[id]?.value)
  const previewContent = compactGridArrays(
    typeof executedValue === 'string' ? executedValue : (battery.jsonContent ?? '')
  )

  const outputColor = getPortTypeColor('string')

  const showOutputPortTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const outputVal = usePipelineStore.getState().nodeOutputs[id]?.value
    const valueLine = outputVal !== undefined
      ? { label: 'output:', text: formatPortValue(outputVal), extra: formatPortValueExtra(outputVal) }
      : { label: 'output:', text: langMode === 'zh' ? '暂无计算结果' : 'no result', muted: true as const }
    showImmediate({
      x: e.clientX + 16, y: e.clientY - 8,
      title: langMode === 'zh' ? 'JSON' : 'value',
      subtitle: 'String', subtitleColor: outputColor,
      description: 'JSON file content (string)',
      valueLine,
    })
  }, [id, langMode, outputColor, showImmediate])

  const showBatteryTooltip = useCallback(() => {
    const batteryDesc = langMode === 'zh' ? battery.description : (battery.descriptionEn || battery.description)
    showDelayed({
      title: langMode === 'zh' ? battery.name : formatIdAsLabel(battery.id),
      subtitle: battery.version ? `v${battery.version}` : undefined,
      tagLine: getBatteryTagLine(battery.type, battery.category ?? 'special'),
      tagLineColor: getBatteryTypeColor(battery.type),
      description: batteryDesc,
    } satisfies BatteryTooltipState)
  }, [battery, langMode, showDelayed])

  return (
    <div
      className={`json-node ${selected ? 'selected' : ''}`}
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
    >
      <NodeResizer
        minWidth={160}
        minHeight={100}
        isVisible={selected}
        lineClassName="json-resize-line"
        handleClassName="json-resize-handle"
        onResizeEnd={(_event, params) => {
          updateNodeParam(id, '_nodeWidth', params.width, true)
          updateNodeParam(id, '_nodeHeight', params.height, true)
          schedulePersistSession('json-node-resize')
        }}
      />

      {/* Title bar. */}
      <div className="node-header json-node-header">
        <span className="node-title">
          {langMode === 'zh' ? battery.name : formatIdAsLabel(battery.id)}
        </span>
        <span className="json-badge">JSON</span>
      </div>

      {/* JSON content preview area. */}
      <div className="json-preview">
        {previewContent
          ? <pre className="json-preview-content">{previewContent}</pre>
          : <span className="json-preview-empty">No content</span>
        }
      </div>

      {/* value output port (events bound directly on the Handle). */}
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

export default memo(JsonNode)
