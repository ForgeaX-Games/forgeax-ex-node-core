// useCanvasConnect tests — guards the restored `inferredAccess` connect-hook.
//
// Regression: the kernel port originally dropped the legacy tree_merge slot[0]
// behaviour-band lock (resolvePortAccess + inferred* write), so scene inputs
// (access:'item') fell into the structural-pack default branch instead of the
// item-concat branch. These tests pin the faithful behaviour back:
//   (1) onConnect on item_0 from an item-access source locks inferredAccess +
//       inferredType onto the tree_merge node params;
//   (2) isValidConnection rejects a later slot whose access disagrees with the
//       locked band, and accepts one that matches;
//   (3) a source without access (relay) does not write inferred*.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Connection, Edge, Node } from 'reactflow'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport, createEditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import { createEmptyPipeline } from '../stores/pipelineStore.helpers.js'
import { useCanvasConnect, resolveConnectionPortType } from '../components/canvas/useCanvasConnect.js'
import type { Battery, Pipeline } from '../types.js'

const treeMergeBattery: Battery = {
  id: 'tree_merge',
  name: 'TreeMerge',
  type: 'special',
  category: 'datatree',
  description: '',
  version: '1.0.0',
  inputs: [
    { name: 'item_0', type: 'any', access: 'tree' },
    { name: 'item_1', type: 'any', access: 'tree' },
  ],
  outputs: [{ name: 'tree', type: 'any', access: 'tree' }],
  params: [],
  dynamicInputs: { prefix: 'item_', labelTemplate: '[$i]', minCount: 2, type: 'any', access: 'tree' },
}

// A grid2node-like scene source: its output port carries access:'item'.
const sceneSourceBattery: Battery = {
  id: 'grid2node',
  name: 'Grid2Node',
  type: 'ts',
  category: 'scene',
  description: '',
  version: '1.0.0',
  inputs: [],
  outputs: [{ name: 'scene', type: 'scene', access: 'item' }],
  params: [],
}

// A list-access source — disagrees with the locked 'item' band.
const listSourceBattery: Battery = {
  id: 'list_src',
  name: 'ListSrc',
  type: 'ts',
  category: 'datatree',
  description: '',
  version: '1.0.0',
  inputs: [],
  outputs: [{ name: 'out', type: 'scene', access: 'list' }],
  params: [],
}

function batteryNode(id: string, battery: Battery, params: Record<string, unknown> = {}): Node {
  return {
    id,
    type: 'battery',
    position: { x: 0, y: 0 },
    data: { battery, params },
  }
}

function seedPipeline(): Pipeline {
  const p = createEmptyPipeline()
  p.nodes = [
    { id: 'tm', batteryId: 'tree_merge', name: 'TreeMerge', position: { x: 0, y: 0 }, params: {} },
    { id: 's0', batteryId: 'grid2node', name: 'A', position: { x: 0, y: 0 }, params: {} },
    { id: 's1', batteryId: 'grid2node', name: 'B', position: { x: 0, y: 0 }, params: {} },
  ]
  return p
}

