// Snap-align hook: computes alignment guides while dragging a node, and on drag
// stop applies the snapped position + persists + records history. Ported from the
// legacy editor (components/canvas/useCanvasSnap.ts).
//
// Alignment rules (all in flow coordinates, no DOM dependency):
//   1 — left edge ↔ left edge within threshold → snap
//   2 — center X ↔ center X within threshold → snap
//   3 — right edge ↔ right edge within threshold → snap
// All three axes are computed; the closest one wins. No Y alignment.
import { useCallback, useRef, useState } from 'react'
import type { Node, ReactFlowInstance } from 'reactflow'
import { usePipelineStore, useHistoryStore } from '../../stores/index.js'
import { DEFAULT_BATTERY_WIDTH } from './canvasConstants.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'

// Snap when within this many screen px of a reference axis.
const SNAP_PX = 8

/** Snap-alignment guide (rendered in the canvas SVG overlay). */
export interface SnapGuide {
  type: 'vertical' | 'horizontal'
  position: number // px relative to the .canvas container top-left
}

interface UseCanvasSnapParams {
  nodes: Node[]
  reactFlowInstance: ReactFlowInstance | null
  reactFlowWrapper: React.RefObject<HTMLDivElement>
  /** Snap targets used by onNodesChange, written by onNodeDrag. */
  snapTargetsRef: React.MutableRefObject<{ id: string; x: number; y: number }[]>
  /** When false, skip all snap computation + guide rendering. */
  snapEnabled: boolean
}

