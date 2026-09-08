// Transport adapter tests — verify the editor data services map onto the
// kernel ApiClient: batteries from listOps, mutations through applyBatch,
// execution through execute, and the WS adapter forwarding graph/exec events.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OpSpec } from '@forgeax/node-runtime'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { applyOrder, sortSmallLabels } from '../components/sidebar/batteryGrouping.js'
import { createEditorTransport } from '../transport/index.js'
import { diffPipelineToOps } from '../transport/mappers.js'
import type { Pipeline } from '../types.js'

function spec(id: string, name: string): OpSpec {
  return { id, name, inputs: [], outputs: [], params: [], execute: () => null }
}

function categorizedSpec(id: string, name: string, category: string): OpSpec {
  return { ...spec(id, name), category } as OpSpec
}

function emptyPipeline(id = 'test-pipeline'): Pipeline {
  const now = '1970-01-01T00:00:00.000Z'
  return {
    id,
    name: id,
    description: '',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

describe('EditorApiAdapter', () => {
  it('getBatteries derives batteries from listOps()', async () => {
    const client = createMockApiClient({
      ops: [spec('wb-scene.csg.union', 'Union'), spec('wb-scene.grid.make', 'Grid')],
    })
    const { api } = createEditorTransport(client)

    const batteries = await api.getBatteries()

    expect(batteries.map((b) => b.id)).toEqual(['wb-scene.csg.union', 'wb-scene.grid.make'])
    expect(batteries[0].name).toBe('Union')
    // Category derives from the op-id namespace.
    expect(batteries[0].category).toBe('wb-scene')
  })

  it('getBatteries preserves access metadata on static and dynamic ports', async () => {
    const client = createMockApiClient({
      ops: [{
        ...spec('wb-scene.add_child', 'Add Child'),
        inputs: [
          { name: 'scene', type: 'scene', access: 'item' },
          { name: 'nodes', type: 'scene', access: 'list' },
        ],
        outputs: [
          { name: 'scene', type: 'scene', access: 'item' },
          { name: 'childPaths', type: 'string', access: 'list' },
        ],
        dynamicInputs: {
          prefix: 'item_',
          labelTemplate: '[$i]',
          minCount: 2,
          type: 'any',
          access: 'tree',
        },
      }],
    })
    const { api } = createEditorTransport(client)

    const [battery] = await api.getBatteries()

    expect(battery.inputs.find((p) => p.name === 'nodes')?.access).toBe('list')
    expect(battery.outputs.find((p) => p.name === 'childPaths')?.access).toBe('list')
    expect(battery.dynamicInputs?.access).toBe('tree')
  })

  it('getBatteries preserves inline SVG icons attached by plugin backends', async () => {
    const client = createMockApiClient({
      ops: [{
        ...categorizedSpec('toggle', 'Toggle', 'common/input'),
        iconSvg: '<svg viewBox="0 0 24 24"></svg>',
      } as OpSpec],
    })
    const { api } = createEditorTransport(client)

    const [battery] = await api.getBatteries()

    expect(battery.iconSvg).toContain('<svg')
  })

  it('getBatteries includes reusable group templates as group batteries', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    client.listGroupTemplates = async () => [{
      id: 'terrain-template',
      name: 'Terrain Template',
      category: 'terrain',
      displayGroup: 'templates/terrain',
      sourcePath: 'templates/terrain/Terrain/Terrain.json',
    }]
    const { api } = createEditorTransport(client)

    const batteries = await api.getBatteries()

    expect(batteries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'terrain-template',
        type: 'group',
        category: 'terrain',
        displayGroup: 'templates/terrain',
        sourcePath: 'templates/terrain/Terrain/Terrain.json',
      }),
    ]))
  })

  it('getCategories groups batteries by big tag', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One'), spec('b.two', 'Two')] })
    const { api } = createEditorTransport(client)

    const cats = await api.getCategories()

    expect(cats.map((c) => c.bigTag).sort()).toEqual(['a', 'b'])
  })

  it('does not treat backend category smallTags as user-saved small label order', async () => {
    const client = createMockApiClient({
      ops: [
        categorizedSpec('common.datatree', 'DataTree', 'common/datatree'),
        categorizedSpec('common.input', 'Input', 'common/input'),
        categorizedSpec('common.list', 'List', 'common/list'),
        categorizedSpec('common.number', 'Number', 'common/number'),
      ],
    })
    const { api } = createEditorTransport(client)

    const categories = await api.getCategories()
    const order = await api.getBatteryOrder()
    const commonLabels = categories.find((c) => c.bigTag === 'common')?.smallTags ?? []
    const rendered = applyOrder(order.smallLabels.common ?? [], sortSmallLabels(commonLabels, 'common'))

    expect(commonLabels).toEqual(['datatree', 'input', 'list', 'number'])
    expect(order.smallLabels.common).toBeUndefined()
    expect(rendered).toEqual(['input', 'list', 'datatree', 'number'])
  })

  it('returns an explicitly saved small label order', async () => {
    const client = createMockApiClient({
      ops: [
        categorizedSpec('common.datatree', 'DataTree', 'common/datatree'),
        categorizedSpec('common.input', 'Input', 'common/input'),
        categorizedSpec('common.list', 'List', 'common/list'),
      ],
    })
    const { api } = createEditorTransport(client)

    await api.saveBatteryOrder({
      bigLabels: ['common'],
      smallLabels: { common: ['datatree', 'input', 'list'] },
    })

    expect(await api.getBatteryOrder()).toEqual({
      bigLabels: ['common'],
      smallLabels: { common: ['datatree', 'input', 'list'] },
    })
  })

  it('updatePipeline submits the diff through applyBatch', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const applySpy = vi.spyOn(client, 'applyBatch')
    const { api } = createEditorTransport(client)

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'n1', batteryId: 'a.one', name: 'One', position: { x: 0, y: 0 }, params: {} })

    const res = await api.updatePipeline(desired)

    expect(res.status).toBe('ok')
    expect(applySpy).toHaveBeenCalledTimes(1)
    const ops = applySpy.mock.calls[0][0]
    expect(ops).toEqual([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])
    // The node is now in the kernel snapshot.
    const snap = await client.getPipeline()
    expect(snap?.nodes['n1']).toBeTruthy()
  })

  it('updatePipeline returns applyBatch diagnostics on rejection', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])
    vi.spyOn(client, 'applyBatch').mockResolvedValueOnce({
      status: 'rejected',
      reason: 'op validation failed',
      diagnostics: [{ opIndex: 1, severity: 'error', message: 'edge e12 does not exist' }],
    })
    const { api } = createEditorTransport(client)

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'n2', batteryId: 'a.one', name: 'Two', position: { x: 1, y: 1 }, params: {} })

    const res = await api.updatePipeline(desired)

    expect(res).toMatchObject({
      status: 'rejected',
      reason: 'op validation failed',
      diagnostics: [{ opIndex: 1, severity: 'error', message: 'edge e12 does not exist' }],
    })
  })

  it('updatePipeline with no changes does not call applyBatch', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const applySpy = vi.spyOn(client, 'applyBatch')
    const { api } = createEditorTransport(client)

    const res = await api.updatePipeline(emptyPipeline())

    expect(res.status).toBe('ok')
    expect(applySpy).not.toHaveBeenCalled()
  })

  it('executePipeline calls client.execute', async () => {
    const client = createMockApiClient()
    const execSpy = vi.spyOn(client, 'execute')
    const { api } = createEditorTransport(client)

    await api.executePipeline()
    expect(execSpy).toHaveBeenCalledWith(undefined)

    await api.executePipeline({ startNodeId: 'n1' })
    expect(execSpy).toHaveBeenLastCalledWith({ nodeId: 'n1' })
  })

  it('stopPipeline is a no-op stub that resolves', async () => {
    const { api } = createEditorTransport(createMockApiClient())
    await expect(api.stopPipeline()).resolves.toBeUndefined()
  })

  it('saveGroup emits a createGroup op and loadGroup reads it back', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One'), spec('a.two', 'Two')] })
    const { api } = createEditorTransport(client)
    await api.applyOps([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.two', position: { x: 10, y: 0 }, params: {} },
    ])

    const res = await api.saveGroup({
      id: 'g1',
      name: 'My Group',
      position: { x: 5, y: 0 },
      memberNodeIds: ['n1', 'n2'],
    })

    expect(res.status).toBe('ok')
    const group = await api.loadGroup('g1')
    expect(group?.name).toBe('My Group')
    expect(group?.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2'])
  })
})

