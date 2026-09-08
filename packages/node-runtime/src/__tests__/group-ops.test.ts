// Layer 2 Group Ops — createGroup / updateGroup / ungroup round-trip.
//
// Exercises the core group flow:
//   1. Three-node graph with two boundary-crossing edges + one
//      internal-only edge wraps into a group.
//   2. Outer edges get rewritten to reference the group via synthetic
//      exposed-port names; the internal edge moves into the sub-graph.
//   3. updateGroup mutates name/position on both the shadow node AND
//      the sub-graph entry.
//   4. ungroup restores everything: members + internal edges return to
//      top level, outer edges rewrite back to the original endpoints.
//   5. Validation: missing member, member-is-group, non-existent group.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyBatch,
  createRuntime,
  getGroup,
  getPipeline,
  listGroups,
  listNodes,
} from '../layer2/index.js'
import { GROUP_OP_ID } from '../layer2/apply-batch.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-group-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

function fresh() {
  return createRuntime({
    projectRoot: scratchDir,
    pipelineId: 'pgroup',
    pluginId: 'plugin.test',
  })
}

async function seedTriangle(runtime: ReturnType<typeof fresh>) {
  // a -> b -> c (linear), plus an outsider d connected into b.
  // Grouping {a, b} should:
  //   - move a, b out of top level
  //   - move edge a→b into the group's internal edges
  //   - rewrite edge d→b's target to the group (with an input exposed port)
  //   - rewrite edge b→c's source to the group (with an output exposed port)
  await applyBatch(runtime, [
    { type: 'createNode', nodeId: 'a', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} },
    { type: 'createNode', nodeId: 'b', opId: 'demo.echo', position: { x: 100, y: 0 }, params: {} },
    { type: 'createNode', nodeId: 'c', opId: 'demo.echo', position: { x: 200, y: 0 }, params: {} },
    { type: 'createNode', nodeId: 'd', opId: 'demo.echo', position: { x: 0, y: 100 }, params: {} },
    { type: 'connect', edgeId: 'e_ab', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
    { type: 'connect', edgeId: 'e_bc', source: { nodeId: 'b', port: 'out' }, target: { nodeId: 'c', port: 'in' } },
    { type: 'connect', edgeId: 'e_db', source: { nodeId: 'd', port: 'out' }, target: { nodeId: 'b', port: 'aux' } },
  ])
}

