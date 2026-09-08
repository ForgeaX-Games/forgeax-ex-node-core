import { getPipeline } from '@forgeax/node-runtime'
import type { Op } from '@forgeax/node-runtime'
import { resolveConfig } from '../config.js'
import { loadRuntime } from '../runtime.js'
import { makeEmitter } from '../output.js'
import { CliError } from '../errors.js'
import { applyMany, mode, parseJson, requireStr } from './shared.js'

export async function pipelineGet(opts: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(opts)
  const runtime = await loadRuntime({ ...config, batteriesDir: '' })
  makeEmitter(mode(opts)).record(getPipeline(runtime) ?? { pipeline: null })
}

export async function pipelineApply(opts: Record<string, unknown>): Promise<void> {
  const ops = parseJson(requireStr(opts, 'ops', '--ops'), '[]')
  if (!Array.isArray(ops)) throw new CliError('--ops must be a JSON array', 2)
  await applyMany(opts, ops as Op[])
}
