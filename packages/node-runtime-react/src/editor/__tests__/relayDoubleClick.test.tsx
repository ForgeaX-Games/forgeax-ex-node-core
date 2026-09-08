import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Edge, Node, ReactFlowInstance } from 'reactflow'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport, createEditorTransport } from '../transport/index.js'
import { useHistoryStore } from '../stores/historyStore.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { createEmptyPipeline } from '../stores/pipelineStore.helpers.js'
import { useCanvasRelayInteractions } from '../components/canvas/useCanvasRelayInteractions.js'
import { RELAY_INPUT_PORT, RELAY_OUTPUT_PORT } from '../components/canvas/RelayNode.js'

function relayNode(id = 'relay'): Node {
  return {
    id,
    type: 'relay',
    position: { x: 120, y: 0 },
    data: { portType: 'number' },
  }
}

function batteryNode(id: string): Node {
  return {
    id,
    type: 'battery',
    position: { x: 0, y: 0 },
    data: { battery: { id: 'number_const', name: id }, params: {} },
  } as Node
}

function seedRelayPipeline(withRelay = true): void {
  const p = createEmptyPipeline()
  p.nodes = withRelay ? [
    { id: 'src', batteryId: 'number_const', name: 'Source', position: { x: 0, y: 0 }, params: {} },
    { id: 'relay', batteryId: '__relay__', name: 'Relay', position: { x: 120, y: 0 }, params: { portType: 'number' } },
    { id: 'dst', batteryId: 'number_const', name: 'Dest', position: { x: 240, y: 0 }, params: {} },
  ] : [
    { id: 'src', batteryId: 'number_const', name: 'Source', position: { x: 0, y: 0 }, params: {} },
    { id: 'dst', batteryId: 'number_const', name: 'Dest', position: { x: 240, y: 0 }, params: {} },
  ]
  p.edges = withRelay ? [
    {
      id: 'e-src-relay',
      source: { nodeId: 'src', port: 'out' },
      target: { nodeId: 'relay', port: RELAY_INPUT_PORT },
    },
    {
      id: 'e-relay-dst',
      source: { nodeId: 'relay', port: RELAY_OUTPUT_PORT },
      target: { nodeId: 'dst', port: 'in' },
    },
  ] : [
    {
      id: 'e-src-out-dst-in',
      source: { nodeId: 'src', port: 'out' },
      target: { nodeId: 'dst', port: 'in' },
    },
  ]
  usePipelineStore.setState({
    currentPipeline: p,
    batteries: [
      {
        id: 'number_const',
        name: 'Number',
        type: 'common',
        category: 'common/input',
        description: '',
        version: '1.0.0',
        inputs: [{ name: 'in', type: 'number' }],
        outputs: [{ name: 'out', type: 'number' }],
        params: [],
      },
    ] as never,
    nodeOutputs: { relay: { output: 1 } },
    dynamicOutputPorts: { relay: [{ name: 'output', type: 'number', label: 'output' }] },
    selectedNode: null,
    selectedNodeIds: [],
  })
}

function makeHook(initialNodes: Node[], initialEdges: Edge[], reactFlowInstance: ReactFlowInstance | null = null) {
  let rfNodes = initialNodes
  let rfEdges = initialEdges
  const setNodes = (updater: Node[] | ((nodes: Node[]) => Node[])) => {
    rfNodes = typeof updater === 'function' ? (updater as (nodes: Node[]) => Node[])(rfNodes) : updater
  }
  const setEdges = (updater: Edge[] | ((edges: Edge[]) => Edge[])) => {
    rfEdges = typeof updater === 'function' ? (updater as (edges: Edge[]) => Edge[])(rfEdges) : updater
  }
  const { result } = renderHook(() => useCanvasRelayInteractions({
    reactFlowInstance,
    setNodes,
    setEdges,
    isInGroupView: false,
  }))
  return { result, getNodes: () => rfNodes, getEdges: () => rfEdges }
}

function doubleClickEvent(): Pick<React.MouseEvent, 'preventDefault' | 'stopPropagation'> {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }
}

