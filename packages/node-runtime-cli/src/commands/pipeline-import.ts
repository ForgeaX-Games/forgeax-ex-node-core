// `forgeax pipeline import` — load a whole node-connection graph from a file
// and apply it as a single atomic batch (the kernel importPipelineGraph). The
// AI-native, headless twin of the editor's Open action: an agent or script can
//   forgeax pipeline import --file scene.json --mode replace --execute full
// to swap the canvas + run it, with every opId validated against the loaded op
// registry (an unknown op is reported, never crashes). Output is JSON/NDJSON.

import { readFileSync } from 'node:fs'
import { executeNode, importPipelineGraph } from '@forgeax/node-runtime'
import type { ImportGraphFormat } from '@forgeax/node-runtime'
import { resolveConfig } from '../config.js'
import { loadRuntime } from '../runtime.js'
import { makeEmitter } from '../output.js'
import { CliError } from '../errors.js'
import { mode, requireStr } from './shared.js'

function detectFormat(graph: unknown, declared?: unknown): ImportGraphFormat {
  if (declared === 'kernel-graph-v1' || declared === 'legacy-pipeline-v1') return declared
  const g = graph as { nodes?: unknown }
  const nodes = Array.isArray(g?.nodes)
    ? (g.nodes as Array<Record<string, unknown>>)
    : g?.nodes && typeof g.nodes === 'object'
      ? Object.values(g.nodes as Record<string, Record<string, unknown>>)
      : []
  const first = nodes[0]
  if (first && 'batteryId' in first && !('opId' in first)) return 'legacy-pipeline-v1'
  return 'kernel-graph-v1'
}

export async function pipelineImport(opts: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(opts)
  // Needs ops registered for opId validation → requires --batteries.
  const runtime = await loadRuntime(config)
  const emit = makeEmitter(mode(opts))

  const file = requireStr(opts, 'file', '--file')
  let raw: { format?: string; graph?: unknown }
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8')) as { format?: string; graph?: unknown }
  } catch (e) {
    throw new CliError(`failed to read graph file '${file}': ${e instanceof Error ? e.message : String(e)}`, 2)
  }
  const graph = raw.graph ?? raw
  const format = detectFormat(graph, typeof opts.format === 'string' ? opts.format : raw.format)
  const importMode = opts.mode === 'merge' ? 'merge' : 'replace'

  const result = await importPipelineGraph(
    runtime,
    { format, graph } as never,
    {
      mode: importMode,
      remapNodeIds: Boolean(opts.remap),
      actor: typeof opts.actor === 'string' ? opts.actor : 'cli:import',
      ...(typeof opts.label === 'string' ? { label: opts.label } : {}),
    },
  )

  if (result.status !== 'ok') {
    emit.record(result)
    const detail = result.diagnostics?.[0]?.message ?? result.reason ?? 'unknown'
    throw new CliError(`import rejected: ${detail}`, 1)
  }

  const execWhen = typeof opts.execute === 'string' ? opts.execute : 'none'
  let executed = false
  if (execWhen === 'full' || execWhen === 'downstream') {
    const handle = await executeNode(runtime, {})
    const execResult = await handle.done
    executed = true
    if (execResult.status !== 'completed') {
      emit.record({ ...result, executed, execStatus: execResult.status })
      throw new CliError(`import applied but execution ${execResult.status}`, 1)
    }
  }

  emit.record({ ...result, executed })
}
