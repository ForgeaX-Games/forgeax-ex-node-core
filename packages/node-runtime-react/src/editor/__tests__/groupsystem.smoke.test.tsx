// Group-system integration smoke test — render the faithful Canvas over a store
// seeded with a collapsed group, assert the root shows the GroupNode, then drive
// enterGroupView through the store and assert the canvas flips into the group
// view (breadcrumb appears + an inner sub-node renders). Exercises the
// useCanvasGroup / useCanvasGroupView / GroupBreadcrumb wiring end-to-end.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { ReactFlowProvider, type Edge, type Node } from 'reactflow'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport, createEditorTransport, type EditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import Canvas from '../components/canvas/Canvas.js'
import { useCanvasDelete } from '../components/canvas/useCanvasDelete.js'
import { useCanvasGroupView } from '../components/canvas/useCanvasGroupView.js'
import type { Battery, NodeGroup, Pipeline } from '../types.js'

const echo: Battery = {
  id: 'demo.echo', name: 'Echo', nameEn: 'Echo', type: 'ts', category: 'base',
  inputs: [{ name: 'in', type: 'string' }], outputs: [{ name: 'out', type: 'string' }], params: [],
}

const group: NodeGroup = {
  id: 'group_1', name: '回声组', nameEn: 'Echo Group', position: { x: 100, y: 100 },
  nodes: [
    { id: 'inner1', batteryId: 'demo.echo', name: 'Echo', position: { x: 0, y: 0 }, params: {} },
    { id: 'inner2', batteryId: 'demo.echo', name: 'Echo', position: { x: 200, y: 0 }, params: {} },
  ],
  edges: [{ id: 'ie1', source: { nodeId: 'inner1', port: 'out' }, target: { nodeId: 'inner2', port: 'in' } }],
  exposedInputs: [{ portName: 'in__ner1__in', portType: 'string', sourceNodeId: 'inner1', sourcePortName: 'in', order: 0 }],
  exposedOutputs: [{ portName: 'out__ner2__out', portType: 'string', sourceNodeId: 'inner2', sourcePortName: 'out', order: 0 }],
  innerLayout: {},
}

function pipelineWithGroup(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'p-group', name: 'g', description: '',
    nodes: [{ id: 'group_1', batteryId: '__group__', name: 'Echo Group', position: { x: 100, y: 100 }, params: {} }],
    edges: [],
    groups: [group],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle', createdAt: now, updatedAt: now,
  }
}

let transport: EditorTransport

beforeEach(() => {
  transport = createEditorTransport(createMockApiClient({ ops: [{ id: 'demo.echo', name: 'Echo', inputs: [], outputs: [], params: [], execute: () => null }] }))
  configureEditorTransport(transport)
  usePipelineStore.setState({
    batteries: [echo], categories: [], currentPipeline: pipelineWithGroup(),
    selectedNode: null, selectedNodeIds: [], logs: [], nodeOutputs: {},
    dynamicOutputPorts: {}, groupViewStack: [],
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
})

afterEach(() => {
  transport.dispose()
  configureEditorTransport(null)
  act(() => usePipelineStore.setState({ groupViewStack: [], currentPipeline: null }))
})

describe('group-system integration smoke', () => {
  it('renders the outer GroupNode and enters/exits the group view', async () => {
    const { container } = render(
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>,
    )

    // Root level: the collapsed GroupNode renders.
    await waitFor(() => expect(container.querySelector('.group-node')).not.toBeNull())
    expect(container.querySelector('.group-breadcrumb')).toBeNull()

    // Enter the group view via the store; the canvas flips to the inner view.
    act(() => usePipelineStore.getState().enterGroupView('group_1'))
    await waitFor(() => {
      expect(container.querySelector('.group-breadcrumb')).not.toBeNull()
      // Inner sub-nodes render as ordinary battery nodes.
      expect(container.querySelectorAll('.battery-node').length).toBeGreaterThanOrEqual(2)
    })

    // Exit returns to the root level (breadcrumb disappears, GroupNode returns).
    act(() => usePipelineStore.getState().exitGroupView())
    await waitFor(() => {
      expect(container.querySelector('.group-breadcrumb')).toBeNull()
      expect(container.querySelector('.group-node')).not.toBeNull()
    })
  })

  it('persists inner node deletion when leaving and re-entering a group view', async () => {
    let rfNodes: Node[] = []
    let rfEdges: Edge[] = []
    const setNodes = (updater: Node[] | ((nodes: Node[]) => Node[])) => {
      rfNodes = typeof updater === 'function' ? updater(rfNodes) : updater
    }
    const setEdges = (updater: Edge[] | ((edges: Edge[]) => Edge[])) => {
      rfEdges = typeof updater === 'function' ? updater(rfEdges) : updater
    }

    const { result } = renderHook(() =>
      useCanvasGroupView({
        setNodes,
        setEdges,
        reactFlowInstance: null,
        buildOuterNodes: () => [],
        buildOuterEdges: () => [],
        onUngroup: () => {},
        onEnterGroup: () => {},
      }),
    )

    act(() => result.current.enterGroupView('group_1'))
    await waitFor(() => expect(rfNodes.map((node) => node.id)).toEqual(['inner1', 'inner2']))

    const deleted = rfNodes.find((node) => node.id === 'inner1')
    expect(deleted).toBeDefined()
    act(() => result.current.syncInnerNodesDelete([deleted!]))
    expect(rfNodes.map((node) => node.id)).toEqual(['inner2'])
    expect(rfEdges).toEqual([])

    act(() => result.current.exitGroupView())
    await waitFor(() => {
      const storedGroup = usePipelineStore.getState().currentPipeline!.groups![0]
      expect(storedGroup.nodes.map((node) => node.id)).toEqual(['inner2'])
      expect(storedGroup.edges).toEqual([])
      expect(storedGroup.innerLayout?.inner1).toBeUndefined()
    })

    act(() => result.current.enterGroupView('group_1'))
    await waitFor(() => expect(rfNodes.map((node) => node.id)).toEqual(['inner2']))
  })

  it('root delete of a group node removes the group entry with its shadow', () => {
    const { result } = renderHook(() =>
      useCanvasDelete({
        nodes: [],
        edges: [],
        setEdges: () => {},
        setNodes: () => {},
      }),
    )

    act(() => {
      result.current.onNodesDelete([
        {
          id: 'group_1',
          type: 'group',
          position: { x: 100, y: 100 },
          data: { battery: { id: '__group__', name: 'Echo Group' }, params: { groupId: 'group_1' } },
        } as Node,
      ])
    })

    const pipeline = usePipelineStore.getState().currentPipeline!
    expect(pipeline.nodes.map((node) => node.id)).toEqual([])
    expect(pipeline.groups).toEqual([])
  })
})
