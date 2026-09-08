// Connection logic hook: type-compatibility validation, edge creation, and the
// connectable-handle pulse animation on connect start/end. Ported from the
// legacy editor (components/canvas/useCanvasConnect.ts), retargeted onto the
// editor stores. Covers the battery + relay types and the group / group_input /
// group_output boundary types: a collapsed `group` node resolves its boundary
// ports from exposedInputs/exposedOutputs, and the inner-view group_input /
// group_output boundary nodes resolve from their `ports` list, so cross-group
// wires type-check + colour by the real inner tier instead of a flat `any`.
import { useCallback, useState } from 'react'
import { addEdge } from 'reactflow'
import type { Connection, Node, Edge } from 'reactflow'
import { usePipelineStore, useHistoryStore } from '../../stores/index.js'
import type { BatteryAccess, BatteryPort, ExposedPort } from '../../types.js'
import { getPortTypeColor, isTypeCompatible, normalizeType, type DomainPortTypes } from '../../utils/portTypes.js'
import { RELAY_BATTERY_ID, RELAY_INPUT_PORT, RELAY_OUTPUT_PORT } from './RelayNode.js'

/**
 * Find a group's exposed port by handle id. A collapsed `group` node splits its
 * ports by direction (source → exposedOutputs, target → exposedInputs); the
 * inner-view `group_input` / `group_output` boundary nodes expose both a source
 * and a target handle for the same `ports` list, so direction is ignored there.
 */
function findGroupExposedPort(
  node: Node,
  handleId: string,
  direction: 'source' | 'target',
): ExposedPort | undefined {
  if (node.type === 'group_input' || node.type === 'group_output') {
    return (node.data?.ports as ExposedPort[] | undefined)?.find((p) => p.portName === handleId)
  }
  const list = (direction === 'source' ? node.data?.exposedOutputs : node.data?.exposedInputs) as
    | ExposedPort[]
    | undefined
  return list?.find((p) => p.portName === handleId)
}

function isGroupNode(node: Node | undefined): boolean {
  return node?.type === 'group' || node?.type === 'group_input' || node?.type === 'group_output'
}

/** Resolve a handle's port type from node data (battery + relay + group boundary). */
export function resolveConnectionPortType(
  node: Node | undefined,
  handleId: string | null | undefined,
  direction: 'source' | 'target',
): string | undefined {
  if (!node || !handleId) return undefined
  if (node.data?.battery?.id === RELAY_BATTERY_ID || node.type === 'relay') {
    if (direction === 'target') return handleId === RELAY_INPUT_PORT ? 'any' : undefined
    if (handleId !== RELAY_OUTPUT_PORT) return undefined
    return typeof node.data?.portType === 'string' ? node.data.portType : 'any'
  }
  if (isGroupNode(node)) {
    return findGroupExposedPort(node, handleId, direction)?.portType
  }
  if (direction === 'source') {
    return node.data?.battery?.outputs?.find((o: BatteryPort) => o.name === handleId)?.type
  }
  return node.data?.battery?.inputs?.find((i: BatteryPort) => i.name === handleId)?.type
}

/**
 * Resolve a handle's DataTree access ('item' | 'list' | 'tree') from node data.
 * Used only to lock a `tree_merge` node's behaviour band on the first connect of
 * slot[0]: an 'item'-access upstream takes the item-level concat branch; anything
 * else (list / tree / unknown) keeps the structural-pack default. Relay ports
 * carry no access and return undefined (caller skips writing inferred*).
 *
 * Group / group_input / group_output boundary ports mirror the inner source
 * port's access (resolved at createGroup time), so a group output feeding a
 * tree_merge slot locks the same item/list tier the inner battery would.
 */
function resolvePortAccess(
  node: Node | undefined,
  handleId: string | null | undefined,
  direction: 'source' | 'target',
): BatteryAccess | undefined {
  if (!node || !handleId) return undefined
  if (node.data?.battery?.id === RELAY_BATTERY_ID || node.type === 'relay') return undefined
  if (isGroupNode(node)) {
    return findGroupExposedPort(node, handleId, direction)?.access
  }
  if (direction === 'source') {
    return node.data?.battery?.outputs?.find((o: BatteryPort) => o.name === handleId)?.access
  }
  return node.data?.battery?.inputs?.find((i: BatteryPort) => i.name === handleId)?.access
}

interface UseCanvasConnectParams {
  nodes: Node[]
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  domainPortTypes?: DomainPortTypes
}

