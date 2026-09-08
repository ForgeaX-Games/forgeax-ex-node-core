// Group-view navigation hook. Ported from the legacy editor
// (components/canvas/useCanvasGroupView.ts).
// Responsibilities:
//   1. Decide what the canvas shows based on pipelineStore.groupViewStack
//      (outer nodes OR a group's inner nodes).
//   2. On group entry, build innerNodes + innerEdges (incl. external context nodes).
//   3. Track live inner edits via refs, flushing them back to the store on exit.
//   4. Provide the breadcrumb navigation data.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Node, Edge, ReactFlowInstance } from 'reactflow'
import { usePipelineStore } from '../../stores/index.js'
import { getPortTypeColor, type DomainPortTypes } from '../../utils/portTypes.js'
import { DEFAULT_BATTERY_WIDTH, DEFAULT_GROUP_WIDTH, estimateBatteryNodeWidth, estimateGroupNodeWidth } from './canvasConstants.js'
import type { Battery, NodeGroup, PipelineEdge, PipelineNode } from '../../types.js'
import { resolveEdgeColorFromStore, resolveNodeTypeAndStyleFromStore, sortGroupPorts } from './groupViewUtils.js'
import type { BreadcrumbItem } from './GroupBreadcrumb.js'
import { RELAY_BATTERY_ID, RELAY_NODE_HEIGHT, RELAY_NODE_WIDTH } from './RelayNode.js'
import { buildGroupNodeData } from './GroupNode.js'

export interface UseCanvasGroupViewParams {
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  reactFlowInstance: ReactFlowInstance | null
  /** Build the outer nodes (root or parent level), rebuilt after exiting a group view. */
  buildOuterNodes: () => Node[]
  buildOuterEdges: () => Edge[]
  /** Ungroup callback (for GroupNode). */
  onUngroup: (groupId: string) => void
  onEnterGroup: (groupId: string) => void
  /** Domain port types for inner-view edge/boundary colouring. */
  domainPortTypes?: DomainPortTypes
}

export interface UseCanvasGroupViewReturn {
  isInGroupView: boolean
  currentGroupId: string | null
  currentGroup: NodeGroup | null
  breadcrumbs: BreadcrumbItem[]
  /** Called on inner node position change (innerLayout tracking). */
  syncInnerNodePosition: (nodeId: string, position: { x: number; y: number }) => void
  /** Called when inner nodes are deleted from the current group view. */
  syncInnerNodesDelete: (nodes: Node[]) => void
  /** Called when an inner edge is added. */
  syncInnerEdgeAdd: (edge: PipelineEdge) => void
  /** Called when an inner edge is removed. */
  syncInnerEdgeRemove: (edgeId: string) => void
  /** Enter a group view. */
  enterGroupView: (groupId: string) => void
  /** Exit the group view (return to the parent level). */
  exitGroupView: () => void
  /** Breadcrumb cross-level jump: depth=0 returns to root; depth=N keeps the first N levels. */
  jumpToGroupViewDepth: (depth: number) => void
}

// Group-internal boundary node id prefixes.
export const BOUNDARY_INPUT_PREFIX = '__boundary_input__'
export const BOUNDARY_OUTPUT_PREFIX = '__boundary_output__'
export const BOUNDARY_EDGE_PREFIX = '__boundary_edge__'
const CONTEXT_INPUT_PREFIX = '__group_context_in__'
const CONTEXT_OUTPUT_PREFIX = '__group_context_out__'
const CONTEXT_GAP_X = 64
const CONTEXT_MIN_GAP_Y = 28
const CONTEXT_LABEL_OVERHANG_Y = 26
const NODE_HEADER_ESTIMATE = 34
const NODE_PORTS_VERTICAL_ESTIMATE = 16
const PORT_ROW_HEIGHT_ESTIMATE = 23
const PORT_ROW_GAP_ESTIMATE = 4
const GROUP_NODE_MIN_HEIGHT = 90

export function isGroupContextInputNodeId(nodeId: string | null | undefined): nodeId is string {
  return typeof nodeId === 'string' && nodeId.startsWith(CONTEXT_INPUT_PREFIX)
}