export function useCanvasSnap({
  nodes,
  reactFlowInstance,
  reactFlowWrapper,
  snapTargetsRef,
  snapEnabled,
}: UseCanvasSnapParams) {
  const updateNode     = usePipelineStore((s) => s.updateNode)
  const schedulePersistSession = usePipelineStore((s) => s.schedulePersistSession)

  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([])
  const prevSnapKey = useRef('')

  // Node width: prefer ReactFlow's measured width (node.width), else the default.
  const getNodeWidth = (node: Node): number => node.width ?? DEFAULT_BATTERY_WIDTH

  // While dragging: compute the three X-axis alignment candidates, write
  // snapTargetsRef, update the guides. onNodesChange runs in the same frame and
  // reads the ref to apply the correction. Single-node drags only.
  const onNodeDrag = useCallback(
    (_e: React.MouseEvent, _node: Node, draggedNodes: Node[]) => {
      if (!snapEnabled || !reactFlowInstance || !reactFlowWrapper.current || draggedNodes.length !== 1) {
        if (prevSnapKey.current !== '') {
          prevSnapKey.current = ''
          setSnapGuides([])
          snapTargetsRef.current = []
        }
        return
      }

      const draggedNode = draggedNodes[0]
      const zoom = reactFlowInstance.getViewport().zoom
      const thresholdFlow = SNAP_PX / zoom
      const containerRect = reactFlowWrapper.current.getBoundingClientRect()
      const otherNodes = nodes.filter((n) => n.id !== draggedNode.id)

      const dWidth = getNodeWidth(draggedNode)
      const dragLeft   = draggedNode.position.x
      const dragCenter = draggedNode.position.x + dWidth / 2
      const dragRight  = draggedNode.position.x + dWidth

      let bestDiff = thresholdFlow
      let snappedX: number | undefined
      let guideFlowX: number | undefined

      for (const other of otherNodes) {
        const oWidth = getNodeWidth(other)
        const otherLeft   = other.position.x
        const otherCenter = other.position.x + oWidth / 2
        const otherRight  = other.position.x + oWidth

        const diffLL = Math.abs(dragLeft - otherLeft)
        if (diffLL < bestDiff) { bestDiff = diffLL; snappedX = otherLeft; guideFlowX = otherLeft }

        const diffCC = Math.abs(dragCenter - otherCenter)
        if (diffCC < bestDiff) { bestDiff = diffCC; snappedX = otherCenter - dWidth / 2; guideFlowX = otherCenter }

        const diffRR = Math.abs(dragRight - otherRight)
        if (diffRR < bestDiff) { bestDiff = diffRR; snappedX = otherRight - dWidth; guideFlowX = otherRight }
      }

      const guides: SnapGuide[] = []

      if (snappedX !== undefined && guideFlowX !== undefined) {
        snapTargetsRef.current = [{ id: draggedNode.id, x: snappedX, y: draggedNode.position.y }]
        const sx = reactFlowInstance.flowToScreenPosition({ x: guideFlowX, y: 0 }).x - containerRect.left
        guides.push({ type: 'vertical', position: sx })
      } else {
        snapTargetsRef.current = []
      }

      const key = guides.map((g) => `${g.type}:${Math.round(g.position)}`).join(',')
      if (key !== prevSnapKey.current) {
        prevSnapKey.current = key
        setSnapGuides(guides)
      }
    },
    [snapEnabled, nodes, reactFlowInstance, reactFlowWrapper, snapTargetsRef],
  )

  // Shared drag-stop logic: snapshot + updateNode + history + clear guides +
  // persist. Used by both single-node and selection-box drag stop.
  const commitDragStop = useCallback(
    (draggedNodes: Node[]) => {
      if (draggedNodes.length === 0) return

      // Only record history when nodes actually moved (a click-select also fires a
      // zero-displacement dragStop — filter those out by comparing to stored pos).
      const { currentPipeline } = usePipelineStore.getState()
      const hasMoved = draggedNodes.some((n) => {
        const stored = currentPipeline?.nodes.find((pn) => pn.id === n.id)
        if (!stored) return true
        return Math.abs(n.position.x - stored.position.x) > 0.5 || Math.abs(n.position.y - stored.position.y) > 0.5
      })

      const snaps = snapTargetsRef.current
      for (const n of draggedNodes) {
        const snap = snaps.find((s) => s.id === n.id)
        updateNode(n.id, { position: snap ? { x: snap.x, y: snap.y } : n.position })
      }

      snapTargetsRef.current = []
      prevSnapKey.current = ''
      setSnapGuides([])
      schedulePersistSession('node-drag-stop')

      if (!hasMoved) return

      const isBatch = draggedNodes.length > 1
      const firstNode = draggedNodes[0]
      const isGroup = !!firstNode.data?.groupId
      const firstNodeZhName = isGroup
        ? (firstNode.data?.groupName ?? firstNode.id)
        : (firstNode.data?.battery?.name ?? firstNode.id)
      const firstNodeEnName = isGroup
        ? (() => {
            const gid = firstNode.data?.groupId as string
            const { currentPipeline: pipe, batteries } = usePipelineStore.getState()
            const group = (pipe?.groups ?? []).find((g) => g.id === gid)
            if (group?.nameEn) return group.nameEn
            const bat = batteries.find((b) => b.id === gid)
            if (bat?.nameEn) return bat.nameEn
            return formatIdAsLabel(gid)
          })()
        : (firstNode.data?.battery?.nameEn
            ?? (firstNode.data?.battery?.id ? formatIdAsLabel(firstNode.data.battery.id) : firstNode.id))
      const moveLabel = isBatch ? `批量移动 ${draggedNodes.length} 个节点` : `移动节点：${firstNodeZhName}`
      const moveLabelEn = isBatch ? `Move ${draggedNodes.length} nodes` : `Move node: ${firstNodeEnName}`
      const nodeIds = draggedNodes.map((n) => n.id)
      if (currentPipeline) {
        useHistoryStore.getState().record(
          isBatch ? 'move_nodes_batch' : 'move_node',
          currentPipeline,
          { nodeIds, label: moveLabel, labelEn: moveLabelEn },
        )
      }
    },
    [snapTargetsRef, updateNode, schedulePersistSession],
  )

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, _node: Node, draggedNodes: Node[]) => {
      commitDragStop(draggedNodes)
    },
    [commitDragStop],
  )

  const onSelectionDragStop = useCallback(
    (_event: React.MouseEvent, draggedNodes: Node[]) => {
      commitDragStop(draggedNodes)
    },
    [commitDragStop],
  )

  return { snapGuides, onNodeDrag, onNodeDragStop, onSelectionDragStop }
}
