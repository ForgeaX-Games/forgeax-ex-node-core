import { executeNode } from '@forgeax/node-runtime'
import type { ExecutionHandle, RuntimeEvent } from '@forgeax/node-runtime'
import { resolveConfig } from '../config.js'
import { loadRuntime } from '../runtime.js'
import { makeEmitter } from '../output.js'
import { CliError } from '../errors.js'
import { mode } from './shared.js'

export async function pipelineExecute(opts: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(opts)
  const runtime = await loadRuntime(config) // needs ops registered → uses batteriesDir
  const emit = makeEmitter(mode(opts))

  const unsubscribe = runtime.subscriptions.subscribe(
    config.pipelineId,
    ['execution'],
    (event: RuntimeEvent) => emit.record(event),
  )

  try {
    const nodeId = typeof opts.node === 'string' ? opts.node : undefined
    let handle: ExecutionHandle
    try {
      handle = await executeNode(runtime, nodeId ? { nodeId } : {})
    } catch (err) {
      // Synchronous validation reject (unknown node / cycle / no graph): emit a
      // structured error record so NDJSON consumers see it, then exit non-zero.
      const message = err instanceof Error ? err.message : String(err)
      emit.record({ result: { status: 'error', error: { message } } })
      throw new CliError(message, 1)
    }
    const result = await handle.done
    emit.record({ result })
    if (result.status !== 'completed') {
      const detail = result.error?.message
      throw new CliError(detail ? `execution ${result.status}: ${detail}` : `execution ${result.status}`, 1)
    }
  } finally {
    unsubscribe()
  }
}
