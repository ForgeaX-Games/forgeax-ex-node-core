// Group boundary placeholder node: represents a group's exposed input/output
// ports inside the group view; cannot be deleted. Ported from the legacy editor
// (components/canvas/GroupBoundaryNode.tsx).
import { memo, useCallback, useMemo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { getPortTypeColor, type DomainPortTypes } from '../../utils/portTypes.js'
import type { ExposedPort } from '../../types.js'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import { getGroupPortDisplayLabel, getVisibleGroupPorts } from './groupViewUtils.js'
import './GroupBoundaryNode.css'

export interface GroupBoundaryNodeData {
  /** 'input' = the group's input-boundary node (provides source Handles for inner nodes to connect into)
   *  'output' = the group's output-boundary node (receives target Handles from inner nodes connecting out)
   */
  boundaryType: 'input' | 'output'
  groupId: string
  ports: ExposedPort[]
  /** Display label; defaults to "Group input" / "Group output". */
  label?: string
}

const GroupBoundaryNode = memo(function GroupBoundaryNode({
  data,
  domainPortTypes,
}: NodeProps<GroupBoundaryNodeData> & { domainPortTypes?: DomainPortTypes }) {
  const { boundaryType, groupId, ports: fallbackPorts, label } = data
  const isInput = boundaryType === 'input'
  const en = useUIStore(s => s.langMode === 'en')
  const displayLabel = label ?? (isInput ? (en ? 'Group input' : '组输入') : (en ? 'Group output' : '组输出'))
  const currentGroup = usePipelineStore(
    useCallback((s) => (s.currentPipeline?.groups ?? []).find(g => g.id === groupId), [groupId])
  )

  const ports = useMemo(() => {
    const fallbackByName = new Map(fallbackPorts.map(port => [port.portName, port]))
    const sourcePorts = currentGroup ? getVisibleGroupPorts(
      boundaryType === 'input' ? currentGroup.exposedInputs : currentGroup.exposedOutputs
    ) : getVisibleGroupPorts(fallbackPorts)
    return sourcePorts.map(port => {
      const fallback = fallbackByName.get(port.portName)
      return fallback ? { ...port, portType: fallback.portType } : port
    })
  }, [boundaryType, currentGroup, fallbackPorts])

  return (
    <div className={`group-boundary-node group-boundary-node--${boundaryType}`}>
      <div className="group-boundary-node__header">
        <span className="group-boundary-node__icon">{isInput ? 'IN' : 'OUT'}</span>
        <span className="group-boundary-node__label">{displayLabel}</span>
        <span className="group-boundary-node__count">{ports.length}</span>
      </div>

      <div className="group-boundary-node__ports">
        {ports.map(port => {
          const color = getPortTypeColor(port.portType, domainPortTypes)
          const portDisplayLabel = getGroupPortDisplayLabel(port, en)
          return (
            <div
              key={port.portName}
              className="group-boundary-node__port"
            >
              {/* Input boundary: left receives the external upstream, right keeps the inner mapping exit. */}
              {isInput && (
                <>
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={port.portName}
                    style={{ background: color, border: `2px solid ${color}` }}
                  />
                  <span className="group-boundary-node__port-dot" style={{ background: color }} />
                  <span className="group-boundary-node__port-label" style={{ color }} title={port.portName}>
                    {portDisplayLabel}
                  </span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={port.portName}
                    style={{ background: color, border: `2px solid ${color}` }}
                  />
                </>
              )}

              {/* Output boundary: left receives the inner output, right connects to the external downstream. */}
              {!isInput && (
                <>
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={port.portName}
                    style={{ background: color, border: `2px solid ${color}` }}
                  />
                  <span className="group-boundary-node__port-dot" style={{ background: color }} />
                  <span className="group-boundary-node__port-label" style={{ color }} title={port.portName}>
                    {portDisplayLabel}
                  </span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={port.portName}
                    style={{ background: color, border: `2px solid ${color}` }}
                  />
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})

export default GroupBoundaryNode
