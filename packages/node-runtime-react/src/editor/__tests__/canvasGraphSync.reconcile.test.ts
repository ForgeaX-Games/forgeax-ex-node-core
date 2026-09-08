// Regression test for the incremental canvas reconcile (the "drag one battery,
// all batteries reload" fix). The legacy editor never blanket-rebuilt the
// ReactFlow layer on a graph mutation; the kernel port's `pipelineRevision`
// blanket `setNodes(built)` handed every node a fresh object on every committed
// batch (including a local drag-add's own persist round-trip), so `memo`'d node
// components re-rendered for ALL nodes. `reconcileCanvasNodes` /
// `reconcileCanvasEdges` restore the legacy guarantee: unchanged nodes/edges
// keep their object identity, only added/changed/removed ones update.

import { describe, expect, it } from 'vitest'
import type { Node, Edge } from 'reactflow'

import {
  reconcileCanvasNodes,
  reconcileCanvasEdges,
} from '../components/canvas/useCanvasGraphSync.js'
import type { Battery } from '../types.js'

const battery = { id: 'demo.echo', name: 'Echo' } as unknown as Battery

function batteryNode(id: string, params: Record<string, unknown> = {}, selected = false): Node {
  return {
    id,
    type: 'battery',
    position: { x: 10, y: 20 },
    style: { width: 180 },
    data: { battery, params },
    selected,
  }
}

function edge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    sourceHandle: 'out',
    targetHandle: 'in',
    animated: false,
    style: { stroke: '#fff', strokeWidth: 2 },
  }
}

describe('reconcileCanvasNodes', () => {
  it('preserves object identity for unaffected nodes when a node is added', () => {
    const prev = [batteryNode('n1'), batteryNode('n2')]
    // A fresh snapshot reparses params into NEW object refs even when identical.
    const built = [
      batteryNode('n1', {}), // content-equal but different object
      batteryNode('n2', {}),
      batteryNode('n3', {}), // the dragged-in node
    ]

    const result = reconcileCanvasNodes(prev, built)

    // n1 / n2 keep their PREVIOUS references (memo short-circuits → no reload).
    expect(result[0]).toBe(prev[0])
    expect(result[1]).toBe(prev[1])
    // Only the new node is a fresh object.
    expect(result[2].id).toBe('n3')
    expect(result[2]).toBe(built[2])

    // Concrete "incremental" evidence: exactly ONE node object changed identity.
    const rebuilt = result.filter((n, i) => n !== prev[i])
    expect(rebuilt).toHaveLength(1)
    expect(rebuilt[0].id).toBe('n3')
  })

  it('returns the previous array (no churn) when nothing changed', () => {
    const prev = [batteryNode('n1', { k: 1 }), batteryNode('n2')]
    const built = [batteryNode('n1', { k: 1 }), batteryNode('n2')]
    expect(reconcileCanvasNodes(prev, built)).toBe(prev)
  })

  it('rebuilds only the node whose params changed', () => {
    const prev = [batteryNode('n1', { seed: 1 }), batteryNode('n2', { seed: 2 })]
    const built = [batteryNode('n1', { seed: 1 }), batteryNode('n2', { seed: 99 })]
    const result = reconcileCanvasNodes(prev, built)
    expect(result[0]).toBe(prev[0]) // untouched
    expect(result[1]).not.toBe(prev[1]) // changed
    expect(result[1].data.params).toEqual({ seed: 99 })
  })

  it('drops a removed node and keeps the survivors stable', () => {
    const prev = [batteryNode('n1'), batteryNode('n2'), batteryNode('n3')]
    const built = [batteryNode('n1'), batteryNode('n3')]
    const result = reconcileCanvasNodes(prev, built)
    expect(result.map((n) => n.id)).toEqual(['n1', 'n3'])
    expect(result[0]).toBe(prev[0])
    expect(result[1]).toBe(prev[2])
  })

  it('preserves selection across a reconcile', () => {
    const prev = [batteryNode('n1', {}, true), batteryNode('n2')]
    const built = [batteryNode('n1', {}), batteryNode('n2'), batteryNode('n3')]
    const result = reconcileCanvasNodes(prev, built)
    // n1 reused → still selected.
    expect(result[0]).toBe(prev[0])
    expect(result[0].selected).toBe(true)
  })

  it('treats deep-equal object params as unchanged (no needless rebuild)', () => {
    const prev = [batteryNode('n1', { ports: ['a', 'b'], cfg: { x: 1 } })]
    const built = [batteryNode('n1', { ports: ['a', 'b'], cfg: { x: 1 } })]
    expect(reconcileCanvasNodes(prev, built)).toBe(prev)
  })
})

describe('reconcileCanvasEdges', () => {
  it('preserves identity for unchanged edges and adds the new one', () => {
    const prev = [edge('e1', 'n1', 'n2')]
    const built = [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')]
    const result = reconcileCanvasEdges(prev, built)
    expect(result[0]).toBe(prev[0])
    expect(result[1].id).toBe('e2')
  })

  it('returns the previous array when edges are unchanged', () => {
    const prev = [edge('e1', 'n1', 'n2')]
    const built = [edge('e1', 'n1', 'n2')]
    expect(reconcileCanvasEdges(prev, built)).toBe(prev)
  })
})
