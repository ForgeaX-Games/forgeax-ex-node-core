// Data-probe edge component: overrides ReactFlow's default 'default' edge type.
// With probe mode off it behaves exactly like a standard bezier edge; with
// probe mode on it renders a type badge + value pill at the edge midpoint.
// Ported verbatim from the legacy editor (components/canvas/ProbeEdge.tsx),
// retargeted onto the editor stores + utils.
import { useState, useEffect, useRef } from 'react'
import { type EdgeProps, getBezierPath, EdgeLabelRenderer, BaseEdge } from 'reactflow'
import { useUIStore, usePipelineStore } from '../../stores/index.js'
import { normalizeType, getPortTypeColor, type DomainPortTypes } from '../../utils/portTypes.js'
import { getPortAccess, formatDataTreeSummary } from '../../utils/datatreeShape.js'
import { useNodeValueFormatters } from './nodeTooltip.js'
import { RELAY_BATTERY_ID, RELAY_INPUT_PORT, RELAY_OUTPUT_PORT } from './RelayNode.js'
import type { Battery, BatteryPort } from '../../types.js'
import './ProbeEdge.css'

export function ProbeEdge({
  id,
  source,
  sourceHandleId,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  markerStart,
  domainPortTypes,
}: EdgeProps & { domainPortTypes?: DomainPortTypes }) {
  const probeMode = useUIStore((s) => s.probeMode)
  const [expanded, setExpanded] = useState(false)
  const pillRef = useRef<HTMLDivElement>(null)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()

  const probeValue = usePipelineStore((s) => {
    if (!probeMode || !source || !sourceHandleId) return undefined

    const directValue = s.nodeOutputs[source]?.[sourceHandleId]
    if (directValue !== undefined) return directValue

    const sourceNode = s.currentPipeline?.nodes.find((n) => n.id === source)
    if (sourceNode?.batteryId !== RELAY_BATTERY_ID || sourceHandleId !== RELAY_OUTPUT_PORT) {
      return undefined
    }

    const relayInputEdge = s.currentPipeline?.edges.find(
      (edge) => edge.target.nodeId === source && edge.target.port === RELAY_INPUT_PORT,
    )
    if (!relayInputEdge) return undefined
    return s.nodeOutputs[relayInputEdge.source.nodeId]?.[relayInputEdge.source.port]
  })

  const portMeta = usePipelineStore((s) => {
    if (!probeMode || !source || !sourceHandleId) return { type: 'any' } as BatteryPort

    const pipelineNode = s.currentPipeline?.nodes.find((n) => n.id === source)
    if (!pipelineNode) return { type: 'any' } as BatteryPort

    if (pipelineNode.batteryId === RELAY_BATTERY_ID && sourceHandleId === RELAY_OUTPUT_PORT) {
      const relayType =
        typeof pipelineNode.params?.portType === 'string' ? pipelineNode.params.portType : 'any'

      const relayInputEdge = s.currentPipeline?.edges.find(
        (edge) => edge.target.nodeId === source && edge.target.port === RELAY_INPUT_PORT,
      )
      const upstreamNode = relayInputEdge
        ? s.currentPipeline?.nodes.find((n) => n.id === relayInputEdge.source.nodeId)
        : undefined
      const upstreamBattery = upstreamNode
        ? s.batteries.find((b: Battery) => b.id === upstreamNode.batteryId)
        : undefined
      const upstreamPort = upstreamBattery?.outputs.find(
        (o: BatteryPort) => o.name === relayInputEdge?.source.port,
      )
      const upstreamDynPort = relayInputEdge
        ? s.dynamicOutputPorts[relayInputEdge.source.nodeId]?.find(
            (p) => p.name === relayInputEdge.source.port,
          )
        : undefined

      return {
        ...(upstreamPort ?? upstreamDynPort),
        name: RELAY_OUTPUT_PORT,
        label: upstreamPort?.label ?? upstreamDynPort?.label ?? RELAY_OUTPUT_PORT,
        type: relayType,
      } as BatteryPort
    }

    const battery: Battery | undefined = s.batteries.find(
      (b: Battery) => b.id === pipelineNode.batteryId,
    )

    if (battery?.outputs) {
      const staticPort = battery.outputs.find((o: BatteryPort) => o.name === sourceHandleId)
      if (staticPort) return staticPort
    }

    const dynPorts = s.dynamicOutputPorts[source]
    if (dynPorts) {
      const dynPort = dynPorts.find((p) => p.name === sourceHandleId)
      if (dynPort) return dynPort
    }

    return { type: 'any' } as BatteryPort
  })

  useEffect(() => {
    if (!expanded) return
    const handler = (e: PointerEvent) => {
      if (pillRef.current && pillRef.current.contains(e.target as Node)) return
      setExpanded(false)
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [expanded])

  useEffect(() => {
    if (!probeMode) setExpanded(false)
  }, [probeMode])

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const portType = normalizeType(portMeta.type)
  const typeColor = getPortTypeColor(portType, domainPortTypes)
  const hasValue = probeMode && probeValue !== undefined
  const summaryText = hasValue ? formatPortValue(probeValue) : 'no output'
  const extraText = hasValue ? formatPortValueExtra(probeValue) : undefined
  const treeInfoText = hasValue
    ? (() => {
        const summary = formatDataTreeSummary(probeValue)
        const accessLine = `access ${getPortAccess(portMeta)}`
        return summary ? `${summary} · ${accessLine}` : accessLine
      })()
    : undefined

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} markerStart={markerStart} />
      {probeMode &&
        (sourceX !== 0 || sourceY !== 0 || targetX !== 0 || targetY !== 0) &&
        (labelX !== 0 || labelY !== 0) && (
          <EdgeLabelRenderer>
            <div
              ref={pillRef}
              className={`probe-label nodrag nopan${expanded ? ' probe-label--expanded' : ''}`}
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                pointerEvents: 'all',
                cursor: 'pointer',
              }}
              onClick={(e) => {
                e.stopPropagation()
                setExpanded((v) => !v)
              }}
            >
              <div className="probe-pill-row">
                <span
                  className="probe-type-badge"
                  style={{
                    backgroundColor: typeColor + '28',
                    borderColor: typeColor + '99',
                    color: typeColor,
                  }}
                >
                  {portType.charAt(0).toUpperCase()}
                </span>
                <span className={`probe-value-text${!hasValue ? ' probe-no-value' : ''}`}>
                  {summaryText}
                </span>
              </div>

              {expanded && (
                <div className="probe-expanded-panel">
                  <div className="probe-expanded-header">
                    <span className="probe-expanded-type" style={{ color: typeColor }}>
                      {portType.charAt(0).toUpperCase() + portType.slice(1)}
                    </span>
                    {sourceHandleId && <span className="probe-expanded-port">{sourceHandleId}</span>}
                  </div>
                  <div className="probe-expanded-summary">{summaryText}</div>
                  {extraText && <div className="probe-expanded-extra">{extraText}</div>}
                  {treeInfoText && <div className="probe-expanded-tree-info">{treeInfoText}</div>}
                </div>
              )}
            </div>
          </EdgeLabelRenderer>
        )}
    </>
  )
}

export default ProbeEdge
