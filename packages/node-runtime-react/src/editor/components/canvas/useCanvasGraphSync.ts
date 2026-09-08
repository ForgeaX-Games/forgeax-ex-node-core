// Canvas graph-sync hook: keeps the ReactFlow node/edge layer in sync with the
// pipeline store. Extracted from the legacy Canvas.tsx (the buildOuterNodes /
// buildOuterEdges rebuild, registerRfSetters, the battery-meta hot-update, the
// dynamic-output stale-edge prune, and the agent-driven selection signal) so
// the Canvas shell stays focused on wiring + render.
//
// Battery / relay / group / frame / annotation nodes all rebuild faithfully here.
import { useCallback, useEffect } from 'react'
import type { Node, Edge, ReactFlowInstance } from 'reactflow'
import { usePipelineStore } from '../../stores/index.js'
import type { Battery, BatteryPort } from '../../types.js'
import {
  resolveNodeType,
  DEFAULT_BATTERY_WIDTH,
  estimateBatteryNodeWidth,
  estimateGroupNodeWidth,
} from './canvasConstants.js'
import { getPortTypeColor, type DomainPortTypes } from '../../utils/portTypes.js'
import { RELAY_BATTERY_ID, RELAY_NODE_HEIGHT, RELAY_NODE_WIDTH } from './RelayNode.js'
import { buildGroupNodeData } from './GroupNode.js'

/** Callbacks injected into outer group nodes so their actions reach Canvas. */
export interface GroupNodeCallbacks {
  onUngroup: (groupId: string) => void
  onEnterGroup: (groupId: string) => void
}

interface UseCanvasGraphSyncParams {
  reactFlowInstance: ReactFlowInstance | null
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  /** When in a group view, the group-view hook owns the RF layer — skip the sync. */
  isInGroupView?: boolean
  /** Wire outer group nodes' ungroup / enter actions. */
  groupCallbacks?: GroupNodeCallbacks
  domainPortTypes?: DomainPortTypes
}

/** Build the ReactFlow nodes from the current pipeline (battery + relay + group). */
export function buildCanvasNodes(groupCallbacks?: GroupNodeCallbacks): Node[] {
  const { currentPipeline, batteries: bats } = usePipelineStore.getState()
  if (!currentPipeline) return []
  const result: Node[] = []

  for (const n of currentPipeline.nodes) {
    if (n.batteryId === RELAY_BATTERY_ID) {
      result.push({
        id: n.id,
        type: 'relay',
        position: n.position,
        style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT },
        data: { portType: typeof n.params?.portType === 'string' ? n.params.portType : 'any' },
        selected: false,
      })
      continue
    }

    // Outer group node: build it as a GroupNode when the callbacks are supplied.
    if (n.batteryId === '__group__') {
      if (!groupCallbacks) continue
      const groupId = typeof n.params?.groupId === 'string' ? n.params.groupId : n.id
      const group = (currentPipeline.groups ?? []).find((g) => g.id === groupId)
      if (!group) continue
      result.push({
        id: n.id,
        type: 'group',
        position: n.position,
        style: { width: estimateGroupNodeWidth(group) },
        data: buildGroupNodeData(group, groupCallbacks.onUngroup, groupCallbacks.onEnterGroup),
        selected: false,
      })
      continue
    }

    const battery = bats.find((b: Battery) => b.id === n.batteryId)
    if (!battery) continue
    const nodeType = resolveNodeType(battery)
    const specialStyles: Record<string, Record<string, number>> = {
      text_panel: { width: DEFAULT_BATTERY_WIDTH, height: 150 },
      name_list_panel: { width: DEFAULT_BATTERY_WIDTH, height: 200 },
      grid_panel: { width: DEFAULT_BATTERY_WIDTH, height: 200 },
      ai_battery: { width: DEFAULT_BATTERY_WIDTH },
      json_battery: { width: DEFAULT_BATTERY_WIDTH, height: 200 },
      battery: { width: DEFAULT_BATTERY_WIDTH },
    }
    const autoWidth = estimateBatteryNodeWidth(
      battery,
      (specialStyles[nodeType]?.width as number | undefined) ?? DEFAULT_BATTERY_WIDTH,
    )
    const baseStyle = { ...(specialStyles[nodeType] ?? { width: DEFAULT_BATTERY_WIDTH }), width: autoWidth }
    const savedW = typeof n.params?._nodeWidth === 'number' ? n.params._nodeWidth : undefined
    const savedH = typeof n.params?._nodeHeight === 'number' ? n.params._nodeHeight : undefined
    const style = {
      ...baseStyle,
      ...(savedW !== undefined ? { width: savedW } : {}),
      ...(savedH !== undefined ? { height: savedH } : {}),
    }
    result.push({
      id: n.id,
      type: nodeType,
      position: n.position,
      style,
      data: { battery, params: n.params || {} },
      selected: false,
    })
  }

  // Canvas annotations: free-floating sticky notes (visual only, not executed).
  // Rebuilt from the store so they survive a live-sync refetch / reload; created
  // (initialEdit) annotations are added by useCanvasDrop, not here.
  for (const annotation of currentPipeline.annotations ?? []) {
    result.push({
      id: annotation.id,
      type: 'annotation',
      position: annotation.position,
      style: { width: annotation.width ?? 400, height: annotation.height ?? 60 },
      data: { text: annotation.text },
      deletable: true,
      selectable: true,
      draggable: true,
      selected: false,
    })
  }

  // Canvas frames: labelled bounding boxes (visual only, not executed). Built
  // behind the battery nodes (zIndex -20) so the frame chrome sits underneath.
  for (const frame of currentPipeline.frames ?? []) {
    result.push({
      id: frame.id,
      type: 'frame',
      position: frame.position,
      style: { width: frame.width, height: frame.height, zIndex: -20 },
      data: { name: frame.name, nodeIds: frame.nodeIds },
      deletable: true,
      selectable: true,
      draggable: true,
      selected: false,
    })
  }

  return result
}