export function useCanvasConnect({ nodes, setEdges, setNodes, domainPortTypes }: UseCanvasConnectParams) {
  const addPipelineEdge = usePipelineStore((s) => s.addEdge)
  const removePipelineEdge = usePipelineStore((s) => s.removeEdge)
  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const incrementalExecute = usePipelineStore((s) => s.incrementalExecute)

  // Preview-line colour while dragging a connection (follows source port type).
  const [connectLineColor, setConnectLineColor] = useState<string>('var(--color-accent)')

  /** Type-compatibility validation: same type / any / matrix allows, else reject. */
  const isValidConnection = useCallback(
    (connection: Connection) => {
      if (connection.source === connection.target) return false

      const sourceNode = nodes.find((n) => n.id === connection.source)
      const targetNode = nodes.find((n) => n.id === connection.target)

      const sourceType = resolveConnectionPortType(sourceNode, connection.sourceHandle, 'source')
      const targetType = resolveConnectionPortType(targetNode, connection.targetHandle, 'target')

      // tree_merge later-slot lock: slot[0]'s first connect wrote inferred*; every
      // slot[i>0] must match the locked access (and type) so the function takes
      // the same behaviour band for every input.
      const targetBatteryId = targetNode?.data?.battery?.id
      const targetHandle = connection.targetHandle
      if (
        targetBatteryId === 'tree_merge' &&
        targetHandle &&
        targetHandle !== 'item_0' &&
        targetHandle.startsWith('item_')
      ) {
        const lockedAccess = targetNode?.data?.params?.inferredAccess as BatteryAccess | undefined
        const lockedType = targetNode?.data?.params?.inferredType as string | undefined
        if (lockedAccess !== undefined) {
          const sourceAccess = resolvePortAccess(sourceNode, connection.sourceHandle, 'source')
          if (sourceAccess !== undefined && sourceAccess !== lockedAccess) return false
          if (lockedType && sourceType && !isTypeCompatible(sourceType, lockedType, domainPortTypes)) return false
        }
      }

      if (!sourceType || !targetType) return true

      return isTypeCompatible(sourceType, targetType, domainPortTypes)
    },
    [nodes, domainPortTypes],
  )

  /** Handle a connection: colour the edge by source type, sync RF + store. */
  const onConnect = useCallback(
    (params: Connection) => {
      const sourceNode = nodes.find((n) => n.id === params.source)
      const sourcePortType = resolveConnectionPortType(sourceNode, params.sourceHandle, 'source')
      const edgeColor = sourcePortType ? getPortTypeColor(sourcePortType, domainPortTypes) : 'var(--color-accent)'

      // Shared id: RF edge and store edge use the same id so disconnect can
      // match precisely in the store.
      const edgeId = `e-${params.source}-${params.sourceHandle}-${params.target}-${params.targetHandle}`

      // One input port allows one edge: drop any edge already on the target port.
      setEdges((eds) => {
        const oldEdges = eds.filter(
          (e) => e.target === params.target && e.targetHandle === params.targetHandle,
        )
        oldEdges.forEach((e) => removePipelineEdge(e.id))
        const filtered = eds.filter(
          (e) => !(e.target === params.target && e.targetHandle === params.targetHandle),
        )
        return addEdge(
          { ...params, id: edgeId, style: { stroke: edgeColor, strokeWidth: 2 }, animated: false },
          filtered,
        )
      })

      if (params.source && params.target && params.sourceHandle && params.targetHandle) {
        const srcNode = nodes.find((n) => n.id === params.source)
        const tgtNode = nodes.find((n) => n.id === params.target)
        const srcName = srcNode?.data?.battery?.name ?? params.source
        const tgtName = tgtNode?.data?.battery?.name ?? params.target
        const connectLabel = `连线：${srcName} → ${tgtName}`
        const connectLabelEn = `Connect: ${srcName} → ${tgtName}`

        const { currentPipeline: pipelineBeforeConnect } = usePipelineStore.getState()
        if (pipelineBeforeConnect) {
          useHistoryStore.getState().record('connect_edge', pipelineBeforeConnect, {
            edgeIds: [edgeId],
            label: connectLabel,
            labelEn: connectLabelEn,
          })
        }

        addPipelineEdge({
          id: edgeId,
          source: { nodeId: params.source, port: params.sourceHandle },
          target: { nodeId: params.target, port: params.targetHandle },
        })

        // Relay output type follows its input source; on reconnect of
        // relay.input sync the visual layer + persisted param.
        if (params.targetHandle === RELAY_INPUT_PORT) {
          const targetNode = nodes.find((n) => n.id === params.target)
          if (targetNode?.type === 'relay') {
            const nextPortType = sourcePortType ?? 'any'
            setNodes((nds) =>
              nds.map((n) =>
                n.id === params.target ? { ...n, data: { ...n.data, portType: nextPortType } } : n,
              ),
            )
            updateNodeParam(params.target, 'portType', nextPortType, true)
          }
        }

        // tree_merge slot[0] first connect: read the upstream port's access (+ type)
        // and lock the behaviour band onto node.params. Once written it is never
        // reset on disconnect/reconnect (the first connection fixes the band);
        // deleting the node clears it. Scene inputs carry access:'item', so this
        // selects the item-concat branch instead of the structural-pack default.
        if (params.target && params.targetHandle === 'item_0') {
          const targetNode = nodes.find((n) => n.id === params.target)
          if (
            targetNode?.data?.battery?.id === 'tree_merge' &&
            targetNode.data.params?.inferredAccess === undefined
          ) {
            const sourceAccess = resolvePortAccess(sourceNode, params.sourceHandle, 'source')
            const sourceTypeForLock = sourcePortType
            if (sourceAccess !== undefined) {
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === params.target
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          params: {
                            ...n.data.params,
                            inferredAccess: sourceAccess,
                            ...(sourceTypeForLock ? { inferredType: sourceTypeForLock } : {}),
                          },
                        },
                      }
                    : n,
                ),
              )
              updateNodeParam(params.target, 'inferredAccess', sourceAccess, true)
              if (sourceTypeForLock) updateNodeParam(params.target, 'inferredType', sourceTypeForLock, true)
            }
          }
        }

        // Dynamic input auto-expand: connecting the last input port appends one.
        if (params.target && params.targetHandle) {
          const targetNode = nodes.find((n) => n.id === params.target)
          const dynCfg = targetNode?.data?.battery?.dynamicInputs
          if (dynCfg) {
            const portCount =
              typeof targetNode?.data?.params?.portCount === 'number'
                ? targetNode.data.params.portCount
                : dynCfg.minCount
            if (params.targetHandle === `${dynCfg.prefix}${portCount - 1}`) {
              const newCount = portCount + 1
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === params.target
                    ? { ...n, data: { ...n.data, params: { ...n.data.params, portCount: newCount } } }
                    : n,
                ),
              )
              updateNodeParam(params.target, 'portCount', newCount, true)
            }
          }
        }

        // New edge -> recompute from target (skipAiNodes handled by store).
        incrementalExecute(params.target, false)
      }
    },
    [nodes, setEdges, setNodes, addPipelineEdge, removePipelineEdge, updateNodeParam, incrementalExecute, domainPortTypes],
  )

  /** Connect start: colour the preview line + pulse type-compatible handles. */
  const onConnectStart = useCallback(
    (
      _e: React.MouseEvent | React.TouchEvent,
      { nodeId, handleId, handleType }: { nodeId: string | null; handleId: string | null; handleType: string | null },
    ) => {
      let sourceType: string | null = null

      if (nodeId && handleId && handleType === 'source') {
        const node = nodes.find((n) => n.id === nodeId)
        const rawType = resolveConnectionPortType(node, handleId, 'source')
        if (rawType) {
          sourceType = normalizeType(rawType)
          setConnectLineColor(getPortTypeColor(sourceType, domainPortTypes))
        }
      }

      if (!sourceType) {
        setConnectLineColor('var(--color-accent)')
      }

      requestAnimationFrame(() => {
        document.querySelectorAll<HTMLElement>('.react-flow__handle.target').forEach((el) => {
          const handleDomId = el.getAttribute('data-handleid')
          const domNodeId = el.getAttribute('data-nodeid')
          if (!handleDomId || !domNodeId) return
          if (domNodeId === nodeId) return

          if (!sourceType) {
            el.classList.add('handle-connectable')
            return
          }

          const targetNode = nodes.find((n) => n.id === domNodeId)
          const rawTargetType = resolveConnectionPortType(targetNode, handleDomId, 'target')

          if (!rawTargetType || isTypeCompatible(sourceType, normalizeType(rawTargetType), domainPortTypes)) {
            el.classList.add('handle-connectable')
          }
        })
      })
    },
    [nodes, domainPortTypes],
  )

  /** Connect end (success or cancel): restore preview colour, clear pulse class. */
  const onConnectEnd = useCallback(() => {
    setConnectLineColor('var(--color-accent)')
    document.querySelectorAll<HTMLElement>('.handle-connectable').forEach((el) => {
      el.classList.remove('handle-connectable')
    })
  }, [])

  return { connectLineColor, isValidConnection, onConnect, onConnectStart, onConnectEnd }
}