describe('WsAdapter', () => {
  it('forwards graph:applied from the graph channel to editor listeners', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const { ws } = createEditorTransport(client)
    ws.connect()

    const seen: Array<{ batchId: string; newHash: string }> = []
    ws.on('graph:applied', (p) => seen.push(p))

    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])

    expect(seen).toHaveLength(1)
    expect(seen[0].newHash).toBeTruthy()
  })

  it('forwards execution events (started / node output / completed)', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const { ws } = createEditorTransport(client)
    ws.connect()
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])

    const kinds: string[] = []
    ws.on('exec:started', () => kinds.push('started'))
    ws.on('node:output', () => kinds.push('output'))
    ws.on('exec:completed', () => kinds.push('completed'))

    await client.execute()

    expect(kinds).toEqual(['started', 'output', 'completed'])
  })

  it('dispose() stops forwarding events', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const { ws } = createEditorTransport(client)
    ws.connect()
    const seen: unknown[] = []
    ws.on('graph:applied', (p) => seen.push(p))
    ws.dispose()

    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])
    expect(seen).toHaveLength(0)
  })
})

describe('diffPipelineToOps', () => {
  beforeEach(() => {
    /* pure function — no shared state */
  })

  it('emits createNode + connect for new graph, disconnect/deleteNode for removals', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One'), spec('a.two', 'Two')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])
    const current = await client.getPipeline()

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'n2', batteryId: 'a.two', name: 'Two', position: { x: 1, y: 1 }, params: {} })
    // n1 dropped, n2 added.

    const ops = diffPipelineToOps(desired, current)
    const types = ops.map((o) => o.type).sort()
    expect(types).toEqual(['createNode', 'deleteNode'])
  })

  it('emits updateNode only when params or position change', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: { k: 1 } },
    ])
    const current = await client.getPipeline()

    const same = emptyPipeline()
    same.nodes.push({ id: 'n1', batteryId: 'a.one', name: 'One', position: { x: 0, y: 0 }, params: { k: 1 } })
    expect(diffPipelineToOps(same, current)).toEqual([])

    const changed = emptyPipeline()
    changed.nodes.push({ id: 'n1', batteryId: 'a.one', name: 'One', position: { x: 0, y: 0 }, params: { k: 2 } })
    const ops = diffPipelineToOps(changed, current)
    expect(ops).toEqual([{ type: 'updateNode', nodeId: 'n1', params: { k: 2 } }])
  })

  it('emits createGroup instead of deleting grouped members during persist', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.one', position: { x: 100, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e12', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } },
    ])
    const current = await client.getPipeline()

    const desired = emptyPipeline()
    desired.nodes.push({
      id: 'g1',
      batteryId: '__group__',
      name: 'Group Node',
      position: { x: 50, y: 0 },
      params: { groupId: 'g1' },
    })
    desired.groups = [{
      id: 'g1',
      name: 'Group Node',
      position: { x: 50, y: 0 },
      nodes: [
        { id: 'n1', batteryId: 'a.one', name: 'One', position: { x: 0, y: 0 }, params: {} },
        { id: 'n2', batteryId: 'a.one', name: 'One', position: { x: 100, y: 0 }, params: {} },
      ],
      edges: [{ id: 'e12', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } }],
      exposedInputs: [],
      exposedOutputs: [{ portName: 'out__n2__out', portType: 'any', sourceNodeId: 'n2', sourcePortName: 'out' }],
    }]

    const ops = diffPipelineToOps(desired, current)

    expect(ops).toEqual([
      { type: 'createGroup', groupId: 'g1', name: 'Group Node', position: { x: 50, y: 0 }, memberNodeIds: ['n1', 'n2'] },
    ])
  })

  it('emits deleteGroup when an existing group shadow is removed', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.one', position: { x: 100, y: 0 }, params: {} },
      { type: 'createGroup', groupId: 'g1', name: 'Group Node', position: { x: 50, y: 0 }, memberNodeIds: ['n1', 'n2'] },
    ])
    const current = await client.getPipeline()

    const desired = emptyPipeline()
    desired.groups = []

    expect(diffPipelineToOps(desired, current)).toEqual([{ type: 'deleteGroup', groupId: 'g1' }])
  })

  it('does not disconnect edges that deleteNode already removes by cascade', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.one', position: { x: 100, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e12', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } },
    ])
    const current = await client.getPipeline()

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'n2', batteryId: 'a.one', name: 'Two', position: { x: 100, y: 0 }, params: {} })

    expect(diffPipelineToOps(desired, current)).toEqual([{ type: 'deleteNode', nodeId: 'n1' }])
  })
})
