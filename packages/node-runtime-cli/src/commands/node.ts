import type { Op } from '@forgeax/node-runtime'
import { applyOne, numOpt, parseEndpoint, parseJson, requireStr } from './shared.js'

export async function nodeCreate(opts: Record<string, unknown>): Promise<void> {
  const op: Op = {
    type: 'createNode',
    nodeId: requireStr(opts, 'nodeId', '--node-id'),
    opId: requireStr(opts, 'op', '--op'),
    position: { x: numOpt(opts.x, 0), y: numOpt(opts.y, 0) },
    params: parseJson(opts.params, '{}') as Record<string, unknown>,
  }
  await applyOne(opts, op)
}

export async function nodeUpdate(opts: Record<string, unknown>): Promise<void> {
  const op: Op = {
    type: 'updateNode',
    nodeId: requireStr(opts, 'nodeId', '--node-id'),
    ...(opts.params !== undefined ? { params: parseJson(opts.params, '{}') as Record<string, unknown> } : {}),
    ...(opts.x !== undefined || opts.y !== undefined ? { position: { x: numOpt(opts.x, 0), y: numOpt(opts.y, 0) } } : {}),
  }
  await applyOne(opts, op)
}

export async function nodeDelete(opts: Record<string, unknown>): Promise<void> {
  await applyOne(opts, { type: 'deleteNode', nodeId: requireStr(opts, 'nodeId', '--node-id') })
}

export async function nodeConnect(opts: Record<string, unknown>): Promise<void> {
  await applyOne(opts, {
    type: 'connect',
    edgeId: requireStr(opts, 'edgeId', '--edge-id'),
    source: parseEndpoint(requireStr(opts, 'from', '--from')),
    target: parseEndpoint(requireStr(opts, 'to', '--to')),
  })
}

export async function nodeDisconnect(opts: Record<string, unknown>): Promise<void> {
  await applyOne(opts, { type: 'disconnect', edgeId: requireStr(opts, 'edgeId', '--edge-id') })
}