// ── Diff-based reconcile ─────────────────────────────────────────────────────
// Ported from the legacy incremental-update contract: the legacy editor NEVER
// rebuilt the whole ReactFlow layer on a graph mutation — a full rebuild fired
// only on a gated session-restore signal (initial load / file load / undo-redo,
// see legacy useSessionRestore.ts), while local edits (drag-add, connect, param)
// drove `setNodes`/`setEdges` incrementally so untouched nodes kept their object
// identity. The kernel port replaced that with a `pipelineRevision`-keyed
// blanket `setNodes(built)` rebuild; because every committed batch (INCLUDING a
// local drag-add's own persist) round-trips through `graph:applied → loadPipeline
// → pipelineRevision++`, the blanket rebuild handed every node a fresh `data`
// reference and `memo(BatteryNode)` re-ran for ALL nodes — i.e. "drag one
// battery, all batteries reload". These reconcilers restore the legacy guarantee
// while keeping the external/LLM live-sync working: changed/added/removed nodes
// update, everything else keeps its previous object reference (so memo'd node
// components do not re-render / re-initialise).

function styleEqual(a: Node['style'] | Edge['style'], b: Node['style'] | Edge['style']): boolean {
  const ax = (a ?? {}) as Record<string, unknown>
  const bx = (b ?? {}) as Record<string, unknown>
  const keys = new Set([...Object.keys(ax), ...Object.keys(bx)])
  for (const k of keys) if (!Object.is(ax[k], bx[k])) return false
  return true
}

/**
 * Shallow param compare with a deep fallback for object/array values. A fresh
 * snapshot reparses params into new object refs even when the content is
 * identical, so a pure reference check would force a needless rebuild.
 */
function paramsEqual(a: unknown, b: unknown): boolean {
  const ax = (a ?? {}) as Record<string, unknown>
  const bx = (b ?? {}) as Record<string, unknown>
  const ak = Object.keys(ax)
  const bk = Object.keys(bx)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (!(k in bx)) return false
    const av = ax[k]
    const bv = bx[k]
    if (Object.is(av, bv)) continue
    if (av !== null && bv !== null && typeof av === 'object' && typeof bv === 'object') {
      try {
        if (JSON.stringify(av) !== JSON.stringify(bv)) return false
      } catch {
        return false
      }
    } else {
      return false
    }
  }
  return true
}

/** True when `built` carries no render-affecting change vs `prev` for the same id. */
function nodeReusable(prev: Node, built: Node): boolean {
  if (prev.type !== built.type) return false
  if (prev.position.x !== built.position.x || prev.position.y !== built.position.y) return false
  if (!styleEqual(prev.style, built.style)) return false
  const pd = (prev.data ?? {}) as Record<string, unknown>
  const bd = (built.data ?? {}) as Record<string, unknown>
  // Battery nodes: only the battery ref + params drive the render. The catalog
  // ref is stable across refetches (the battery array is not replaced by a
  // pipeline reload), so a reference check is correct and cheap.
  if ('battery' in bd || 'battery' in pd) {
    if (pd.battery !== bd.battery) return false
    return paramsEqual(pd.params, bd.params)
  }
  // Other node kinds (relay / annotation / frame): structural compare. Group
  // nodes carry freshly-built callbacks each pass, so they fall through to a
  // rebuild — rare and cheap.
  try {
    return JSON.stringify(pd) === JSON.stringify(bd)
  } catch {
    return false
  }
}