beforeEach(() => {
  const client = createMockApiClient({ ops: [] })
  configureEditorTransport(createEditorTransport(client))
  usePipelineStore.setState({
    batteries: [treeMergeBattery, sceneSourceBattery, listSourceBattery],
    currentPipeline: seedPipeline(),
    selectedNode: null,
    selectedNodeIds: [],
    logs: [],
    nodeOutputs: {},
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
})

afterEach(() => {
  usePipelineStore.setState({ currentPipeline: null })
})

function makeHook(nodes: Node[]) {
  let edges: Edge[] = []
  let rfNodes = nodes
  const setEdges = (updater: Edge[] | ((e: Edge[]) => Edge[])) => {
    edges = typeof updater === 'function' ? (updater as (e: Edge[]) => Edge[])(edges) : updater
  }
  const setNodes = (updater: Node[] | ((n: Node[]) => Node[])) => {
    rfNodes = typeof updater === 'function' ? (updater as (n: Node[]) => Node[])(rfNodes) : updater
  }
  const { result } = renderHook(() => useCanvasConnect({ nodes: rfNodes, setEdges, setNodes }))
  return { result, getEdges: () => edges, getNodes: () => rfNodes }
}

describe('useCanvasConnect — tree_merge inferredAccess lock', () => {
  it('locks inferredAccess/inferredType on item_0 connect from an item-access source', () => {
    const tm = batteryNode('tm', treeMergeBattery, { portCount: 2 })
    const s0 = batteryNode('s0', sceneSourceBattery)
    const { result } = makeHook([tm, s0])

    const conn: Connection = { source: 's0', sourceHandle: 'scene', target: 'tm', targetHandle: 'item_0' }
    act(() => {
      result.current.onConnect(conn)
    })

    const node = usePipelineStore.getState().currentPipeline!.nodes.find((n) => n.id === 'tm')!
    expect(node.params.inferredAccess).toBe('item')
    expect(node.params.inferredType).toBe('scene')
  })

  it('does not write inferred* when the source carries no access', () => {
    // Relay source: resolvePortAccess returns undefined → no lock.
    const tm = batteryNode('tm', treeMergeBattery, { portCount: 2 })
    const relay: Node = {
      id: 'r0',
      type: 'relay',
      position: { x: 0, y: 0 },
      data: { portType: 'scene' },
    }
    const { result } = makeHook([tm, relay])
    act(() => {
      result.current.onConnect({ source: 'r0', sourceHandle: 'relay_out', target: 'tm', targetHandle: 'item_0' })
    })
    const node = usePipelineStore.getState().currentPipeline!.nodes.find((n) => n.id === 'tm')!
    expect(node.params.inferredAccess).toBeUndefined()
  })

  it('isValidConnection rejects a later slot whose access disagrees with the locked band', () => {
    const tm = batteryNode('tm', treeMergeBattery, { portCount: 3, inferredAccess: 'item', inferredType: 'scene' })
    const sceneSrc = batteryNode('s1', sceneSourceBattery)
    const listSrc = batteryNode('l1', listSourceBattery)
    const { result } = makeHook([tm, sceneSrc, listSrc])

    // list-access source into item-locked slot → rejected.
    expect(
      result.current.isValidConnection({ source: 'l1', sourceHandle: 'out', target: 'tm', targetHandle: 'item_1' }),
    ).toBe(false)

    // matching item-access source → accepted.
    expect(
      result.current.isValidConnection({ source: 's1', sourceHandle: 'scene', target: 'tm', targetHandle: 'item_1' }),
    ).toBe(true)
  })

  it('isValidConnection imposes no access lock before slot[0] is connected', () => {
    const tm = batteryNode('tm', treeMergeBattery, { portCount: 3 })
    const listSrc = batteryNode('l1', listSourceBattery)
    const { result } = makeHook([tm, listSrc])
    expect(
      result.current.isValidConnection({ source: 'l1', sourceHandle: 'out', target: 'tm', targetHandle: 'item_1' }),
    ).toBe(true)
  })
})

// Group boundary ports now mirror the inner port's real type + access, so
// cross-group wires type-check and colour by the inner tier instead of a flat
// `any`. These tests pin resolveConnectionPortType + the access-driven lock.
function collapsedGroupNode(id: string): Node {
  return {
    id,
    type: 'group',
    position: { x: 0, y: 0 },
    data: {
      groupId: id,
      groupName: 'G',
      exposedInputs: [{ portName: 'in:x:seed', portType: 'string', access: 'item', sourceNodeId: 'x', sourcePortName: 'seed' }],
      exposedOutputs: [{ portName: 'out:x:scene', portType: 'scene', access: 'item', sourceNodeId: 'x', sourcePortName: 'scene' }],
    },
  }
}

function boundaryNode(id: string, boundaryType: 'input' | 'output'): Node {
  return {
    id,
    type: boundaryType === 'input' ? 'group_input' : 'group_output',
    position: { x: 0, y: 0 },
    data: {
      boundaryType,
      groupId: 'g',
      ports: [{ portName: 'p:scene', portType: 'scene', access: 'item', sourceNodeId: 'x', sourcePortName: 'scene' }],
    },
  }
}

describe('useCanvasConnect — group boundary port resolution', () => {
  it('resolves a collapsed group node output/input port type (not any)', () => {
    const g = collapsedGroupNode('g1')
    expect(resolveConnectionPortType(g, 'out:x:scene', 'source')).toBe('scene')
    expect(resolveConnectionPortType(g, 'in:x:seed', 'target')).toBe('string')
    // Unknown handle → undefined (caller treats as permissive).
    expect(resolveConnectionPortType(g, 'nope', 'source')).toBeUndefined()
  })

  it('resolves inner-view boundary node port type for both source and target handles', () => {
    const gin = boundaryNode('gi', 'input')
    const gout = boundaryNode('go', 'output')
    expect(resolveConnectionPortType(gin, 'p:scene', 'source')).toBe('scene')
    expect(resolveConnectionPortType(gout, 'p:scene', 'target')).toBe('scene')
  })

  it('cross-group wire type-checks by the inner tier (scene→scene ok)', () => {
    const tm = batteryNode('tm', treeMergeBattery, { portCount: 2 })
    const g = collapsedGroupNode('g1')
    const { result } = makeHook([tm, g])
    // group output (scene) into a fresh tree_merge slot → allowed.
    expect(
      result.current.isValidConnection({ source: 'g1', sourceHandle: 'out:x:scene', target: 'tm', targetHandle: 'item_0' }),
    ).toBe(true)
  })

  it('group output access locks the tree_merge band on item_0 connect', () => {
    const tm = batteryNode('tm', treeMergeBattery, { portCount: 2 })
    const g = collapsedGroupNode('g1')
    const { result } = makeHook([tm, g])
    act(() => {
      result.current.onConnect({ source: 'g1', sourceHandle: 'out:x:scene', target: 'tm', targetHandle: 'item_0' })
    })
    const node = usePipelineStore.getState().currentPipeline!.nodes.find((n) => n.id === 'tm')!
    expect(node.params.inferredAccess).toBe('item')
    expect(node.params.inferredType).toBe('scene')
  })
})
