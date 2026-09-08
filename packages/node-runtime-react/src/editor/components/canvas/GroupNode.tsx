// Group node: collapses several batteries into one composite node that exposes
// boundary input/output ports, supports ungroup/restore, double-click rename,
// per-port rename + drag reorder + hide, and entering the inner group view.
// Ported from the legacy editor (components/canvas/GroupNode.tsx).
import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps, useUpdateNodeInternals } from 'reactflow'
import { getPortTypeColor, normalizeType, type DomainPortTypes } from '../../utils/portTypes.js'
import { usePipelineStore, useHistoryStore, useUIStore } from '../../stores/index.js'
import type { Battery, NodeGroup, ExposedPort } from '../../types.js'
import {
  useNodeTooltip,
  TooltipPortal,
  resolveInputPortValue,
  useNodeValueFormatters,
} from './nodeTooltip.js'
import { ContextMenuPortal, type ContextMenuState, PortOptionsPicker } from './BatteryNode.js'
import { GroupSaveDialog } from './GroupSaveDialog.js'
import { RELAY_BATTERY_ID } from './RelayNode.js'
import { getGroupPortDisplayLabel, getVisibleGroupPorts, sortGroupPorts } from './groupViewUtils.js'
import './GroupNode.css'

export interface GroupNodeData {
  groupId: string
  groupName: string
  exposedInputs: ExposedPort[]
  exposedOutputs: ExposedPort[]
  /** Injected by Canvas: ungroup callback. */
  onUngroup?: (groupId: string) => void
  /** Injected by Canvas: enter-group-view callback. */
  onEnterGroup?: (groupId: string) => void
}

// Resolve the effective port type for an exposed port: for a relay inner node
// follow its configured portType; for an 'any' port fall back to the inner
// battery's port metadata type.
function resolveEffectiveExposedPort(
  group: NodeGroup | undefined,
  port: ExposedPort,
  direction: 'input' | 'output',
  batteries: Battery[],
): ExposedPort {
  const innerNode = group?.nodes.find((n) => n.id === port.sourceNodeId)
  if (!innerNode) return port
  if (innerNode.batteryId === RELAY_BATTERY_ID) {
    const relayPortType = typeof innerNode.params?.portType === 'string'
      ? innerNode.params.portType
      : port.portType
    return relayPortType !== port.portType ? { ...port, portType: relayPortType } : port
  }
  if (port.portType !== 'any') return port
  const battery = batteries.find((b) => b.id === innerNode.batteryId)
  const metaPort = direction === 'input'
    ? battery?.inputs.find((p) => p.name === port.sourcePortName)
    : battery?.outputs.find((p) => p.name === port.sourcePortName)
  return metaPort?.type && metaPort.type !== port.portType
    ? { ...port, portType: metaPort.type }
    : port
}

/** Synthesise a Battery shell from a NodeGroup so a saved group can live in Favorites. */
function buildGroupFavoriteBattery(group: NodeGroup, fallbackName: string): Battery {
  return {
    id: group.id,
    name: group.name || fallbackName,
    nameEn: group.nameEn || group.name || fallbackName,
    type: 'group',
    category: 'groups',
    displayGroup: 'groups',
    description: 'Saved group battery',
    descriptionEn: 'Saved group battery',
    version: '1.0.0',
    inputs: group.exposedInputs.map((port) => ({
      name: port.portName,
      type: port.portType,
      label: port.customLabel || port.portLabel || port.portName,
      description: '',
    })),
    outputs: group.exposedOutputs.map((port) => ({
      name: port.portName,
      type: port.portType,
      label: port.customLabel || port.portLabel || port.portName,
      description: '',
    })),
    params: [],
  }
}