describe('Layer 2 Group Ops', () => {
  it('createGroup wraps members, rewires boundary edges, derives exposed ports', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)

    const result = await applyBatch(runtime, [
      {
        type: 'createGroup',
        groupId: 'g1',
        name: 'Inner',
        memberNodeIds: ['a', 'b'],
        position: { x: 50, y: 0 },
      },
    ])
    expect(result.status).toBe('ok')

    const snap = getPipeline(runtime)
    expect(snap).not.toBeNull()
    // Top-level nodes: c, d, plus the group shadow node g1. a + b moved into the group.
    expect(Object.keys(snap!.nodes).sort()).toEqual(['c', 'd', 'g1'])
    expect(snap!.nodes.g1!.opId).toBe(GROUP_OP_ID)
    expect(snap!.nodes.g1!.name).toBe('Inner')
    expect(snap!.nodes.g1!.params).toEqual({ groupId: 'g1' })

    // Outer edges: e_db (rewritten) + e_bc (rewritten). Internal edge e_ab moved into group.
    expect(Object.keys(snap!.edges).sort()).toEqual(['e_bc', 'e_db'])
    expect(snap!.edges.e_db!.target.nodeId).toBe('g1')
    expect(snap!.edges.e_bc!.source.nodeId).toBe('g1')

    const group = getGroup(runtime, 'g1')
    expect(group).not.toBeNull()
    expect(group!.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(group!.edges.map((e) => e.id)).toEqual(['e_ab'])
    // d→b became an input on the group; b→c became an output.
    expect(group!.exposedInputs.map((p) => p.sourceNodeId)).toEqual(['b'])
    expect(group!.exposedInputs[0]!.sourcePortName).toBe('aux')
    expect(group!.exposedOutputs.map((p) => p.sourceNodeId)).toEqual(['b'])
    expect(group!.exposedOutputs[0]!.sourcePortName).toBe('out')

    // listGroups returns it.
    expect(listGroups(runtime).map((g) => g.id)).toEqual(['g1'])
  })

  it('updateGroup mutates name + position on both shadow node and group entry', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Old', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])

    await applyBatch(runtime, [
      { type: 'updateGroup', groupId: 'g1', name: 'New', position: { x: 999, y: 999 } },
    ])

    const group = getGroup(runtime, 'g1')!
    expect(group.name).toBe('New')
    expect(group.position).toEqual({ x: 999, y: 999 })
    const node = listNodes(runtime).find((n) => n.id === 'g1')!
    expect(node.name).toBe('New')
    expect(node.position).toEqual({ x: 999, y: 999 })
  })

  it('ungroup restores members + internal edges + rewrites outer edges back', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Inner', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])

    const result = await applyBatch(runtime, [{ type: 'ungroup', groupId: 'g1' }])
    expect(result.status).toBe('ok')

    const snap = getPipeline(runtime)!
    // All 4 nodes back at top level; g1 gone.
    expect(Object.keys(snap.nodes).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(snap.nodes.g1).toBeUndefined()
    // All 3 edges back, with original endpoints.
    expect(Object.keys(snap.edges).sort()).toEqual(['e_ab', 'e_bc', 'e_db'])
    expect(snap.edges.e_ab!.source.nodeId).toBe('a')
    expect(snap.edges.e_ab!.target.nodeId).toBe('b')
    expect(snap.edges.e_db!.target.nodeId).toBe('b')
    expect(snap.edges.e_db!.target.port).toBe('aux')
    expect(snap.edges.e_bc!.source.nodeId).toBe('b')
    expect(snap.edges.e_bc!.source.port).toBe('out')

    expect(listGroups(runtime)).toEqual([])
  })

  it('deleteGroup removes the composite without restoring inner members', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Inner', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])

    const result = await applyBatch(runtime, [{ type: 'deleteGroup', groupId: 'g1' }])
    expect(result.status).toBe('ok')

    const snap = getPipeline(runtime)!
    expect(Object.keys(snap.nodes).sort()).toEqual(['c', 'd'])
    expect(snap.nodes.g1).toBeUndefined()
    expect(Object.keys(snap.edges)).toEqual([])
    expect(listGroups(runtime)).toEqual([])
  })

  it('rejects createGroup with a missing member', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    const result = await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'X', memberNodeIds: ['a', 'nope'], position: { x: 0, y: 0 } },
    ])
    expect(result.status).toBe('rejected')
    expect(result.diagnostics?.[0]?.message).toContain('member nope does not exist')
    // Original graph untouched.
    expect(listNodes(runtime).map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('rejects createGroup whose member is itself a group (no nested groups in v0.2.0)', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Inner', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])
    const result = await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g2', name: 'Outer', memberNodeIds: ['g1', 'c'], position: { x: 0, y: 0 } },
    ])
    expect(result.status).toBe('rejected')
    expect(result.diagnostics?.[0]?.message).toContain('nested groups')
  })

  it('rejects ungroup of a non-existent group', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    const result = await applyBatch(runtime, [{ type: 'ungroup', groupId: 'nope' }])
    expect(result.status).toBe('rejected')
  })

  it('createGroup resolves real boundary port type + access from member OpSpecs', async () => {
    const runtime = fresh()
    runtime.registry.register({
      id: 'demo.scene-source',
      inputs: [{ name: 'seed', type: 'string', access: 'item' }],
      outputs: [{ name: 'out', type: 'scene', access: 'item' }],
      params: [],
      execute: () => ({ out: null }),
    })
    runtime.registry.register({
      id: 'demo.scene-sink',
      inputs: [{ name: 'scene', type: 'scene', access: 'list' }],
      outputs: [{ name: 'done', type: 'string', access: 'item' }],
      params: [],
      execute: () => ({ done: 'ok' }),
    })

    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'src', opId: 'demo.scene-source', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'snk', opId: 'demo.scene-sink', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'down', opId: 'demo.scene-sink', position: { x: 200, y: 0 }, params: {} },
      // upstream feeds the grouped sink's input (boundary input)
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'snk', port: 'scene' } },
      // grouped sink's output feeds an outside node (boundary output)
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'snk', port: 'done' }, target: { nodeId: 'down', port: 'scene' } },
    ])

    const result = await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Sink', memberNodeIds: ['snk'], position: { x: 50, y: 0 } },
    ])
    expect(result.status).toBe('ok')

    const group = getGroup(runtime, 'g1')!
    // Input boundary mirrors snk.scene → type 'scene', access 'list'.
    expect(group.exposedInputs).toHaveLength(1)
    expect(group.exposedInputs[0]!.portType).toBe('scene')
    expect(group.exposedInputs[0]!.access).toBe('list')
    // Output boundary mirrors snk.done → type 'string', access 'item'.
    expect(group.exposedOutputs).toHaveLength(1)
    expect(group.exposedOutputs[0]!.portType).toBe('string')
    expect(group.exposedOutputs[0]!.access).toBe('item')
  })

  it('createGroup resolves dynamic-port boundary type/access from the dynamic template', async () => {
    const runtime = fresh()
    runtime.registry.register({
      id: 'demo.tree-merge',
      inputs: [],
      outputs: [{ name: 'tree', type: 'any', access: 'tree' }],
      params: [],
      dynamicInputs: { prefix: 'item_', labelTemplate: '[$i]', minCount: 2, type: 'any', access: 'tree' },
      execute: () => ({ tree: null }),
    })
    runtime.registry.register({
      id: 'demo.scene-source',
      inputs: [],
      outputs: [{ name: 'out', type: 'scene', access: 'item' }],
      params: [],
      execute: () => ({ out: null }),
    })

    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'src', opId: 'demo.scene-source', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'mg', opId: 'demo.tree-merge', position: { x: 100, y: 0 }, params: { portCount: 2 } },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'mg', port: 'item_0' } },
    ])

    const result = await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Merge', memberNodeIds: ['mg'], position: { x: 50, y: 0 } },
    ])
    expect(result.status).toBe('ok')

    const group = getGroup(runtime, 'g1')!
    // The dynamic input slot item_0 resolves from dynamicInputs → 'any' / 'tree'.
    expect(group.exposedInputs).toHaveLength(1)
    expect(group.exposedInputs[0]!.sourcePortName).toBe('item_0')
    expect(group.exposedInputs[0]!.portType).toBe('any')
    expect(group.exposedInputs[0]!.access).toBe('tree')
  })

  it('leaves boundary ports as untyped any when member ops are unregistered', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Inner', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])
    const group = getGroup(runtime, 'g1')!
    expect(group.exposedInputs[0]!.portType).toBe('any')
    expect(group.exposedInputs[0]!.access).toBeUndefined()
    expect(group.exposedOutputs[0]!.portType).toBe('any')
  })
})
