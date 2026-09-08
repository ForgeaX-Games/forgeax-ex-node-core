// Pure: BatteryMeta JSON → OpSpec (kernel slice only).
//
// The plugin reads its own copy of the same meta.json for UI projection
// (icon, colour, tags, displayGroup, etc.); this parser exists in the
// kernel and never touches those fields.

import type {
  DynamicPortsConfig,
  OpAccess,
  OpEngineBehavior,
  OpInput,
  OpLacingMode,
  OpOutput,
  OpParam,
  OpSpec,
} from '../types/op-spec.js'
import type {
  BatteryMeta,
  BatteryMetaDynamicConfig,
  BatteryMetaParam,
  BatteryMetaPort,
} from './types.js'

function sanitizeAccess(value: unknown): OpAccess | undefined {
  if (value === 'item' || value === 'list' || value === 'tree') return value
  return undefined
}

function sanitizeLacing(value: unknown): OpLacingMode | undefined {
  if (value === 'longest' || value === 'shortest' || value === 'cross' || value === 'pairwise') {
    return value
  }
  return undefined
}

function sanitizeEngineBehavior(value: unknown): OpEngineBehavior | undefined {
  if (value === 'loopUnpack') return value
  return undefined
}

function parseInput(p: BatteryMetaPort): OpInput {
  return {
    name: p.name ?? '',
    type: p.type ?? 'string',
    required: p.required ?? true,
    default: p.default as OpInput['default'],
    description: p.description ?? '',
    descriptionEn: p['description-en'],
    label: p.label,
    options: p.options,
    access: sanitizeAccess(p.access),
  }
}

function parseOutput(p: BatteryMetaPort): OpOutput {
  return {
    name: p.name ?? '',
    type: p.type ?? 'string',
    description: p.description ?? '',
    descriptionEn: p['description-en'],
    label: p.label,
    access: sanitizeAccess(p.access),
  }
}

function parseParam(p: BatteryMetaParam): OpParam {
  return {
    name: p.name ?? '',
    type: p.type ?? 'string',
    default: p.default as OpParam['default'],
    description: p.description ?? '',
    options: p.options,
    min: p.min,
    max: p.max,
    label: p.label,
  }
}

function parseDynamicConfig(
  cfg: BatteryMetaDynamicConfig | undefined,
  defaultMinCount: number,
): DynamicPortsConfig | undefined {
  if (!cfg) return undefined
  return {
    prefix: cfg.prefix ?? 'item_',
    labelTemplate: cfg.labelTemplate ?? '[$i]',
    minCount: cfg.minCount ?? defaultMinCount,
    type: cfg.type ?? 'any',
    access: sanitizeAccess(cfg.access),
  }
}

/**
 * Parse a battery meta.json into an OpSpec stub. The execute function is
 * filled in later by the loader once it has dynamic-imported the
 * battery's index.ts.
 */
export function metaToOpSpec(
  meta: BatteryMeta,
  fallbackId: string,
): Omit<OpSpec, 'execute'> {
  const id = meta.id ?? fallbackId
  const nameZh = meta['name-zh']
  const nameEn = meta['name-en']
  const name = nameZh ?? meta.label ?? meta.name ?? nameEn ?? fallbackId

  return {
    id,
    name,
    nameEn,
    description: meta.description ?? '',
    descriptionEn: meta['description-en'],
    inputs: (meta.inputs ?? []).map(parseInput),
    outputs: (meta.outputs ?? []).map(parseOutput),
    params: (meta.params ?? []).map(parseParam),
    dynamicInputs: parseDynamicConfig(meta.dynamicInputs, 2),
    dynamicOutputs: parseDynamicConfig(meta.dynamicOutputs, 1),
    lacing: sanitizeLacing(meta.lacing) ?? 'longest',
    principal: typeof meta.principal === 'string' && meta.principal.trim() ? meta.principal : undefined,
    engineBehavior: sanitizeEngineBehavior(meta.engineBehavior),
  }
}
