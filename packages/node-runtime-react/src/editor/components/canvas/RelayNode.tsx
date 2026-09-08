// Editor-style relay node: passes input -> output, used to tidy cables.
// Ported verbatim from the legacy editor (components/canvas/RelayNode.tsx).
import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { getPortTypeColor, normalizeType, type DomainPortTypes } from '../../utils/portTypes.js'
import './RelayNode.css'

export const RELAY_BATTERY_ID = '__relay__'
export const RELAY_INPUT_PORT = 'input'
export const RELAY_OUTPUT_PORT = 'output'
const RELAY_LABEL_CHAR_WIDTH = 6.5
const RELAY_LABEL_GAP = 20
const RELAY_LABEL_PADDING_X = 12

export const RELAY_NODE_HEIGHT = 28
export const RELAY_NODE_WIDTH = Math.max(
  96,
  Math.ceil((RELAY_INPUT_PORT.length + RELAY_OUTPUT_PORT.length) * RELAY_LABEL_CHAR_WIDTH + RELAY_LABEL_GAP + RELAY_LABEL_PADDING_X * 2),
)

interface RelayNodeData {
  portType?: string
}

function RelayNode({ data, selected, domainPortTypes }: NodeProps<RelayNodeData> & { domainPortTypes?: DomainPortTypes }) {
  const portType = normalizeType(data?.portType || 'any')
  const color = portType === 'any' ? 'var(--color-accent)' : getPortTypeColor(portType, domainPortTypes)

  return (
    <div
      className={`relay-node${selected ? ' relay-node--selected' : ''}`}
      style={{ '--relay-color': color } as React.CSSProperties}
      title={`Relay (${RELAY_INPUT_PORT} -> ${RELAY_OUTPUT_PORT}, ${portType})`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={RELAY_INPUT_PORT}
        className="relay-node__handle relay-node__handle--input"
        style={{ backgroundColor: color, borderColor: color }}
      />
      <span className="relay-node__label relay-node__label--input">{RELAY_INPUT_PORT}</span>
      <div className="relay-node__core" aria-hidden="true" />
      <span className="relay-node__label relay-node__label--output">{RELAY_OUTPUT_PORT}</span>
      <Handle
        type="source"
        position={Position.Right}
        id={RELAY_OUTPUT_PORT}
        className="relay-node__handle relay-node__handle--output"
        style={{ backgroundColor: color, borderColor: color }}
      />
    </div>
  )
}

export default memo(RelayNode)
