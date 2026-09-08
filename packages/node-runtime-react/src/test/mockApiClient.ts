// In-memory ApiClient implementation used by component / hook tests.
//
// Mirrors the Layer 2 contract closely enough that hooks under test
// can drive realistic apply/query/subscribe cycles without any
// network or filesystem. Helper handles `__state` and `__reset` are
// non-public conveniences for test setup.

import type { ApiClient } from '../api/ApiClient.js'
import type {
  ApplyBatchOptions,
  ApplyBatchResult,
  ExecutionResult,
  GraphEdge,
  GraphNode,
  HistoryEntryV1,
  HistoryQuery,
  NodeFilter,
  NodeGroup,
  Op,
  OpSpec,
  PipelineSnapshot,
  RuntimeChannel,
  RuntimeEvent,
} from '@forgeax/node-runtime'

export interface MockState {
  pipelineId: string
  nodes: Map<string, GraphNode>
  edges: Map<string, GraphEdge>
  history: HistoryEntryV1[]
  ops: OpSpec[]
  /** Toy hash — increments with each applied batch. */
  hash: string
  /** Resolved asset path overrides keyed by template (test-supplied). */
  assetPaths: Map<string, string>
  /** Group sub-graphs keyed by groupId (Phase G). */
  groups: Map<string, NodeGroup>
}

export interface MockApiClient extends ApiClient {
  readonly __state: MockState
  __reset(initial?: Partial<MockSeed>): void
}

export interface MockSeed {
  pipelineId: string
  nodes: readonly GraphNode[]
  edges: readonly GraphEdge[]
  history: readonly HistoryEntryV1[]
  ops: readonly OpSpec[]
  assetPaths: Record<string, string>
}