export function isGroupContextOutputNodeId(nodeId: string | null | undefined): nodeId is string {
  return typeof nodeId === 'string' && nodeId.startsWith(CONTEXT_OUTPUT_PREFIX)
}

export function getGroupContextInputSourceNodeId(nodeId: string): string {
  return nodeId.slice(CONTEXT_INPUT_PREFIX.length)
}

export function getGroupContextOutputTargetNodeId(nodeId: string): string {
  return nodeId.slice(CONTEXT_OUTPUT_PREFIX.length)
}

export function makeGroupContextNodeId(direction: 'in' | 'out', nodeId: string, edgeId?: string): string {
  const prefix = direction === 'in' ? CONTEXT_INPUT_PREFIX : CONTEXT_OUTPUT_PREFIX
  return `${prefix}${nodeId}${edgeId ? `__${edgeId}` : ''}`
}

function isBoundaryNodeId(nodeId: string): boolean {
  return nodeId.startsWith(BOUNDARY_INPUT_PREFIX)
    || nodeId.startsWith(BOUNDARY_OUTPUT_PREFIX)
    || isGroupContextInputNodeId(nodeId)
    || isGroupContextOutputNodeId(nodeId)
}

function isBoundaryEdge(edge: PipelineEdge): boolean {
  return edge.id.startsWith(BOUNDARY_EDGE_PREFIX) || isBoundaryNodeId(edge.source.nodeId) || isBoundaryNodeId(edge.target.nodeId)
}

function getNodeWidth(node: Node): number {
  return typeof node.style?.width === 'number' ? node.style.width : 200
}

function getNodeHeight(node: Node): number {
  return typeof node.style?.height === 'number' ? node.style.height : 90
}