/**
 * Reconcile the freshly-built node list against the current RF list, preserving
 * object identity for unchanged nodes and the prior selection for everything.
 * Returns `prev` untouched when nothing changed (no array churn).
 */
export function reconcileCanvasNodes(prev: Node[], built: Node[]): Node[] {
  const prevById = new Map(prev.map((n) => [n.id, n]))
  const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id))
  let changed = built.length !== prev.length
  const result = built.map((b, i) => {
    const p = prevById.get(b.id)
    if (p && nodeReusable(p, b)) {
      if (p !== prev[i]) changed = true
      return p
    }
    changed = true
    return selected.has(b.id) ? { ...b, selected: true } : b
  })
  return changed ? result : prev
}

/** Reconcile edges by id, preserving identity for unchanged edges. */
export function reconcileCanvasEdges(prev: Edge[], built: Edge[]): Edge[] {
  const prevById = new Map(prev.map((e) => [e.id, e]))
  let changed = built.length !== prev.length
  const result = built.map((b, i) => {
    const p = prevById.get(b.id)
    const reusable =
      p &&
      p.source === b.source &&
      p.target === b.target &&
      p.sourceHandle === b.sourceHandle &&
      p.targetHandle === b.targetHandle &&
      p.animated === b.animated &&
      styleEqual(p.style, b.style)
    if (reusable) {
      if (p !== prev[i]) changed = true
      return p
    }
    changed = true
    return b
  })
  return changed ? result : prev
}

/** Build the ReactFlow edges from the current pipeline (typed colours). */
export function buildCanvasEdges(domainPortTypes?: DomainPortTypes): Edge[] {
  const { currentPipeline, batteries: bats } = usePipelineStore.getState()
  if (!currentPipeline) return []
  const validNodeIds = new Set(currentPipeline.nodes.map((n) => n.id))
  return currentPipeline.edges
    .filter((e) => validNodeIds.has(e.source.nodeId) && validNodeIds.has(e.target.nodeId))
    .map((e) => {
      const srcNode = currentPipeline.nodes.find((n) => n.id === e.source.nodeId)
      const relayPortType =
        srcNode?.batteryId === RELAY_BATTERY_ID && typeof srcNode.params?.portType === 'string'
          ? srcNode.params.portType
          : undefined
      const battery = bats.find((b: Battery) => b.id === srcNode?.batteryId)
      const port = battery?.outputs?.find((o: BatteryPort) => o.name === e.source.port)
      const edgeColor = relayPortType
        ? getPortTypeColor(relayPortType, domainPortTypes)
        : port
          ? getPortTypeColor(port.type, domainPortTypes)
          : 'var(--color-accent)'
      return {
        id: e.id,
        source: e.source.nodeId,
        target: e.target.nodeId,
        sourceHandle: e.source.port,
        targetHandle: e.target.port,
        animated: false,
        style: { stroke: edgeColor, strokeWidth: 2 },
      }
    })
}