export function createMockApiClient(seed: Partial<MockSeed> = {}): MockApiClient {
  const state: MockState = freshState(seed)
  const subs = new Map<RuntimeChannel, Set<(e: RuntimeEvent) => void>>()
  // Deterministic execution id source — avoids Math.random/Date.now so tests
  // can assert exact values across the simulated run.
  let execCounter = 0

  function emit(channel: RuntimeChannel, event: RuntimeEvent): void {
    const listeners = subs.get(channel)
    if (!listeners) return
    for (const l of listeners) l(event)
  }

  function bumpHash(): string {
    state.hash = `mock-${state.nodes.size}-${state.edges.size}-${state.history.length + 1}`
    return state.hash
  }

  function applyOpToState(op: Op): void {
    switch (op.type) {
      case 'createNode': {
        const node: GraphNode = {
          id: op.nodeId,
          opId: op.opId,
          position: op.position,
          params: { ...op.params },
          ...(op.name !== undefined ? { name: op.name } : {}),
        }
        state.nodes.set(op.nodeId, node)
        return
      }
      case 'updateNode': {
        const existing = state.nodes.get(op.nodeId)
        if (!existing) return
        const next: GraphNode = {
          ...existing,
          position: op.position ?? existing.position,
          params: op.params ? { ...existing.params, ...op.params } : existing.params,
        }
        state.nodes.set(op.nodeId, next)
        return
      }
      case 'deleteNode': {
        state.nodes.delete(op.nodeId)
        // Cascade-delete any edge touching this node — matches kernel semantics.
        for (const [eid, edge] of state.edges) {
          if (edge.source.nodeId === op.nodeId || edge.target.nodeId === op.nodeId) {
            state.edges.delete(eid)
          }
        }
        return
      }
      case 'connect': {
        const edge: GraphEdge = {
          id: op.edgeId,
          source: { ...op.source },
          target: { ...op.target },
        }
        state.edges.set(op.edgeId, edge)
        return
      }
      case 'disconnect': {
        state.edges.delete(op.edgeId)
        return
      }
      case 'setMetadata':
        // Toy mock keeps metadata only in history; no separate field.
        return
      case 'deleteGroup': {
        state.nodes.delete(op.groupId)
        state.groups.delete(op.groupId)
        for (const [eid, edge] of state.edges) {
          if (edge.source.nodeId === op.groupId || edge.target.nodeId === op.groupId) {
            state.edges.delete(eid)
          }
        }
        return
      }
      case 'createGroup': {
        const members = new Set(op.memberNodeIds)
        const innerNodes: GraphNode[] = []
        for (const id of op.memberNodeIds) {
          const n = state.nodes.get(id)
          if (n) {
            innerNodes.push(n)
            state.nodes.delete(id)
          }
        }
        const innerEdges: GraphEdge[] = []
        const exposedInputs: NodeGroup['exposedInputs'] = []
        const exposedOutputs: NodeGroup['exposedOutputs'] = []
        for (const [eid, edge] of state.edges) {
          const sIn = members.has(edge.source.nodeId)
          const tIn = members.has(edge.target.nodeId)
          if (sIn && tIn) {
            innerEdges.push(edge)
            state.edges.delete(eid)
          } else if (sIn && !tIn) {
            const portName = `out:${edge.source.nodeId}:${edge.source.port}`
            if (!exposedOutputs.some(p => p.portName === portName)) {
              exposedOutputs.push({
                portName, portType: 'any',
                sourceNodeId: edge.source.nodeId, sourcePortName: edge.source.port,
              })
            }
            state.edges.set(eid, { ...edge, source: { nodeId: op.groupId, port: portName } })
          } else if (!sIn && tIn) {
            const portName = `in:${edge.target.nodeId}:${edge.target.port}`
            if (!exposedInputs.some(p => p.portName === portName)) {
              exposedInputs.push({
                portName, portType: 'any',
                sourceNodeId: edge.target.nodeId, sourcePortName: edge.target.port,
              })
            }
            state.edges.set(eid, { ...edge, target: { nodeId: op.groupId, port: portName } })
          }
        }
        state.nodes.set(op.groupId, {
          id: op.groupId, opId: '__group__', name: op.name,
          position: op.position, params: {},
        })
        state.groups.set(op.groupId, {
          id: op.groupId, name: op.name, nameEn: op.nameEn,
          nodes: innerNodes, edges: innerEdges,
          position: op.position,
          exposedInputs, exposedOutputs,
        })
        return
      }
      case 'updateGroup': {
        const group = state.groups.get(op.groupId)
        if (!group) return
        if (op.name !== undefined) group.name = op.name
        if (op.nameEn !== undefined) group.nameEn = op.nameEn
        if (op.position !== undefined) group.position = op.position
        const node = state.nodes.get(op.groupId)
        if (node) {
          if (op.name !== undefined) node.name = op.name
          if (op.position !== undefined) node.position = op.position
        }
        return
      }
      case 'ungroup': {
        const group = state.groups.get(op.groupId)
        if (!group) return
        for (const inner of group.nodes) state.nodes.set(inner.id, inner)
        for (const inner of group.edges) state.edges.set(inner.id, inner)
        const inMap = new Map(group.exposedInputs.map(p => [p.portName, p] as const))
        const outMap = new Map(group.exposedOutputs.map(p => [p.portName, p] as const))
        for (const [eid, edge] of state.edges) {
          let next = edge
          if (edge.source.nodeId === op.groupId) {
            const exposed = outMap.get(edge.source.port)
            if (exposed) next = { ...next, source: { nodeId: exposed.sourceNodeId, port: exposed.sourcePortName } }
          }
          if (edge.target.nodeId === op.groupId) {
            const exposed = inMap.get(edge.target.port)
            if (exposed) next = { ...next, target: { nodeId: exposed.sourceNodeId, port: exposed.sourcePortName } }
          }
          if (next !== edge) state.edges.set(eid, next)
        }
        state.nodes.delete(op.groupId)
        state.groups.delete(op.groupId)
        return
      }
    }
  }

  const client: MockApiClient = {
    pipelineId: state.pipelineId,

    async applyBatch(ops: readonly Op[], opts?: ApplyBatchOptions): Promise<ApplyBatchResult> {
      if (opts?.expectedPrevHash !== undefined && opts.expectedPrevHash !== state.hash) {
        emit('graph', { kind: 'graph:rejected', pipelineId: state.pipelineId, reason: 'hash mismatch' })
        return { status: 'rejected', reason: 'hash mismatch' }
      }
      if (opts?.dryRun) {
        return { status: 'ok', newHash: state.hash }
      }
      for (const op of ops) applyOpToState(op)
      const newHash = bumpHash()
      const batchId = opts?.batchId ?? `mock-batch-${state.history.length + 1}`
      const entry: HistoryEntryV1 = {
        schemaVersion: 1,
        ts: opts?.ts ?? '1970-01-01T00:00:00.000Z',
        actor: opts?.actor ?? 'test',
        batchId,
        prevHash: state.history.at(-1)?.newHash ?? '',
        newHash,
        ops: ops.map(op => ({ ...op })),
        // Mirror the kernel: persist an optional human-readable annotation.
        ...(opts?.label !== undefined ? { label: opts.label } : {}),
      }
      state.history.push(entry)
      emit('graph', { kind: 'graph:applied', pipelineId: state.pipelineId, batchId, newHash })
      return { status: 'ok', newHash, batchId }
    },

    async execute(request?: { nodeId?: string }): Promise<ExecutionResult> {
      const executionId = `exec-${++execCounter}`
      emit('execution', { kind: 'exec:started', pipelineId: state.pipelineId, executionId })
      // Simulated walk: emit a token output event per node. The mock does not
      // run a real graph, so outputs stay empty and the type is a placeholder.
      const targets = request?.nodeId
        ? [state.nodes.get(request.nodeId)].filter((n): n is GraphNode => Boolean(n))
        : Array.from(state.nodes.values())
      for (const node of targets) {
        emit('execution', {
          kind: 'exec:node:output',
          pipelineId: state.pipelineId,
          nodeId: node.id,
          portId: 'out',
          outputType: 'any',
        })
      }
      emit('execution', { kind: 'exec:completed', pipelineId: state.pipelineId, executionId })
      return { executionId, status: 'completed', outputs: {}, durationMs: 0 }
    },

    async getPipeline(): Promise<PipelineSnapshot | null> {
      const nodes: Record<string, GraphNode> = {}
      const edges: Record<string, GraphEdge> = {}
      for (const [id, n] of state.nodes) nodes[id] = n
      for (const [id, e] of state.edges) edges[id] = e
      return {
        id: state.pipelineId,
        hash: state.hash,
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
        nodes,
        edges,
      }
    },

    async getNode(nodeId: string): Promise<GraphNode | null> {
      return state.nodes.get(nodeId) ?? null
    },

    async listNodes(filter?: NodeFilter): Promise<readonly GraphNode[]> {
      let list = Array.from(state.nodes.values())
      if (filter?.opId) list = list.filter(n => n.opId === filter.opId)
      return list
    },

    async listEdges(): Promise<readonly GraphEdge[]> {
      return Array.from(state.edges.values())
    },

    async getNodeOutput(): Promise<unknown> {
      return undefined
    },

    async getHistory(opts?: HistoryQuery): Promise<readonly HistoryEntryV1[]> {
      const limit = opts?.limit ?? state.history.length
      return state.history.slice(-limit)
    },

    async listOps(): Promise<readonly OpSpec[]> {
      return [...state.ops]
    },

    async getGroup(groupId: string): Promise<NodeGroup | null> {
      return state.groups.get(groupId) ?? null
    },

    async listGroups(): Promise<readonly NodeGroup[]> {
      return Array.from(state.groups.values())
    },

    subscribe(channel: RuntimeChannel, listener: (e: RuntimeEvent) => void): () => void {
      let set = subs.get(channel)
      if (!set) {
        set = new Set()
        subs.set(channel, set)
      }
      set.add(listener)
      return () => {
        set!.delete(listener)
      }
    },

    async resolveAssetPath(template: string, _vars?: Record<string, string>): Promise<string> {
      return state.assetPaths.get(template) ?? template
    },

    __state: state,
    __reset(next?: Partial<MockSeed>) {
      const reset = freshState(next)
      state.pipelineId = reset.pipelineId
      state.nodes.clear()
      state.edges.clear()
      state.history.length = 0
      state.ops = reset.ops
      state.hash = reset.hash
      state.assetPaths.clear()
      reset.assetPaths.forEach((v, k) => state.assetPaths.set(k, v))
      state.groups.clear()
      reset.groups.forEach((v, k) => state.groups.set(k, v))
      subs.clear()
      for (const [id, node] of reset.nodes) state.nodes.set(id, node)
      for (const [id, edge] of reset.edges) state.edges.set(id, edge)
      for (const entry of reset.history) state.history.push(entry)
    },
  }
  return client
}

function freshState(seed: Partial<MockSeed> = {}): MockState {
  const state: MockState = {
    pipelineId: seed.pipelineId ?? 'test-pipeline',
    nodes: new Map(),
    edges: new Map(),
    history: [],
    ops: seed.ops ? [...seed.ops] : [],
    hash: 'mock-0-0-0',
    assetPaths: new Map(),
    groups: new Map(),
  }
  for (const node of seed.nodes ?? []) state.nodes.set(node.id, node)
  for (const edge of seed.edges ?? []) state.edges.set(edge.id, edge)
  for (const entry of seed.history ?? []) state.history.push(entry)
  if (seed.assetPaths) {
    for (const [k, v] of Object.entries(seed.assetPaths)) state.assetPaths.set(k, v)
  }
  return state
}