beforeEach(() => {
  const client = createMockApiClient({ ops: [] })
  configureEditorTransport(createEditorTransport(client))
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
  seedRelayPipeline()
})

afterEach(() => {
  configureEditorTransport(null)
  usePipelineStore.setState({ currentPipeline: null })
})

describe('relay double-click legacy behaviour', () => {
  it('removes a relay and restores the direct edge between its neighbours', () => {
    const { result, getNodes, getEdges } = makeHook(
      [batteryNode('src'), relayNode(), batteryNode('dst')],
      [
        { id: 'e-src-relay', source: 'src', sourceHandle: 'out', target: 'relay', targetHandle: RELAY_INPUT_PORT },
        { id: 'e-relay-dst', source: 'relay', sourceHandle: RELAY_OUTPUT_PORT, target: 'dst', targetHandle: 'in' },
      ],
    )
    const event = doubleClickEvent()

    act(() => result.current.onNodeDoubleClick(event as React.MouseEvent, relayNode()))

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(usePipelineStore.getState().currentPipeline!.nodes.map((n) => n.id)).toEqual(['src', 'dst'])
    expect(usePipelineStore.getState().currentPipeline!.edges).toEqual([
      {
        id: 'e-src-out-dst-in',
        source: { nodeId: 'src', port: 'out' },
        target: { nodeId: 'dst', port: 'in' },
      },
    ])
    expect(getNodes().map((n) => n.id)).toEqual(['src', 'dst'])
    expect(getEdges()).toEqual([
      expect.objectContaining({
        id: 'e-src-out-dst-in',
        source: 'src',
        sourceHandle: 'out',
        target: 'dst',
        targetHandle: 'in',
      }),
    ])
    expect(usePipelineStore.getState().nodeOutputs.relay).toBeUndefined()
    expect(usePipelineStore.getState().dynamicOutputPorts.relay).toBeUndefined()
    expect(useHistoryStore.getState().entries[0]).toMatchObject({ type: 'delete_node', label: '删除 relay' })
  })

  it('leaves ordinary node double-click handling untouched', () => {
    const { result } = makeHook([batteryNode('src')], [])
    const event = doubleClickEvent()

    act(() => result.current.onNodeDoubleClick(event as React.MouseEvent, batteryNode('src')))

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
    expect(usePipelineStore.getState().currentPipeline!.nodes.map((n) => n.id)).toEqual(['src', 'relay', 'dst'])
  })

  it('inserts a typed relay when an edge is double-clicked', () => {
    seedRelayPipeline(false)
    const edge: Edge = {
      id: 'e-src-out-dst-in',
      source: 'src',
      sourceHandle: 'out',
      target: 'dst',
      targetHandle: 'in',
    }
    const reactFlowInstance = {
      screenToFlowPosition: () => ({ x: 132, y: 12 }),
    } as unknown as ReactFlowInstance
    const { result, getNodes, getEdges } = makeHook([batteryNode('src'), batteryNode('dst')], [edge], reactFlowInstance)
    const event = { ...doubleClickEvent(), clientX: 132, clientY: 12 }

    act(() => result.current.onEdgeDoubleClick(event as React.MouseEvent, edge))

    const pipeline = usePipelineStore.getState().currentPipeline!
    const relay = pipeline.nodes.find((n) => n.batteryId === '__relay__')!
    expect(relay.params.portType).toBe('number')
    expect(pipeline.edges).toEqual([
      {
        id: `e-src-out-${relay.id}-${RELAY_INPUT_PORT}`,
        source: { nodeId: 'src', port: 'out' },
        target: { nodeId: relay.id, port: RELAY_INPUT_PORT },
      },
      {
        id: `e-${relay.id}-${RELAY_OUTPUT_PORT}-dst-in`,
        source: { nodeId: relay.id, port: RELAY_OUTPUT_PORT },
        target: { nodeId: 'dst', port: 'in' },
      },
    ])
    expect(getNodes()).toContainEqual(expect.objectContaining({ id: relay.id, type: 'relay', data: { portType: 'number' } }))
    expect(getEdges()).toHaveLength(2)
    expect(useHistoryStore.getState().entries[0]).toMatchObject({ type: 'add_node', label: '插入 relay' })
  })
})
