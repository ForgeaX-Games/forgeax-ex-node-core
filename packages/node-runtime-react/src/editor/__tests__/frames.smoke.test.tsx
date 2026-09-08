// Canvas frames integration: a seeded frame renders through buildCanvasNodes +
// the CanvasFrameNode; createFrameFromSelection writes a frame into the store and
// appends a frame RF node. The bounding-box math itself is covered in frames.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, renderHook, act } from '@testing-library/react'
import type { Node } from 'reactflow'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport, createEditorTransport, type EditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import Canvas from '../components/canvas/Canvas.js'
import { useCanvasFrames } from '../components/canvas/useCanvasFrames.js'
import { useCanvasDelete } from '../components/canvas/useCanvasDelete.js'
import type { Battery, Pipeline } from '../types.js'

const echoBattery: Battery = {
  id: 'demo.echo',
  name: 'Echo',
  nameEn: 'Echo',
  type: 'ts',
  category: 'base',
  description: 'echoes its input',
  version: '1.0.0',
  inputs: [{ name: 'in', type: 'string' }],
  outputs: [{ name: 'out', type: 'string' }],
  params: [],
}

function twoNodePipeline(withFrame: boolean): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'p-frames',
    name: 'frames',
    description: '',
    nodes: [
      { id: 'n1', batteryId: 'demo.echo', name: 'Echo', position: { x: 0, y: 0 }, params: {} },
      { id: 'n2', batteryId: 'demo.echo', name: 'Echo', position: { x: 300, y: 200 }, params: {} },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    frames: withFrame
      ? [
          {
            id: 'frame_seed',
            name: 'My Frame',
            position: { x: -42, y: -76 },
            width: 564,
            height: 408,
            nodeIds: ['n1', 'n2'],
            createdAt: now,
            updatedAt: now,
          },
        ]
      : [],
  }
}

function seedStore(withFrame: boolean) {
  usePipelineStore.setState({
    batteries: [echoBattery],
    categories: [],
    currentPipeline: twoNodePipeline(withFrame),
    sessionRestorePending: null,
    pipelineStatus: 'idle',
    selectedNode: null,
    selectedNodeIds: [],
    logs: [],
    nodeOutputs: {},
    dynamicOutputPorts: {},
    groupViewStack: [],
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
}

let transport: EditorTransport

beforeEach(() => {
  const client = createMockApiClient({
    ops: [{ id: 'demo.echo', name: 'Echo', inputs: [], outputs: [], params: [], execute: () => null }],
  })
  transport = createEditorTransport(client)
  configureEditorTransport(transport)
})

afterEach(() => {
  transport.dispose()
  configureEditorTransport(null)
})

const rfNode = (id: string, x: number, y: number): Node =>
  ({ id, type: 'battery', position: { x, y }, width: 180, height: 90, data: {} }) as Node

describe('canvas frames', () => {
  it('renders a seeded frame through CanvasFrameNode', () => {
    seedStore(true)
    const { container } = render(<Canvas />)

    const frameEl = container.querySelector('.canvas-frame-node')
    expect(frameEl).not.toBeNull()
    const nameInput = container.querySelector<HTMLInputElement>('.canvas-frame-title-input')
    expect(nameInput?.value).toBe('My Frame')
  })

  it('createFrameFromSelection writes a frame to the store and appends a frame node', () => {
    seedStore(false)
    const setNodes = vi.fn()
    const { result } = renderHook(() =>
      useCanvasFrames({
        nodes: [rfNode('n1', 0, 0), rfNode('n2', 300, 200)],
        setNodes,
        edges: [],
        reactFlowInstance: null,
        groupSelectedNodes: () => {},
        onUngroup: () => {},
        onEnterGroup: () => {},
      }),
    )

    act(() => {
      result.current.createFrameFromSelection([rfNode('n1', 0, 0), rfNode('n2', 300, 200)])
    })

    const frames = usePipelineStore.getState().currentPipeline?.frames ?? []
    expect(frames).toHaveLength(1)
    expect(frames[0].nodeIds).toEqual(['n1', 'n2'])
    expect(frames[0].position).toEqual({ x: -24, y: -48 })

    // The RF layer gained a frame node (last setNodes call appends type:'frame').
    const lastUpdater = setNodes.mock.calls.at(-1)?.[0] as (nds: Node[]) => Node[]
    const appended = lastUpdater([rfNode('n1', 0, 0), rfNode('n2', 300, 200)])
    expect(appended.some((n) => n.type === 'frame' && n.id === frames[0].id)).toBe(true)
  })

  it('creates a frame from a single pipeline node (single-node frames allowed)', () => {
    // Upstream 3b907c5c lowered the threshold to ≥1 so one battery can be framed.
    seedStore(false)
    const { result } = renderHook(() =>
      useCanvasFrames({
        nodes: [rfNode('n1', 0, 0), rfNode('n2', 300, 200)],
        setNodes: vi.fn(),
        edges: [],
        reactFlowInstance: null,
        groupSelectedNodes: () => {},
        onUngroup: () => {},
        onEnterGroup: () => {},
      }),
    )

    act(() => {
      result.current.createFrameFromSelection([rfNode('n1', 0, 0)])
    })

    const frames = usePipelineStore.getState().currentPipeline?.frames ?? []
    expect(frames).toHaveLength(1)
    expect(frames[0].nodeIds).toEqual(['n1'])
  })

  it('does not create a frame when no selected nodes belong to the pipeline', () => {
    seedStore(false)
    const { result } = renderHook(() =>
      useCanvasFrames({
        nodes: [rfNode('ghost', 0, 0)],
        setNodes: vi.fn(),
        edges: [],
        reactFlowInstance: null,
        groupSelectedNodes: () => {},
        onUngroup: () => {},
        onEnterGroup: () => {},
      }),
    )

    act(() => {
      result.current.createFrameFromSelection([rfNode('ghost', 0, 0)])
    })

    expect(usePipelineStore.getState().currentPipeline?.frames ?? []).toHaveLength(0)
  })

  it('delete-key deletion removes frames without deleting pipeline nodes', () => {
    seedStore(true)
    const { result } = renderHook(() =>
      useCanvasDelete({
        nodes: [rfNode('n1', 0, 0), rfNode('n2', 300, 200)],
        edges: [],
        setEdges: vi.fn(),
        setNodes: vi.fn(),
      }),
    )

    act(() => {
      result.current.onNodesDelete([
        {
          id: 'frame_seed',
          type: 'frame',
          position: { x: -42, y: -76 },
          data: { nodeIds: ['n1', 'n2'] },
        } as Node,
      ])
    })

    const pipeline = usePipelineStore.getState().currentPipeline
    expect(pipeline?.frames ?? []).toHaveLength(0)
    expect(pipeline?.nodes.map((node) => node.id)).toEqual(['n1', 'n2'])
    expect(useHistoryStore.getState().entries).toHaveLength(0)
  })
})
