import { applyBatch } from '@forgeax/node-runtime'
import type { Op } from '@forgeax/node-runtime'
import { resolveConfig } from '../config.js'
import { loadRuntime } from '../runtime.js'
import { makeEmitter, type OutputMode } from '../output.js'
import { CliError } from '../errors.js'

export function mode(opts: Record<string, unknown>): OutputMode {
  return opts.ndjson ? 'ndjson' : 'json'
}

export function requireStr(opts: Record<string, unknown>, key: string, flag: string): string {
  const v = opts[key]
  if (typeof v !== 'string' || v === '') throw new CliError(`missing required ${flag}`, 2)
  return v
}

export function numOpt(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function parseJson(v: unknown, fallback: string): unknown {
  try {
    return JSON.parse(typeof v === 'string' ? v : fallback)
  } catch (e) {
    throw new CliError(`invalid JSON: ${e instanceof Error ? e.message : String(e)}`, 2)
  }
}

export function parseEndpoint(s: string): { nodeId: string; port: string } {
  const i = s.indexOf(':')
  if (i < 0) throw new CliError(`expected node:port, got '${s}'`, 2)
  return { nodeId: s.slice(0, i), port: s.slice(i + 1) }
}

/** Apply a batch of mutation ops (no battery scan needed) and emit the result. */
export async function applyMany(opts: Record<string, unknown>, ops: readonly Op[]): Promise<void> {
  const config = resolveConfig(opts)
  const runtime = await loadRuntime({ ...config, batteriesDir: '' })
  const result = await applyBatch(runtime, ops)
  makeEmitter(mode(opts)).record(result)
  if (result.status === 'rejected') {
    throw new CliError(`apply rejected: ${result.diagnostics?.[0]?.message ?? result.reason ?? 'unknown'}`, 1)
  }
}

/** Convenience for the single-op mutation verbs. */
export async function applyOne(opts: Record<string, unknown>, op: Op): Promise<void> {
  await applyMany(opts, [op])
}
