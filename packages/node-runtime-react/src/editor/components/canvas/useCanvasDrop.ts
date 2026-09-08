// Drop hook: drop a battery from the palette onto the canvas, build a ReactFlow
// node and sync it to the pipeline store. The placement logic is factored into
// placeBattery so the double-click search popover can reuse the same insertion
// path. Ported from the legacy editor (components/canvas/useCanvasDrop.ts),
// retargeted onto the editor stores.
//
import { useCallback } from 'react'
import type { Node, ReactFlowInstance } from 'reactflow'
import { usePipelineStore, useHistoryStore } from '../../stores/index.js'
import { createEmptyPipeline } from '../../stores/pipelineStore.helpers.js'
import type { Battery } from '../../types.js'
import { resolveNodeType, DEFAULT_BATTERY_WIDTH, estimateBatteryNodeWidth, estimateGroupNodeWidth } from './canvasConstants.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'
import { RELAY_BATTERY_ID, RELAY_NODE_HEIGHT, RELAY_NODE_WIDTH } from './RelayNode.js'
import { getEditorTransport } from '../../transport/index.js'
import { buildGroupNodeData } from './GroupNode.js'
import { expandLoadedGroupBundle, remapGroupBundle } from './groupViewUtils.js'

interface UseCanvasDropParams {
  reactFlowInstance: ReactFlowInstance | null
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  onUngroup?: (groupId: string) => void
  onEnterGroup?: (groupId: string) => void
}

export type PlaceBatteryFn = (
  battery: Battery,
  position: { x: number; y: number },
  options?: { presetText?: string },
) => string | null