function computeNodeBounds(nodes: Node[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 360, maxY: 180 }
  }
  return nodes.reduce(
    (acc, node) => {
      const width = getNodeWidth(node)
      const height = getNodeHeight(node)
      return {
        minX: Math.min(acc.minX, node.position.x),
        minY: Math.min(acc.minY, node.position.y),
        maxX: Math.max(acc.maxX, node.position.x + width),
        maxY: Math.max(acc.maxY, node.position.y + height),
      }
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function estimatePortRowsHeight(rowCount: number): number {
  if (rowCount <= 0) return 0
  return rowCount * PORT_ROW_HEIGHT_ESTIMATE + (rowCount - 1) * PORT_ROW_GAP_ESTIMATE
}

function estimateBatteryNodeHeight(node: PipelineNode, battery: Battery): number {
  const savedHeight = typeof node.params?._nodeHeight === 'number' ? node.params._nodeHeight : undefined
  if (savedHeight !== undefined) return savedHeight

  const dynCfg = battery.dynamicInputs
  const fixedInputCount = dynCfg
    ? battery.inputs.filter(input => !input.name.startsWith(dynCfg.prefix)).length
    : battery.inputs.length
  const dynamicInputCount = dynCfg
    ? (typeof node.params?.portCount === 'number' ? Math.max(dynCfg.minCount, node.params.portCount) : dynCfg.minCount)
    : 0

  const dynOutCfg = battery.dynamicOutputs
  const fixedOutputCount = battery.outputs.filter(output => !output.hidden).length
  const dynOutFromParams = Array.isArray(node.params?._dynOutPorts) ? node.params._dynOutPorts.length : undefined
  const dynamicOutputCount = dynOutCfg ? (dynOutFromParams ?? dynOutCfg.minCount) : 0

  const visibleRows = Math.max(fixedInputCount + dynamicInputCount, fixedOutputCount + dynamicOutputCount)
  const estimated = NODE_HEADER_ESTIMATE + NODE_PORTS_VERTICAL_ESTIMATE + estimatePortRowsHeight(visibleRows)
  return Math.max(GROUP_NODE_MIN_HEIGHT, Math.ceil(estimated))
}

function estimateGroupNodeHeight(group: NodeGroup): number {
  const visibleRows = Math.max(
    group.exposedInputs.filter(port => !port.hidden).length,
    group.exposedOutputs.filter(port => !port.hidden).length,
  )
  const estimated = NODE_HEADER_ESTIMATE + NODE_PORTS_VERTICAL_ESTIMATE + estimatePortRowsHeight(visibleRows)
  return Math.max(GROUP_NODE_MIN_HEIGHT, Math.ceil(estimated))
}

function resolveGroupContainer(groupId: string): {
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  groupNodeId: string
} {
  const { currentPipeline, groupViewStack } = usePipelineStore.getState()
  const groups = currentPipeline?.groups ?? []
  const stackIndex = groupViewStack.lastIndexOf(groupId)
  const parentGroupId = stackIndex > 0 ? groupViewStack[stackIndex - 1] : null
  const parentGroup = parentGroupId ? groups.find((g) => g.id === parentGroupId) : undefined
  const nodes = parentGroup?.nodes ?? currentPipeline?.nodes ?? []
  const edges = parentGroup?.edges ?? currentPipeline?.edges ?? []
  const groupNodeId = nodes.find((n) => n.batteryId === '__group__' && n.params?.groupId === groupId)?.id ?? groupId

  return { nodes, edges, groupNodeId }
}

export function useCanvasGroupView({
  setNodes,
  setEdges,
  reactFlowInstance,
  buildOuterNodes,
  buildOuterEdges,
  onUngroup,
  onEnterGroup,
  domainPortTypes,
}: UseCanvasGroupViewParams): UseCanvasGroupViewReturn {
  const groupViewStack = usePipelineStore((s) => s.groupViewStack)
  const enterGroupViewStore = usePipelineStore((s) => s.enterGroupView)
  const exitGroupViewStore = usePipelineStore((s) => s.exitGroupView)
  const popGroupViewToStore = usePipelineStore((s) => s.popGroupViewTo)
  const updateGroup = usePipelineStore((s) => s.updateGroup)
  const removeEdge = usePipelineStore((s) => s.removeEdge)

  const currentGroupId = groupViewStack.length > 0 ? groupViewStack[groupViewStack.length - 1] : null
  const isInGroupView = currentGroupId !== null

  // Refs tracking live inner edits (flushed back once on exit, to avoid frequent store writes).
  const innerNodesRef = useRef<PipelineNode[]>([])
  const innerLayoutRef = useRef<Record<string, { x: number; y: number }>>({})
  const innerEdgesRef = useRef<PipelineEdge[]>([])
  const innerExposedInputsRef = useRef<NodeGroup['exposedInputs']>([])
  const innerExposedOutputsRef = useRef<NodeGroup['exposedOutputs']>([])
  const isDirtyRef = useRef(false)

  // Build the inner ReactFlow nodes (inner sub-nodes + external context nodes).
  const buildInnerNodes = useCallback((group: NodeGroup, onEntGrp: (gid: string) => void): Node[] => {
    const { batteries, currentPipeline } = usePipelineStore.getState()
    const innerLayout = group.innerLayout ?? {}
    const container = resolveGroupContainer(group.id)
    const externalInEdges = container.edges.filter((edge) => edge.target.nodeId === container.groupNodeId)
    const externalOutEdges = container.edges.filter((edge) => edge.source.nodeId === container.groupNodeId)

    const subNodes: Node[] = group.nodes.map((n) => {
      const battery = batteries.find((b) => b.id === n.batteryId)
      const pos = innerLayout[n.id] ?? n.position

      if (n.batteryId === RELAY_BATTERY_ID) {
        return {
          id: n.id,
          type: 'relay',
          position: pos,
          style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT },
          data: { portType: typeof n.params?.portType === 'string' ? n.params.portType : 'any' },
          selected: false,
        }
      }

      // A sub-node may itself be a GroupNode (nested).
      if (n.batteryId === '__group__') {
        const innerGroup = (currentPipeline?.groups ?? []).find((g) => g.id === n.params?.groupId)
        if (innerGroup) {
          return {
            id: n.id,
            type: 'group',
            position: pos,
            style: { width: estimateGroupNodeWidth(innerGroup) },
            data: buildGroupNodeData(innerGroup, onUngroup, onEntGrp),
            selected: false,
          }
        }
      }

      if (!battery) return null
      const { type: nodeType, style } = resolveNodeTypeAndStyleFromStore(n.batteryId)
      return {
        id: n.id,
        type: nodeType,
        position: pos,
        style,
        data: { battery, params: n.params || {} },
        selected: false,
      }
    }).filter(Boolean) as Node[]

    const bounds = computeNodeBounds(subNodes)
    const inputByPort = new Map(sortGroupPorts(group.exposedInputs).map((port) => [port.portName, port]))
    const outputByPort = new Map(sortGroupPorts(group.exposedOutputs).map((port) => [port.portName, port]))

    const getContextSize = (nodeId: string): { width: number; height: number } => {
      const sourceNode = container.nodes.find((n) => n.id === nodeId)
      if (sourceNode?.batteryId === RELAY_BATTERY_ID) return { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT }
      if (sourceNode?.batteryId === '__group__') {
        const childGroupId = typeof sourceNode.params?.groupId === 'string' ? sourceNode.params.groupId : ''
        const childGroup = (currentPipeline?.groups ?? []).find((g) => g.id === childGroupId)
        return {
          width: childGroup ? estimateGroupNodeWidth(childGroup) : DEFAULT_GROUP_WIDTH,
          height: childGroup ? estimateGroupNodeHeight(childGroup) : GROUP_NODE_MIN_HEIGHT,
        }
      }
      const battery = batteries.find((b) => b.id === sourceNode?.batteryId)
      if (!sourceNode || !battery) return { width: DEFAULT_BATTERY_WIDTH, height: GROUP_NODE_MIN_HEIGHT }
      const savedWidth = typeof sourceNode.params?._nodeWidth === 'number' ? sourceNode.params._nodeWidth : undefined
      return {
        width: savedWidth ?? estimateBatteryNodeWidth(battery, DEFAULT_BATTERY_WIDTH),
        height: estimateBatteryNodeHeight(sourceNode, battery),
      }
    }

    const buildContextNode = (
      contextId: string,
      nodeId: string,
      direction: 'in' | 'out',
      y: number,
    ): Node | null => {
      const sourceNode = container.nodes.find((n) => n.id === nodeId)
      if (!sourceNode) return null
      const { width: contextWidth } = getContextSize(nodeId)
      const className = `group-context-node group-context-node--${direction === 'in' ? 'input' : 'output'}`
      const pos = direction === 'in'
        ? { x: bounds.minX - contextWidth - CONTEXT_GAP_X, y }
        : { x: bounds.maxX + CONTEXT_GAP_X, y }

      if (sourceNode.batteryId === RELAY_BATTERY_ID) {
        return {
          id: contextId,
          type: 'relay',
          position: pos,
          className,
          style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT },
          data: { portType: typeof sourceNode.params?.portType === 'string' ? sourceNode.params.portType : 'any' },
          selected: false,
          selectable: false,
          draggable: false,
          deletable: false,
          connectable: true,
        }
      }

      if (sourceNode.batteryId === '__group__') {
        const childGroupId = typeof sourceNode.params?.groupId === 'string' ? sourceNode.params.groupId : ''
        const childGroup = (currentPipeline?.groups ?? []).find((g) => g.id === childGroupId)
        if (!childGroup) return null
        return {
          id: contextId,
          type: 'group',
          position: pos,
          className,
          style: { width: estimateGroupNodeWidth(childGroup) },
          data: buildGroupNodeData(childGroup, onUngroup, onEntGrp),
          selected: false,
          selectable: false,
          draggable: false,
          deletable: false,
          connectable: true,
        }
      }

      const battery = batteries.find((b) => b.id === sourceNode.batteryId)
      if (!battery) return null
      const { type: nodeType, style } = resolveNodeTypeAndStyleFromStore(sourceNode.batteryId)
      const savedHeight = typeof sourceNode.params?._nodeHeight === 'number' ? sourceNode.params._nodeHeight : undefined
      return {
        id: contextId,
        type: nodeType,
        position: pos,
        className,
        style: {
          ...style,
          width: contextWidth,
          ...(savedHeight !== undefined ? { height: savedHeight } : {}),
        },
        data: { battery, params: sourceNode.params || {} },
        selected: false,
        selectable: false,
        draggable: false,
        deletable: false,
        connectable: true,
      }
    }

    const buildContextItems = (
      edgesForContext: PipelineEdge[],
      direction: 'in' | 'out',
    ): Array<{ contextId: string; nodeId: string }> => {
      const seen = new Set<string>()
      const items: Array<{ contextId: string; nodeId: string }> = []
      for (const edge of edgesForContext) {
        const nodeId = direction === 'in' ? edge.source.nodeId : edge.target.nodeId
        if (!container.nodes.some((node) => node.id === nodeId)) continue
        const exposed = direction === 'in'
          ? inputByPort.get(edge.target.port)
          : outputByPort.get(edge.source.port)
        if (!exposed) continue
        const contextId = direction === 'in'
          ? makeGroupContextNodeId('in', nodeId)
          : makeGroupContextNodeId('out', nodeId)
        // Reuse the same context node per external node; multiple external output
        // edges connect to different target handles of the same context battery to
        // avoid duplicating identical batteries in the group view.
        if (seen.has(contextId)) continue
        seen.add(contextId)
        items.push({ contextId, nodeId })
      }
      return items
    }

    const resolveAlignedRows = (
      inputItems: Array<{ contextId: string; nodeId: string }>,
      outputItems: Array<{ contextId: string; nodeId: string }>,
    ): { inputRows: Map<string, number>; outputRows: Map<string, number> } => {
      const rowCount = Math.max(inputItems.length, outputItems.length)
      const inputRows = new Map<string, number>()
      const outputRows = new Map<string, number>()
      if (rowCount === 0) return { inputRows, outputRows }

      const rowHeights = Array.from({ length: rowCount }, (_, index) => {
        const inputHeight = inputItems[index] ? getContextSize(inputItems[index].nodeId).height : 0
        const outputHeight = outputItems[index] ? getContextSize(outputItems[index].nodeId).height : 0
        return Math.max(inputHeight, outputHeight, 1) + CONTEXT_LABEL_OVERHANG_Y
      })
      const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0)
        + CONTEXT_MIN_GAP_Y * Math.max(0, rowCount - 1)
      const minStartY = bounds.minY
      const maxStartY = Math.max(bounds.minY, bounds.maxY - totalHeight)
      let y = clamp((bounds.minY + bounds.maxY - totalHeight) / 2, minStartY, maxStartY)

      for (let index = 0; index < rowCount; index += 1) {
        const inputItem = inputItems[index]
        const outputItem = outputItems[index]
        const rowHeight = rowHeights[index]
        if (inputItem) {
          const height = getContextSize(inputItem.nodeId).height
          inputRows.set(inputItem.contextId, y + CONTEXT_LABEL_OVERHANG_Y + (rowHeight - CONTEXT_LABEL_OVERHANG_Y - height) / 2)
        }
        if (outputItem) {
          const height = getContextSize(outputItem.nodeId).height
          outputRows.set(outputItem.contextId, y + CONTEXT_LABEL_OVERHANG_Y + (rowHeight - CONTEXT_LABEL_OVERHANG_Y - height) / 2)
        }
        y += rowHeight + CONTEXT_MIN_GAP_Y
      }
      return { inputRows, outputRows }
    }

    const inputContextItems = buildContextItems(externalInEdges, 'in')
    const outputContextItems = buildContextItems(externalOutEdges, 'out')
    const { inputRows, outputRows } = resolveAlignedRows(inputContextItems, outputContextItems)

    const contextNodeIds = new Set<string>()
    const contextNodes: Node[] = []
    for (const { contextId, nodeId } of inputContextItems) {
      if (contextNodeIds.has(contextId)) continue
      const node = buildContextNode(contextId, nodeId, 'in', inputRows.get(contextId) ?? bounds.minY)
      if (node) {
        contextNodeIds.add(contextId)
        contextNodes.push(node)
      }
    }
    for (const { contextId, nodeId } of outputContextItems) {
      if (contextNodeIds.has(contextId)) continue
      const node = buildContextNode(contextId, nodeId, 'out', outputRows.get(contextId) ?? bounds.minY)
      if (node) {
        contextNodeIds.add(contextId)
        contextNodes.push(node)
      }
    }

    return [...contextNodes, ...subNodes]
  }, [onUngroup])

  // Build the inner ReactFlow edges.
  const buildInnerEdges = useCallback((group: NodeGroup): Edge[] => {
    const container = resolveGroupContainer(group.id)
    // Externally-connected ports must show their edges in the group view. Do not
    // filter by `hidden` here, or "connected-but-hidden" ports in old data would
    // drop their lines and break the context.
    const inputByPort = new Map(sortGroupPorts(group.exposedInputs).map((port) => [port.portName, port]))
    const outputByPort = new Map(sortGroupPorts(group.exposedOutputs).map((port) => [port.portName, port]))
    const realEdges = group.edges.filter((edge) => !isBoundaryEdge(edge)).map((e) => {
      const color = resolveEdgeColorFromStore(e.source.nodeId, e.source.port, group.nodes, domainPortTypes)
      return {
        id: e.id,
        source: e.source.nodeId,
        sourceHandle: e.source.port,
        target: e.target.nodeId,
        targetHandle: e.target.port,
        animated: false,
        style: { stroke: color, strokeWidth: 2 },
      }
    })

    const externalInEdges: Edge[] = container.edges
      .filter((edge) => edge.target.nodeId === container.groupNodeId && inputByPort.has(edge.target.port))
      .map((edge) => {
        const exposed = inputByPort.get(edge.target.port)
        if (!exposed) return null
        const color = resolveEdgeColorFromStore(edge.source.nodeId, edge.source.port, container.nodes, domainPortTypes)
        return {
          id: `${BOUNDARY_EDGE_PREFIX}${group.id}__external_in__${edge.id}`,
          source: makeGroupContextNodeId('in', edge.source.nodeId),
          sourceHandle: edge.source.port,
          target: exposed.sourceNodeId,
          targetHandle: exposed.sourcePortName,
          animated: false,
          deletable: false,
          style: { stroke: color, strokeWidth: 2 },
        } as Edge
      })
      .filter((edge): edge is Edge => edge !== null)

    const externalOutEdges: Edge[] = container.edges
      .filter((edge) => edge.source.nodeId === container.groupNodeId && outputByPort.has(edge.source.port))
      .map((edge) => {
        const exposed = outputByPort.get(edge.source.port)
        if (!exposed) return null
        const color = getPortTypeColor(exposed?.portType ?? 'any', domainPortTypes)
        return {
          id: `${BOUNDARY_EDGE_PREFIX}${group.id}__external_out__${edge.id}`,
          source: exposed.sourceNodeId,
          sourceHandle: exposed.sourcePortName,
          target: makeGroupContextNodeId('out', edge.target.nodeId),
          targetHandle: edge.target.port,
          animated: false,
          deletable: false,
          style: { stroke: color, strokeWidth: 2 },
        } as Edge
      })
      .filter((edge): edge is Edge => edge !== null)

    return [...realEdges, ...externalInEdges, ...externalOutEdges]
  }, [domainPortTypes])

  // Flush the current inner view's dirty state (layout + edges) back to the store;
  // returns whether anything changed.
  const flushInnerEdits = useCallback((): boolean => {
    if (!currentGroupId) return false
    if (!isDirtyRef.current) return false
    updateGroup(currentGroupId, {
      nodes: [...innerNodesRef.current],
      innerLayout: { ...innerLayoutRef.current },
      edges: innerEdgesRef.current.filter((edge) => !isBoundaryEdge(edge)),
      exposedInputs: [...innerExposedInputsRef.current],
      exposedOutputs: [...innerExposedOutputsRef.current],
    })
    return true
  }, [currentGroupId, updateGroup])

  // Enter a group view. The useEffect on currentGroupId rebuilds the canvas after
  // pushing. When going deeper, flush the current level's dirty edits first.
  const enterGroupView = useCallback((groupId: string) => {
    const { currentPipeline } = usePipelineStore.getState()
    const group = (currentPipeline?.groups ?? []).find((g) => g.id === groupId)
    if (!group) {
      console.warn('[GroupView] enterGroupView: group not found', groupId)
      return
    }
    flushInnerEdits()
    enterGroupViewStore(groupId)
  }, [enterGroupViewStore, flushInnerEdits])

  // Exit the group view (pop one level): flush edits, rebuild, and recompute if dirty.
  const exitGroupView = useCallback(() => {
    if (!currentGroupId) return
    const { currentPipeline } = usePipelineStore.getState()
    const group = (currentPipeline?.groups ?? []).find((g) => g.id === currentGroupId)
    const dirty = flushInnerEdits()
    exitGroupViewStore()
    if (dirty && group) {
      const firstNodeId = innerNodesRef.current[0]?.id ?? group.nodes[0]?.id
      setTimeout(() => {
        void usePipelineStore.getState().persistSession()
        if (firstNodeId) void usePipelineStore.getState().incrementalExecute(firstNodeId, true, { persist: false })
      }, 80)
    }
  }, [currentGroupId, exitGroupViewStore, flushInnerEdits])

  // Breadcrumb cross-level jump: flush the current inner dirty state, then trim the
  // stack to the given depth. depth=0 → root; depth=N → keep stack[0..N-1].
  const jumpToGroupViewDepth = useCallback((depth: number) => {
    flushInnerEdits()
    popGroupViewToStore(depth)
  }, [flushInnerEdits, popGroupViewToStore])

  // No setNodes on first mount (useSessionRestore owns that); later groupViewStack
  // changes (enter / exit / cross-level jump) rebuild the canvas.
  const [hasEnteredGroupView, setHasEnteredGroupView] = useState(false)

  useEffect(() => {
    if (currentGroupId) {
      const { currentPipeline } = usePipelineStore.getState()
      const group = (currentPipeline?.groups ?? []).find((g) => g.id === currentGroupId)
      if (!group) return
      innerNodesRef.current = [...group.nodes]
      innerLayoutRef.current = { ...group.innerLayout }
      innerEdgesRef.current = [...group.edges]
      innerExposedInputsRef.current = [...group.exposedInputs]
      innerExposedOutputsRef.current = [...group.exposedOutputs]
      isDirtyRef.current = false
      setHasEnteredGroupView(true)
      const innerNodes = buildInnerNodes(group, onEnterGroup)
      const innerEdges = buildInnerEdges(group)
      setNodes(innerNodes)
      setEdges(innerEdges)
      setTimeout(() => reactFlowInstance?.fitView({ padding: 0.15 }), 50)
    } else if (hasEnteredGroupView) {
      const outerNodes = buildOuterNodes()
      const outerEdges = buildOuterEdges()
      if (outerNodes.length > 0 || outerEdges.length > 0) {
        setNodes(outerNodes)
        setEdges(outerEdges)
        setTimeout(() => reactFlowInstance?.fitView({ padding: 0.1 }), 50)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGroupId])

  const syncInnerNodePosition = useCallback((nodeId: string, position: { x: number; y: number }) => {
    innerLayoutRef.current[nodeId] = position
    isDirtyRef.current = true
  }, [])

  const syncInnerNodesDelete = useCallback((deleted: Node[]) => {
    if (!currentGroupId) return

    const deletedIds = new Set(
      deleted
        .map((node) => node.id)
        .filter((nodeId) => !isBoundaryNodeId(nodeId)),
    )
    if (deletedIds.size === 0) return

    const { currentPipeline, groupViewStack: stack } = usePipelineStore.getState()
    const currentGroup = (currentPipeline?.groups ?? []).find((group) => group.id === currentGroupId)
    if (!currentGroup) return

    const removedInputPorts = new Set(
      innerExposedInputsRef.current
        .filter((port) => deletedIds.has(port.sourceNodeId))
        .map((port) => port.portName),
    )
    const removedOutputPorts = new Set(
      innerExposedOutputsRef.current
        .filter((port) => deletedIds.has(port.sourceNodeId))
        .map((port) => port.portName),
    )

    innerNodesRef.current = innerNodesRef.current.filter((node) => !deletedIds.has(node.id))
    for (const nodeId of deletedIds) delete innerLayoutRef.current[nodeId]
    innerEdgesRef.current = innerEdgesRef.current.filter(
      (edge) => !deletedIds.has(edge.source.nodeId) && !deletedIds.has(edge.target.nodeId) && !isBoundaryEdge(edge),
    )
    innerExposedInputsRef.current = innerExposedInputsRef.current.filter((port) => !deletedIds.has(port.sourceNodeId))
    innerExposedOutputsRef.current = innerExposedOutputsRef.current.filter((port) => !deletedIds.has(port.sourceNodeId))

    const removedEdgeIds = new Set<string>()
    const container = resolveGroupContainer(currentGroupId)
    const isRemovedGroupPortEdge = (edge: PipelineEdge): boolean =>
      (edge.target.nodeId === container.groupNodeId && removedInputPorts.has(edge.target.port)) ||
      (edge.source.nodeId === container.groupNodeId && removedOutputPorts.has(edge.source.port))

    const stackIndex = stack.lastIndexOf(currentGroupId)
    const parentGroupId = stackIndex > 0 ? stack[stackIndex - 1] : null
    if (parentGroupId) {
      const parentGroup = (currentPipeline?.groups ?? []).find((group) => group.id === parentGroupId)
      if (parentGroup) {
        updateGroup(parentGroupId, {
          edges: parentGroup.edges.filter((edge) => {
            if (!isRemovedGroupPortEdge(edge)) return true
            removedEdgeIds.add(edge.id)
            return false
          }),
        })
      }
    } else {
      for (const edge of currentPipeline?.edges ?? []) {
        if (isRemovedGroupPortEdge(edge)) {
          removedEdgeIds.add(edge.id)
          removeEdge(edge.id)
        }
      }
    }

    setNodes((nodes) => nodes.filter((node) => !deletedIds.has(node.id)))
    setEdges((edges) =>
      edges.filter((edge) =>
        !deletedIds.has(edge.source) &&
        !deletedIds.has(edge.target) &&
        !removedEdgeIds.has(edge.id),
      ),
    )
    isDirtyRef.current = true
  }, [currentGroupId, removeEdge, setEdges, setNodes, updateGroup])

  const syncInnerEdgeAdd = useCallback((edge: PipelineEdge) => {
    innerEdgesRef.current = innerEdgesRef.current.filter((e) => e.id !== edge.id)
    innerEdgesRef.current.push(edge)
    isDirtyRef.current = true
  }, [])

  const syncInnerEdgeRemove = useCallback((edgeId: string) => {
    if (edgeId.startsWith(BOUNDARY_EDGE_PREFIX)) return
    innerEdgesRef.current = innerEdgesRef.current.filter((e) => e.id !== edgeId)
    isDirtyRef.current = true
  }, [])

  // Breadcrumbs.
  const { currentPipeline } = usePipelineStore.getState()
  const breadcrumbs: BreadcrumbItem[] = [
    { id: null, name: 'Root Pipeline' },
    ...groupViewStack.map((gid) => {
      const group = (currentPipeline?.groups ?? []).find((g) => g.id === gid)
      return { id: gid, name: group?.name ?? gid }
    }),
  ]

  const currentGroup = currentGroupId
    ? ((currentPipeline?.groups ?? []).find((g) => g.id === currentGroupId) ?? null)
    : null

  return {
    isInGroupView,
    currentGroupId,
    currentGroup,
    breadcrumbs,
    syncInnerNodePosition,
    syncInnerNodesDelete,
    syncInnerEdgeAdd,
    syncInnerEdgeRemove,
    enterGroupView,
    exitGroupView,
    jumpToGroupViewDepth,
  }
}