const GroupNode = memo(function GroupNode({ id, data, selected, dragging, domainPortTypes }: NodeProps<GroupNodeData> & { domainPortTypes?: DomainPortTypes }) {
  const { groupId, groupName, exposedInputs, exposedOutputs, onUngroup, onEnterGroup } = data
  const updateNodeInternals = useUpdateNodeInternals()

  const langMode = useUIStore((s) => s.langMode)
  const en = langMode === 'en'

  const renameGroup                = usePipelineStore((s) => s.renameGroup)
  const nodeOutputs                = usePipelineStore((s) => s.nodeOutputs)
  const setNodePreview             = usePipelineStore((s) => s.setNodePreview)
  const updateGroupInnerNodeParam  = usePipelineStore((s) => s.updateGroupInnerNodeParam)
  const updateGroupPort            = usePipelineStore((s) => s.updateGroupPort)
  const moveGroupPort              = usePipelineStore((s) => s.moveGroupPort)
  const batteries                  = usePipelineStore((s) => s.batteries)
  const pipelineEdges              = usePipelineStore((s) => s.currentPipeline?.edges ?? [])
  const previewEnabled = usePipelineStore(
    useCallback((s) => s.currentPipeline?.nodes.find((n) => n.id === id)?.previewEnabled !== false, [id]),
  )

  const currentGroup = usePipelineStore(
    useCallback((s) => (s.currentPipeline?.groups ?? []).find((g) => g.id === groupId), [groupId]),
  )

  const rawInputs = currentGroup?.exposedInputs ?? exposedInputs
  const rawOutputs = currentGroup?.exposedOutputs ?? exposedOutputs
  const sortedInputs = sortGroupPorts(rawInputs)
  const sortedOutputs = sortGroupPorts(rawOutputs)
  const hiddenPorts = [...sortedInputs, ...sortedOutputs].filter((port) => port.hidden)
  const connectedInputPorts = new Set(
    pipelineEdges.filter((edge) => edge.target.nodeId === id).map((edge) => edge.target.port),
  )
  const connectedOutputPorts = new Set(
    pipelineEdges.filter((edge) => edge.source.nodeId === id).map((edge) => edge.source.port),
  )

  // Merge ExposedPort with battery metadata to backfill type/options fields that
  // may be missing in older group JSON.
  const enrichedInputs = getVisibleGroupPorts(rawInputs).map((ep) => {
    const typedPort = resolveEffectiveExposedPort(currentGroup, ep, 'input', batteries)
    if (typedPort.options?.length) return typedPort
    const innerNode = currentGroup?.nodes.find((n) => n.id === ep.sourceNodeId)
    if (!innerNode) return typedPort
    const battery = batteries.find((b) => b.id === innerNode.batteryId)
    const portMeta = battery?.inputs.find((p) => p.name === ep.sourcePortName)
    if (!portMeta?.options?.length) return typedPort
    return { ...typedPort, options: portMeta.options }
  })

  const enrichedOutputs = getVisibleGroupPorts(rawOutputs).map((ep) =>
    resolveEffectiveExposedPort(currentGroup, ep, 'output', batteries),
  )
  const inputLayoutKey = enrichedInputs.map((port) => `${port.portName}:${port.order ?? ''}`).join('|')
  const outputLayoutKey = enrichedOutputs.map((port) => `${port.portName}:${port.order ?? ''}`).join('|')

  // Selected value per options port (key = exposedPort.portName), initialized
  // from the inner node's params.
  const [portSelections, setPortSelections] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    const { currentPipeline } = usePipelineStore.getState()
    const group = (currentPipeline?.groups ?? []).find((g) => g.id === groupId)
    for (const ep of enrichedInputs) {
      if (!ep.options?.length) continue
      const innerNode = group?.nodes.find((n) => n.id === ep.sourceNodeId)
      const stored = innerNode?.params[ep.sourcePortName]
      init[ep.portName] = typeof stored === 'string' ? stored : (ep.options[0] ?? '')
    }
    return init
  })

  // Once battery metadata loads (async), backfill missing options-port initial
  // selections.
  useEffect(() => {
    const { currentPipeline } = usePipelineStore.getState()
    const group = (currentPipeline?.groups ?? []).find((g) => g.id === groupId)
    const patch: Record<string, string> = {}
    for (const ep of enrichedInputs) {
      if (!ep.options?.length) continue
      if (portSelections[ep.portName] !== undefined) continue
      const innerNode = group?.nodes.find((n) => n.id === ep.sourceNodeId)
      const stored = innerNode?.params[ep.sourcePortName]
      patch[ep.portName] = typeof stored === 'string' ? stored : (ep.options[0] ?? '')
    }
    if (Object.keys(patch).length > 0) {
      setPortSelections((prev) => ({ ...patch, ...prev }))
    }
    // enrichedInputs is driven by batteries; re-run when batteries change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batteries, groupId])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateNodeInternals(id)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [id, inputLayoutKey, outputLayoutKey, updateNodeInternals])

  const handlePortOptionChange = useCallback(
    (ep: ExposedPort, v: string) => {
      setPortSelections((prev) => ({ ...prev, [ep.portName]: v }))
      updateGroupInnerNodeParam(groupId, ep.sourceNodeId, ep.sourcePortName, v)
    },
    [groupId, updateGroupInnerNodeParam],
  )

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(groupName)
  const [editingPort, setEditingPort] = useState<{ direction: 'input' | 'output'; portName: string } | null>(null)
  const [portLabelDraft, setPortLabelDraft] = useState('')
  const draggingPortRef = useRef<{ direction: 'input' | 'output'; portName: string } | null>(null)
  const dragOverPortRef = useRef<{ direction: 'input' | 'output'; portName: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [showSaveDialog, setShowSaveDialog] = useState(false)

  const { tooltip, showImmediate, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()

  // Sync external name changes (undo/redo may change groupName).
  useEffect(() => {
    if (!editing) setEditName(groupName)
  }, [groupName, editing])

  const startEdit = useCallback(() => {
    setEditing(true)
    setEditName(groupName)
    setTimeout(() => inputRef.current?.select(), 0)
  }, [groupName])

  const commitEdit = useCallback(() => {
    const trimmed = editName.trim() || groupName
    renameGroup(groupId, trimmed)
    setEditing(false)
  }, [editName, groupName, groupId, renameGroup])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditing(false)
    e.stopPropagation()
  }, [commitEdit])

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const { selectedNodeIds, currentPipeline } = usePipelineStore.getState()
    const nodePreview = currentPipeline?.nodes.find((n) => n.id === id)?.previewEnabled !== false
    const targetIds = selectedNodeIds.length > 1 && selectedNodeIds.includes(id) ? selectedNodeIds : [id]

    // Favorite a group: store a synthetic group battery in the shared favorites
    // store (same store the left sidebar FavoritesPanel renders).
    const group = currentPipeline?.groups?.find((g) => g.id === groupId) ?? currentGroup
    const { favoriteBatteries, addFavoriteBattery, removeFavoriteBattery } = useUIStore.getState()
    const isFavorite = favoriteBatteries.some((f) => f.batteryId === groupId)
    const extraItems = group
      ? [
          {
            label: isFavorite ? '⭐ Remove from Favorites' : '⭐ Add to Favorites',
            onClick: () => {
              if (isFavorite) removeFavoriteBattery(groupId)
              else addFavoriteBattery(buildGroupFavoriteBattery(group, groupName))
            },
          },
        ]
      : undefined

    setContextMenu({ x: e.clientX, y: e.clientY, nodeIds: targetIds, previewEnabled: nodePreview, extraItems })
    hide()
  }, [id, groupId, currentGroup, groupName, hide])

  const handlePreviewAction = useCallback((nodeIds: string[], enabled: boolean) => {
    const isBatch = nodeIds.length > 1
    const previewLabel = isBatch
      ? `${enabled ? 'Enable' : 'Disable'} preview (${nodeIds.length} node(s))`
      : `${enabled ? 'Enable' : 'Disable'} preview: ${groupName}`
    const previewLabelEn = isBatch
      ? `${enabled ? 'Enable' : 'Disable'} preview (${nodeIds.length} nodes)`
      : `${enabled ? 'Enable' : 'Disable'} preview: ${groupName}`
    const { currentPipeline } = usePipelineStore.getState()
    if (currentPipeline) {
      useHistoryStore.getState().record('toggle_preview', currentPipeline, {
        nodeIds,
        label: previewLabel,
        labelEn: previewLabelEn,
      })
    }
    setNodePreview(nodeIds, enabled)
  }, [setNodePreview, groupName])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleUngroup = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onUngroup?.(groupId)
  }, [groupId, onUngroup])

  const handleEnterGroup = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onEnterGroup?.(groupId)
  }, [groupId, onEnterGroup])

  const handleSaveClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    hide()
    setShowSaveDialog(true)
  }, [hide])

  const startPortEdit = useCallback((direction: 'input' | 'output', port: ExposedPort) => {
    setEditingPort({ direction, portName: port.portName })
    setPortLabelDraft(getGroupPortDisplayLabel(port, en))
  }, [en])

  const commitPortEdit = useCallback((direction: 'input' | 'output', port: ExposedPort) => {
    const trimmed = portLabelDraft.trim()
    updateGroupPort(groupId, direction, port.portName, {
      [en ? 'customLabelEn' : 'customLabel']: trimmed || undefined,
    })
    setEditingPort(null)
  }, [en, groupId, portLabelDraft, updateGroupPort])

  const hidePort = useCallback((direction: 'input' | 'output', port: ExposedPort) => {
    const result = updateGroupPort(groupId, direction, port.portName, { hidden: true })
    if (!result.ok && result.reason) console.warn(`[GroupNode] hide port failed: ${result.reason}`)
  }, [groupId, updateGroupPort])

  const restoreHiddenPorts = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    for (const port of sortedInputs) {
      if (port.hidden) updateGroupPort(groupId, 'input', port.portName, { hidden: false })
    }
    for (const port of sortedOutputs) {
      if (port.hidden) updateGroupPort(groupId, 'output', port.portName, { hidden: false })
    }
  }, [groupId, sortedInputs, sortedOutputs, updateGroupPort])

  const commitPortReorder = useCallback((direction: 'input' | 'output', targetPortName: string) => {
    const dragged = draggingPortRef.current
    if (!dragged || dragged.direction !== direction || dragged.portName === targetPortName) return
    const ports = direction === 'input' ? sortGroupPorts(rawInputs) : sortGroupPorts(rawOutputs)
    const from = ports.findIndex((port) => port.portName === dragged.portName)
    const to = ports.findIndex((port) => port.portName === targetPortName)
    if (from < 0 || to < 0) return
    const step: -1 | 1 = from < to ? 1 : -1
    for (let i = from; i !== to; i += step) {
      moveGroupPort(groupId, direction, dragged.portName, step)
    }
    draggingPortRef.current = null
    dragOverPortRef.current = null
  }, [groupId, moveGroupPort, rawInputs, rawOutputs])

  const handlePortDrop = useCallback((direction: 'input' | 'output', targetPort: ExposedPort) => {
    commitPortReorder(direction, targetPort.portName)
  }, [commitPortReorder])

  const finishPortDrag = useCallback(() => {
    const target = dragOverPortRef.current
    if (target) commitPortReorder(target.direction, target.portName)
    draggingPortRef.current = null
    dragOverPortRef.current = null
  }, [commitPortReorder])

  // English-mode title: prefer the group JSON nameEn, fall back to empty (do not
  // format the groupId — it has no semantics).
  const displayName = en ? (currentGroup?.nameEn || groupName) : groupName

  return (
    <div
      className={`group-node${selected ? ' selected' : ''}${!previewEnabled ? ' preview-disabled' : ''}`}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
      onContextMenu={handleContextMenu}
    >
      {tooltip && <TooltipPortal tooltip={tooltip} />}
      {contextMenu && (
        <ContextMenuPortal menu={contextMenu} onClose={closeContextMenu} onAction={handlePreviewAction} />
      )}
      {showSaveDialog && currentGroup && (
        <GroupSaveDialog group={currentGroup} onClose={() => setShowSaveDialog(false)} />
      )}
      {/* Header: group name + save / enter / ungroup buttons. */}
      <div className="group-node__header">
        {editing ? (
          <input
            ref={inputRef}
            className="group-node__name-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        ) : (
          <span
            className="group-node__name"
            onDoubleClick={startEdit}
            title={en ? 'Double-click to rename' : '双击重命名'}
          >
            {displayName}
          </span>
        )}
        {!previewEnabled && <span className="preview-off-indicator">{en ? 'Preview Off' : '预览关闭'}</span>}
        <div className="group-node__actions">
          {/* Save to battery library. */}
          <button
            className="group-node__action-btn group-node__action-btn--save"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleSaveClick}
            title={en ? 'Save to library' : '保存到电池库'}
          >
            <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 10.5V12h10v-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M7 2v7m0 0L4.5 6.5M7 9l2.5-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {/* Restore hidden ports. */}
          <button
            className="group-node__action-btn group-node__action-btn--restore"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={restoreHiddenPorts}
            disabled={hiddenPorts.length === 0}
            title={hiddenPorts.length > 0 ? (en ? 'Restore hidden ports' : '恢复隐藏端口') : (en ? 'No hidden ports' : '没有隐藏端口')}
          >
            <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 7s1.8-3 5-3 5 3 5 3-1.8 3-5 3-5-3-5-3Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="7" cy="7" r="1.4" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
          {/* Enter the inner group view. */}
          <button
            className="group-node__action-btn group-node__action-btn--enter"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleEnterGroup}
            title={en ? 'Enter group view' : '进入组内视图'}
          >
            <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.5 2H12v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 2L7.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M6 3H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {/* Ungroup. */}
          <button
            className="group-node__action-btn group-node__action-btn--ungroup"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleUngroup}
            title={en ? 'Ungroup' : '展开组合'}
          >
            <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="8" y="1.5" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="1.5" y="8" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="8" y="8" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Port area. */}
      <div className="group-node__ports">
        {/* Input port column. */}
        <div className="group-node__inputs">
          {enrichedInputs.map((port) => {
            const color = getPortTypeColor(port.portType, domainPortTypes)
            const typeLabel = normalizeType(port.portType)
            const typeDisplay = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)
            const portDisplayLabel = getGroupPortDisplayLabel(port, en)
            const isEditingPort = editingPort?.direction === 'input' && editingPort.portName === port.portName
            const isConnected = connectedInputPorts.has(port.portName)
            return (
              <div
                key={port.portName}
                className="group-node__port group-node__port--input nodrag"
                onMouseDown={(e) => e.stopPropagation()}
                onDragOver={(e) => {
                  if (draggingPortRef.current?.direction === 'input') {
                    dragOverPortRef.current = { direction: 'input', portName: port.portName }
                    e.preventDefault()
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handlePortDrop('input', port)
                }}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={port.portName}
                  style={{ background: color, border: `2px solid ${color}` }}
                  onMouseEnter={(e) => {
                    const val = resolveInputPortValue(groupId, port.portName)
                    const text = formatPortValue(val)
                    const extra = Array.isArray(val) || (val !== null && typeof val === 'object')
                      ? formatPortValueExtra(val) : undefined
                    showImmediate({
                      x: e.clientX + 16, y: e.clientY - 8,
                      title: portDisplayLabel,
                      subtitle: typeDisplay,
                      subtitleColor: color,
                      valueLine: { label: 'value', text, extra, muted: val === undefined },
                    })
                  }}
                  onMouseLeave={hide}
                />
                {isEditingPort ? (
                  <input
                    className="group-node__port-label-input nodrag"
                    value={portLabelDraft}
                    autoFocus
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => setPortLabelDraft(e.target.value)}
                    onBlur={() => commitPortEdit('input', port)}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') commitPortEdit('input', port)
                      if (e.key === 'Escape') setEditingPort(null)
                    }}
                  />
                ) : (
                  <span
                    className="group-node__port-label"
                    draggable
                    style={{ color }}
                    onDragStart={(e) => {
                      e.stopPropagation()
                      const nextDraggingPort = { direction: 'input' as const, portName: port.portName }
                      draggingPortRef.current = nextDraggingPort
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', port.portName)
                    }}
                    onDragEnd={finishPortDrag}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      startPortEdit('input', port)
                    }}
                    title={en ? 'Double-click rename, drag reorder' : '双击重命名，拖动排序'}
                  >
                    {portDisplayLabel}
                  </span>
                )}
                {port.options && port.options.length > 0 && (
                  <PortOptionsPicker
                    value={portSelections[port.portName] ?? port.options[0] ?? ''}
                    options={port.options}
                    onChange={(v) => handlePortOptionChange(port, v)}
                  />
                )}
                <button
                  className="group-node__port-hide nodrag"
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={isConnected}
                  onClick={() => hidePort('input', port)}
                  title={isConnected
                    ? (en ? 'Disconnect this port before hiding' : '请先断开该端口连线再隐藏')
                    : (en ? 'Hide port' : '隐藏端口')}
                >
                  −
                </button>
              </div>
            )
          })}
        </div>

        {/* Output port column. */}
        <div className="group-node__outputs">
          {enrichedOutputs.map((port) => {
            const color = getPortTypeColor(port.portType, domainPortTypes)
            const typeLabel = normalizeType(port.portType)
            const typeDisplay = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)
            const portDisplayLabel = getGroupPortDisplayLabel(port, en)
            const isEditingPort = editingPort?.direction === 'output' && editingPort.portName === port.portName
            const isConnected = connectedOutputPorts.has(port.portName)
            return (
              <div
                key={port.portName}
                className="group-node__port group-node__port--output nodrag"
                onMouseDown={(e) => e.stopPropagation()}
                onDragOver={(e) => {
                  if (draggingPortRef.current?.direction === 'output') {
                    dragOverPortRef.current = { direction: 'output', portName: port.portName }
                    e.preventDefault()
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handlePortDrop('output', port)
                }}
              >
                <button
                  className="group-node__port-hide nodrag"
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={isConnected}
                  onClick={() => hidePort('output', port)}
                  title={isConnected
                    ? (en ? 'Disconnect this port before hiding' : '请先断开该端口连线再隐藏')
                    : (en ? 'Hide port' : '隐藏端口')}
                >
                  −
                </button>
                {isEditingPort ? (
                  <input
                    className="group-node__port-label-input nodrag"
                    value={portLabelDraft}
                    autoFocus
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => setPortLabelDraft(e.target.value)}
                    onBlur={() => commitPortEdit('output', port)}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') commitPortEdit('output', port)
                      if (e.key === 'Escape') setEditingPort(null)
                    }}
                  />
                ) : (
                  <span
                    className="group-node__port-label"
                    draggable
                    style={{ color }}
                    onDragStart={(e) => {
                      e.stopPropagation()
                      const nextDraggingPort = { direction: 'output' as const, portName: port.portName }
                      draggingPortRef.current = nextDraggingPort
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', port.portName)
                    }}
                    onDragEnd={finishPortDrag}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      startPortEdit('output', port)
                    }}
                    title={en ? 'Double-click rename, drag reorder' : '双击重命名，拖动排序'}
                  >
                    {portDisplayLabel}
                  </span>
                )}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={port.portName}
                  style={{ background: color, border: `2px solid ${color}` }}
                  onMouseEnter={(e) => {
                    const val = nodeOutputs[groupId]?.[port.portName]
                    const text = formatPortValue(val)
                    const extra = Array.isArray(val) || (val !== null && typeof val === 'object')
                      ? formatPortValueExtra(val) : undefined
                    showImmediate({
                      x: e.clientX + 16, y: e.clientY - 8,
                      title: portDisplayLabel,
                      subtitle: typeDisplay,
                      subtitleColor: color,
                      valueLine: { label: 'value', text, extra, muted: val === undefined },
                    })
                  }}
                  onMouseLeave={hide}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Inner-node count badge. */}
      <div className="group-node__footer">
        <span className="group-node__count-badge">{en ? 'Collapsed' : '已折叠'}</span>
      </div>
    </div>
  )
})

export default GroupNode

/** Build GroupNodeData from a NodeGroup (shared by Canvas and session restore). */
export function buildGroupNodeData(
  group: NodeGroup,
  onUngroup: (groupId: string) => void,
  onEnterGroup?: (groupId: string) => void,
): GroupNodeData {
  return {
    groupId: group.id,
    groupName: group.name,
    exposedInputs: group.exposedInputs,
    exposedOutputs: group.exposedOutputs,
    onUngroup,
    onEnterGroup,
  }
}
