import { describe, it, expect } from 'vitest'
import { resolveNodeInputs, buildExecutionClosure } from '../layer2/resolve-inputs.js'
import type { GraphEdge, GraphNode } from '../layer1/index.js'

const node = (id: string): GraphNode => ({ id, opId: 'x', position: { x: 0, y: 0 }, params: {} })
const edge = (id: string, s: string, sp: string, t: string, tp: string): GraphEdge => ({
  id,
  source: { nodeId: s, port: sp },
  target: { nodeId: t, port: tp },
})

describe('resolveNodeInputs', () => {
  it('reads upstream port values keyed by the target port name', () => {
    const edges = [edge('e1', 's', 'out', 'd', 'in')]
    const produced = new Map<string, Record<string, unknown>>([['s', { out: [{ path: [0], items: [7] }] }]])
    const inputs = resolveNodeInputs(node('d'), edges, produced)
    expect(inputs).toEqual({ in: [{ path: [0], items: [7] }] })
  })

  it('omits inputs whose upstream output has not been produced', () => {
    const edges = [edge('e1', 's', 'out', 'd', 'in')]
    const produced = new Map<string, Record<string, unknown>>()
    expect(resolveNodeInputs(node('d'), edges, produced)).toEqual({})
  })

  it('hydrates a boundary upstream input from the output cache when not produced this run', () => {
    const edges = [edge('e1', 's', 'out', 'd', 'in')]
    const produced = new Map<string, Record<string, unknown>>()
    const readCache = (nodeId: string, port: string) =>
      nodeId === 's' && port === 'out' ? [{ path: [0], items: [9] }] : undefined
    expect(resolveNodeInputs(node('d'), edges, produced, readCache)).toEqual({ in: [{ path: [0], items: [9] }] })
  })

  it('prefers a this-run produced value over the cache', () => {
    const edges = [edge('e1', 's', 'out', 'd', 'in')]
    const produced = new Map<string, Record<string, unknown>>([['s', { out: [{ path: [0], items: [1] }] }]])
    const readCache = () => [{ path: [0], items: [999] }]
    expect(resolveNodeInputs(node('d'), edges, produced, readCache)).toEqual({ in: [{ path: [0], items: [1] }] })
  })
})

describe('buildExecutionClosure', () => {
  const nodes: Record<string, GraphNode> = { a: node('a'), b: node('b'), c: node('c') }
  // a -> b -> c
  const edges: Record<string, GraphEdge> = {
    e1: edge('e1', 'a', 'out', 'b', 'in'),
    e2: edge('e2', 'b', 'out', 'c', 'in'),
  }

  it('pipeline mode returns all nodes in topological order', () => {
    const closure = buildExecutionClosure(nodes, edges, undefined)
    expect(closure.sorted).toEqual(['a', 'b', 'c'])
  })

  it('target mode returns the downstream closure of the target (the node + descendants)', () => {
    const closure = buildExecutionClosure(nodes, edges, 'b')
    expect(closure.sorted).toEqual(['b', 'c'])
  })

  it('throws on an unknown target node', () => {
    expect(() => buildExecutionClosure(nodes, edges, 'nope')).toThrow(/not found/)
  })

  it('throws on a cyclic closure', () => {
    const cyclicEdges: Record<string, GraphEdge> = {
      e1: edge('e1', 'a', 'out', 'b', 'in'),
      e2: edge('e2', 'b', 'out', 'a', 'in'),
    }
    expect(() => buildExecutionClosure({ a: node('a'), b: node('b') }, cyclicEdges, undefined)).toThrow(/cycle/)
  })
})