export function useCanvasGraphSync({
  reactFlowInstance,
  setNodes,
  setEdges,
  isInGroupView = false,
  groupCallbacks,
  domainPortTypes,
}: UseCanvasGraphSyncParams) {
  const batteries = usePipelineStore((s) => s.batteries)
  const pipelineRevision = usePipelineStore((s) => s.pipelineRevision)
  const dynamicOutputPorts = usePipelineStore((s) => s.dynamicOutputPorts)
  const pendingSelectNodeIds = usePipelineStore((s) => s.pendingSelectNodeIds)
  const clearSelectRequest = usePipelineStore((s) => s.clearSelectRequest)
  const registerRfSetters = usePipelineStore((s) => s.registerRfSetters)
  const removeEdge = usePipelineStore((s) => s.removeEdge)
  const incrementalExecute = usePipelineStore((s) => s.incrementalExecute)

  // Register RF setters so agent ops can drive the visual layer directly.
  useEffect(() => {
    registerRfSetters({ setNodes, setEdges })
  }, [registerRfSetters, setNodes, setEdges])

  // Rebuild RF nodes/edges on every committed snapshot refetch. `loadPipeline`
  // bumps `pipelineRevision` on the initial load AND on every graph:applied
  // refetch (any actor — human, AI tool call, CLI). Keying on the revision (not
  // the constant pipeline id 'main') is what makes external/LLM-driven batches
  // actually appear: the kernel is the single source of truth and we re-pull on
  // every committed batch. We also rebuild when the battery catalog first
  // arrives, so a snapshot that loads before the catalog (battery lookup would
  // otherwise drop every node) is rebuilt once the batteries are known.
  const batteriesReady = batteries.length > 0
  const rebuild = useCallback(() => {
    // In a group view, useCanvasGroupView owns the RF layer — don't clobber it.
    if (isInGroupView) return
    // Diff-based reconcile (NOT a blanket replace): added/changed/removed nodes
    // update while every untouched node keeps its previous object reference, so
    // `memo(BatteryNode)` does not re-render. This is the legacy incremental
    // contract — a local drag-add only mounts the new node; existing batteries
    // keep their state/cache. The prior selection is preserved inside the
    // reconciler. External / LLM batches still flow in: a new node in the
    // snapshot is added, a removed one is dropped.
    const builtNodes = buildCanvasNodes(groupCallbacks)
    setNodes((prev) => reconcileCanvasNodes(prev, builtNodes))
    const builtEdges = buildCanvasEdges(domainPortTypes)
    setEdges((prev) => reconcileCanvasEdges(prev, builtEdges))
  }, [setNodes, setEdges, isInGroupView, groupCallbacks, domainPortTypes])
  useEffect(() => {
    rebuild()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineRevision, batteriesReady, rebuild])

  // Battery meta hot-update: refresh the battery snapshot on existing nodes so
  // titles / ports don't keep showing stale names.
  useEffect(() => {
    if (batteries.length === 0) return
    const byId = new Map(batteries.map((b) => [b.id, b]))
    setNodes((nds) =>
      nds.map((node) => {
        const currentBattery = (node.data as { battery?: Battery } | undefined)?.battery
        if (!currentBattery) return node
        const latestBattery = byId.get(currentBattery.id)
        if (!latestBattery || latestBattery === currentBattery) return node
        return { ...node, data: { ...node.data, battery: latestBattery } }
      }),
    )
  }, [batteries, setNodes])

  // Dynamic-output stale-edge cleanup: prune edges to dynamic ports that no
  // longer exist (static ports are unaffected).
  useEffect(() => {
    const { currentPipeline: pipeline, batteries: bats } = usePipelineStore.getState()
    if (!pipeline) return

    for (const [nodeId, ports] of Object.entries(dynamicOutputPorts)) {
      const validDynPortNames = new Set(ports.map((p) => p.name))

      const nodeData = pipeline.nodes.find((n) => n.id === nodeId)
      const battery = nodeData ? bats.find((b) => b.id === nodeData.batteryId) : undefined
      const staticPortNames = new Set((battery?.outputs ?? []).map((o) => o.name))

      const staleEdges = pipeline.edges.filter(
        (e) =>
          e.source.nodeId === nodeId &&
          !staticPortNames.has(e.source.port) &&
          !validDynPortNames.has(e.source.port),
      )
      if (staleEdges.length === 0) continue

      const staleIds = new Set(staleEdges.map((e) => e.id))
      const affectedTargets = new Set(staleEdges.map((e) => e.target.nodeId))
      staleEdges.forEach((e) => removeEdge(e.id))
      setEdges((eds) => eds.filter((e) => !staleIds.has(e.id)))

      for (const targetId of affectedTargets) {
        incrementalExecute(targetId, false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynamicOutputPorts])

  // Agent-driven selection signal: when a backend op broadcasts a selection,
  // drive RF node selection + centre the viewport.
  useEffect(() => {
    if (!pendingSelectNodeIds || pendingSelectNodeIds.length === 0) return

    const targetIds = new Set(pendingSelectNodeIds)
    setNodes((nds) => nds.map((n) => ({ ...n, selected: targetIds.has(n.id) })))

    const firstId = pendingSelectNodeIds[0]
    setTimeout(() => {
      reactFlowInstance?.fitView({
        nodes: [{ id: firstId }],
        duration: 400,
        padding: 0.5,
        maxZoom: 1.5,
      })
    }, 50)

    clearSelectRequest()
  }, [pendingSelectNodeIds, setNodes, reactFlowInstance, clearSelectRequest])
}
