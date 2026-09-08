// `forgeax project list|create|open|delete` — multi-project management as
// shell subcommands, wrapping the kernel ProjectRegistry. The AI-native twin of
// the editor's projects modal: an agent or script can
//   forgeax project create --name "Hero scene" --project-root .forgeax-runtime
//   forgeax project open   --id p_xxx
//   forgeax project list
//   forgeax project delete --id p_xxx
// Output is JSON / NDJSON so it pipes through jq.
//
// Unlike the pipeline verbs, project commands do NOT require --pipeline-id (the
// project IS the pipeline). They operate on the workspace under --project-root.

import { readFileSync } from 'node:fs'
import {
  OpRegistry,
  ProjectRegistry,
  createBatteryLoader,
  createRuntime,
  getPipeline,
} from '@forgeax/node-runtime'
import type { ImportGraphInput, ProjectRuntimeFactory } from '@forgeax/node-runtime'

import { makeEmitter } from '../output.js'
import { CliError } from '../errors.js'
import { mode, requireStr } from './shared.js'

async function buildRegistry(opts: Record<string, unknown>): Promise<ProjectRegistry> {
  const projectRoot = typeof opts.projectRoot === 'string' ? opts.projectRoot : process.cwd()
  const pluginId = typeof opts.pluginId === 'string' ? opts.pluginId : 'forgeax.cli'
  const defaultType = typeof opts.type === 'string' ? opts.type : 'default'

  // One shared OpRegistry across every per-project runtime (scan once).
  const registry = new OpRegistry()
  const batteriesDir = typeof opts.batteries === 'string' ? opts.batteries : ''
  if (batteriesDir) {
    const loader = createBatteryLoader(registry, {
      pluginId,
      scanDirs: [batteriesDir],
      layout: 'flexible',
    })
    const res = await loader.scan()
    if (res.errors.length > 0) {
      const detail = res.errors.map((e) => `  ${e.dir}: ${e.reason}`).join('\n')
      throw new CliError(`battery scan failed:\n${detail}`, 2)
    }
  }

  const factory: ProjectRuntimeFactory = (req) =>
    createRuntime({
      projectRoot,
      pipelineId: req.pipelineId,
      pluginId,
      registry,
      layout: { graphFile: req.graphFile, historyFile: req.historyFile, outputsDir: req.outputsDir },
    })

  const reg = new ProjectRegistry({
    workspaceRoot: projectRoot,
    createRuntime: factory,
    defaultType,
  })
  reg.init()
  return reg
}

function detectFormat(graph: unknown, declared?: unknown): ImportGraphInput['format'] {
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

export async function projectList(opts: Record<string, unknown>): Promise<void> {
  const reg = await buildRegistry(opts)
  makeEmitter(mode(opts)).record({
    projects: reg.listProjects(),
    workspace: reg.getWorkspace(),
  })
}

export async function projectCreate(opts: Record<string, unknown>): Promise<void> {
  const reg = await buildRegistry(opts)
  const name = requireStr(opts, 'name', '--name')

  let fromTemplate: ImportGraphInput | undefined
  if (typeof opts.fromTemplate === 'string' && opts.fromTemplate) {
    let raw: { format?: string; graph?: unknown }
    try {
      raw = JSON.parse(readFileSync(opts.fromTemplate, 'utf-8')) as { format?: string; graph?: unknown }
    } catch (e) {
      throw new CliError(
        `failed to read template '${opts.fromTemplate}': ${e instanceof Error ? e.message : String(e)}`,
        2,
      )
    }
    const graph = raw.graph ?? raw
    fromTemplate = { format: detectFormat(graph, raw.format), graph } as ImportGraphInput
  }

  const meta = await reg.createProject({
    name,
    ...(typeof opts.type === 'string' ? { type: opts.type } : {}),
    ...(typeof opts.description === 'string' ? { description: opts.description } : {}),
    ...(typeof opts.id === 'string' ? { id: opts.id } : {}),
    ...(fromTemplate ? { fromTemplate } : {}),
  })

  // Faithful "create and open" — activate the new project before reporting.
  reg.activateProject(meta.id)
  makeEmitter(mode(opts)).record({ project: meta, workspace: reg.getWorkspace() })
}

export async function projectOpen(opts: Record<string, unknown>): Promise<void> {
  const reg = await buildRegistry(opts)
  const id = requireStr(opts, 'id', '--id')
  const rt = reg.activateProject(id)
  makeEmitter(mode(opts)).record({
    project: reg.getProject(id),
    workspace: reg.getWorkspace(),
    pipeline: getPipeline(rt),
  })
}

export async function projectDelete(opts: Record<string, unknown>): Promise<void> {
  const reg = await buildRegistry(opts)
  const id = requireStr(opts, 'id', '--id')
  const assetPolicy = opts.assetPolicy === 'delete' ? 'delete' : 'detach'
  await reg.deleteProject(id, { assetPolicy })
  makeEmitter(mode(opts)).record({ ok: true, deleted: id, assetPolicy, workspace: reg.getWorkspace() })
}