export function useCanvasDrop({ reactFlowInstance, setNodes, onUngroup, onEnterGroup }: UseCanvasDropParams) {
  const addNode = usePipelineStore((s) => s.addNode)
  const addGroup = usePipelineStore((s) => s.addGroup)
  const addAnnotation = usePipelineStore((s) => s.addAnnotation)
  const incrementalExecute = usePipelineStore((s) => s.incrementalExecute)

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const placeBattery = useCallback<PlaceBatteryFn>(
    (battery, position, options) => {
      const presetText = options?.presetText

      if (battery.type === 'group') {
        void getEditorTransport().api.loadGroup(battery.id)
          .then((loaded) => {
            if (!loaded) {
              console.warn(`[placeBattery] group template not found: ${battery.id}`)
              return
            }
            const [root, ...deps] = expandLoadedGroupBundle(loaded)
            const remapped = remapGroupBundle(root, deps, position)
            for (const dep of remapped.deps) addGroup(dep)
            addGroup(remapped.root)

            const noop = (_groupId: string) => {}
            const rfNode: Node = {
              id: remapped.root.id,
              type: 'group',
              position,
              style: { width: estimateGroupNodeWidth(remapped.root) },
              data: buildGroupNodeData(remapped.root, onUngroup ?? noop, onEnterGroup ?? noop),
              selected: false,
            }
            setNodes((nds) => [...nds, rfNode])

            // Record BEFORE the lazy pipeline is created (currentPipeline may
            // still be null on the very first drop into a fresh project); an
            // empty pipeline is the correct pre-state for undoing the first node.
            const { currentPipeline } = usePipelineStore.getState()
            useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
              nodeIds: [remapped.root.id],
              label: `添加模板节点：${battery.name}`,
              labelEn: `Add template: ${formatIdAsLabel(battery.id)}`,
            })

            addNode({
              id: remapped.root.id,
              batteryId: '__group__',
              name: remapped.root.name,
              position,
              params: { groupId: remapped.root.id },
            })
            setTimeout(() => {
              void usePipelineStore.getState().persistSession()
              void usePipelineStore.getState().incrementalExecute(remapped.root.id, false, { persist: false })
            }, 50)
          })
          .catch((e) => console.error('[placeBattery] failed to load group template:', e))
        return null
      }

      if (battery.id === RELAY_BATTERY_ID) {
        const nodeId = `relay-${Date.now()}`
        const params = { portType: 'any' }
        const newNode: Node = {
          id: nodeId,
          type: 'relay',
          position,
          style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT },
          data: params,
        }

        setNodes((nds) => [...nds, newNode])

        const { currentPipeline } = usePipelineStore.getState()
        useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
          nodeIds: [nodeId],
          label: '添加 Relay',
          labelEn: 'Add Relay',
        })

        addNode({
          id: nodeId,
          batteryId: RELAY_BATTERY_ID,
          name: 'Relay',
          position,
          params,
        })
        return nodeId
      }

      const nodeType = resolveNodeType(battery)

      // annotation battery: create a canvas annotation, not an execution node.
      if (nodeType === 'annotation') {
        const { currentPipeline } = usePipelineStore.getState()
        const annotationId = addAnnotation(position)
        useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
          nodeIds: [annotationId],
          label: '添加注释',
          labelEn: 'Add annotation',
        })
        setNodes((nds) => [
          ...nds,
          {
            id: annotationId,
            type: 'annotation',
            position,
            style: { width: 400, height: 60 },
            data: { text: '', initialEdit: true },
            deletable: true,
            selectable: true,
            draggable: true,
          },
        ])
        return annotationId
      }

      const nodeId = `node-${Date.now()}`

      const specialInit: Record<string, { style?: Record<string, number>; params?: Record<string, unknown> }> = {
        text_panel: { style: { width: DEFAULT_BATTERY_WIDTH, height: 150 } },
        ai_battery: { style: { width: DEFAULT_BATTERY_WIDTH } },
        json_battery: { style: { width: DEFAULT_BATTERY_WIDTH, height: 200 } },
        image_reader: { style: { width: DEFAULT_BATTERY_WIDTH } },
        image_preview: { style: { width: DEFAULT_BATTERY_WIDTH } },
      }
      const initConfig = specialInit[nodeType] ?? {}
      const autoWidth = estimateBatteryNodeWidth(
        battery,
        (initConfig.style?.width as number | undefined) ?? DEFAULT_BATTERY_WIDTH,
      )

      const dynInitParams: Record<string, unknown> = battery.dynamicInputs
        ? { portCount: battery.dynamicInputs.minCount }
        : {}

      const presetParams: Record<string, unknown> = presetText ? { text: presetText } : {}

      const newNode: Node = {
        id: nodeId,
        type: nodeType,
        position,
        style: { ...(initConfig.style ?? { width: DEFAULT_BATTERY_WIDTH }), width: autoWidth },
        data: {
          battery,
          params: { ...dynInitParams, ...(initConfig.params ?? {}), ...presetParams },
        },
      }

      setNodes((nds) => [...nds, newNode])

      const { currentPipeline } = usePipelineStore.getState()
      useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
        nodeIds: [nodeId],
        label: `添加节点：${battery.name}`,
        labelEn: `Add node: ${formatIdAsLabel(battery.id)}`,
      })

      addNode({
        id: nodeId,
        batteryId: battery.id,
        name: battery.name,
        position,
        params: { ...presetParams },
      })

      // AI batteries must be run manually; everything else triggers a partial
      // recompute on insert.
      if (battery.type !== 'ai') {
        incrementalExecute(nodeId, false)
      }
      return nodeId
    },
    [setNodes, addNode, addGroup, addAnnotation, incrementalExecute, onUngroup, onEnterGroup],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const batteryData = event.dataTransfer.getData('application/battery')
      if (!batteryData || !reactFlowInstance) return

      const battery: Battery = JSON.parse(batteryData)
      const presetText = event.dataTransfer.getData('application/preset-text')
      const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })

      placeBattery(battery, position, presetText ? { presetText } : undefined)
    },
    [reactFlowInstance, placeBattery],
  )

  return { onDragOver, onDrop, placeBattery }
}
