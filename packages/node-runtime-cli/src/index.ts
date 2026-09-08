// CLI entry — wires commander.js subcommands. Every Layer 2 API call has a
// 1:1 subcommand so AI agents, automation scripts, and humans share the
// same surface.
//
// node + pipeline verbs (create/update/delete/connect/disconnect/get/apply/
// execute/abort) are implemented. asset, path-slot, and history verbs remain
// stubbed — out of stage-1 scope.

import { Command } from 'commander'
import {
  nodeCreate,
  nodeUpdate,
  nodeDelete,
  nodeConnect,
  nodeDisconnect,
} from './commands/node.js'
import { pipelineGet, pipelineApply } from './commands/pipeline.js'
import { pipelineExecute } from './commands/pipeline-execute.js'
import { pipelineImport } from './commands/pipeline-import.js'
import { pipelineAbort } from './commands/abort.js'
import { projectCreate, projectDelete, projectList, projectOpen } from './commands/project.js'

export async function run(argv: readonly string[]): Promise<void> {
  const program = new Command()
    .name('forgeax')
    .description('AI-native CLI for ForgeaX node-programming plugins')
    .version('0.1.0')
    .option('--json', 'emit JSON output (default)', true)
    .option('--ndjson', 'emit NDJSON one-line-per-record')
    .option('--pipeline-id <id>', 'target pipeline id (or read from forgeax.toml)')
    .option('--project-root <dir>', 'project root for kernel artefacts (default: cwd)')
    .option('--batteries <dir>', 'directory of battery (op) folders to load')
    .option('--plugin-id <id>', 'plugin id used to namespace ops (default: forgeax.cli)')

  // Subcommand: pipeline
  const pipeline = program.command('pipeline').description('pipeline lifecycle: list / get / apply / execute')
  pipeline.command('list').description('list pipelines').action(notImplemented('pipeline list'))
  pipeline.command('get').description('show one pipeline').action((_o, cmd) => pipelineGet(cmd.optsWithGlobals()))
  pipeline
    .command('apply').description('apply a batch of ops to a pipeline')
    .option('--ops <json>', 'JSON array of ops')
    .action((_o, cmd) => pipelineApply(cmd.optsWithGlobals()))
  pipeline
    .command('execute').description('run a pipeline')
    .option('--node <id>', 'execute this node\'s upstream closure (omit to run the whole pipeline)')
    .action((_o, cmd) => pipelineExecute(cmd.optsWithGlobals()))
  pipeline
    .command('import').description('import a whole graph from a file (kernel-graph-v1 or legacy-pipeline-v1)')
    .option('--file <path>', 'graph JSON file to import')
    .option('--format <fmt>', 'kernel-graph-v1 | legacy-pipeline-v1 (auto-detected when omitted)')
    .option('--mode <mode>', 'replace | merge', 'replace')
    .option('--remap', 'auto-remap colliding node ids (merge)')
    .option('--execute <when>', 'none | downstream | full (run after import)', 'none')
    .option('--actor <id>', "history actor (default 'cli:import')")
    .option('--label <text>', 'history label')
    .action((_o, cmd) => pipelineImport(cmd.optsWithGlobals()))
  pipeline.command('abort').description('abort a running execution').action((_o, cmd) => pipelineAbort(cmd.optsWithGlobals()))

  // Subcommand: project — multi-project management (workspace under --project-root)
  const project = program
    .command('project')
    .description('multi-project management: list / create / open / delete')
  project
    .command('list')
    .description('list projects in the workspace')
    .action((_o, cmd) => projectList(cmd.optsWithGlobals()))
  project
    .command('create')
    .description('create a project (optionally seeded from a template file)')
    .option('--name <name>', 'project name (required)')
    .option('--type <type>', 'domain type tag (e.g. scene / lowpoly)')
    .option('--description <text>', 'project description')
    .option('--id <id>', 'explicit project id (default: generated)')
    .option('--from-template <file>', 'seed the graph from a kernel/legacy graph file')
    .action((_o, cmd) => projectCreate(cmd.optsWithGlobals()))
  project
    .command('open')
    .description('open / activate a project (swaps the active graph)')
    .option('--id <id>', 'project id to open')
    .action((_o, cmd) => projectOpen(cmd.optsWithGlobals()))
  project
    .command('delete')
    .description('delete a project (workspace never left empty)')
    .option('--id <id>', 'project id to delete')
    .option('--asset-policy <policy>', 'detach | delete (default detach)', 'detach')
    .action((_o, cmd) => projectDelete(cmd.optsWithGlobals()))

  // Subcommand: node
  const node = program.command('node').description('node CRUD inside a pipeline')
  node
    .command('create').description('add a node')
    .option('--node-id <id>', 'new node id')
    .option('--op <opId>', 'op id this node runs')
    .option('--params <json>', 'param JSON object', '{}')
    .option('--x <n>', 'x position', '0')
    .option('--y <n>', 'y position', '0')
    .action((_o, cmd) => nodeCreate(cmd.optsWithGlobals()))
  node
    .command('update').description('update node params or position')
    .option('--node-id <id>', 'node id')
    .option('--params <json>', 'param JSON object')
    .option('--x <n>', 'x position')
    .option('--y <n>', 'y position')
    .action((_o, cmd) => nodeUpdate(cmd.optsWithGlobals()))
  node
    .command('delete').description('remove a node')
    .option('--node-id <id>', 'node id')
    .action((_o, cmd) => nodeDelete(cmd.optsWithGlobals()))
  node
    .command('connect').description('add an edge')
    .option('--edge-id <id>', 'new edge id')
    .option('--from <node:port>', 'source endpoint')
    .option('--to <node:port>', 'target endpoint')
    .action((_o, cmd) => nodeConnect(cmd.optsWithGlobals()))
  node
    .command('disconnect').description('remove an edge')
    .option('--edge-id <id>', 'edge id')
    .action((_o, cmd) => nodeDisconnect(cmd.optsWithGlobals()))

  // Subcommand: asset
  const asset = program.command('asset').description('workspace asset library')
  asset.command('list').description('list assets by type').action(notImplemented('asset list'))
  asset.command('read').description('read asset bytes (stdout)').action(notImplemented('asset read'))
  asset.command('write').description('write asset bytes (stdin)').action(notImplemented('asset write'))
  asset.command('meta').description('show asset sidecar metadata').action(notImplemented('asset meta'))

  // Subcommand: path-slot
  const slot = program.command('path-slot').description('path-slot configuration')
  slot.command('list').description('list path slots').action(notImplemented('path-slot list'))
  slot.command('set').description('set a path slot value').action(notImplemented('path-slot set'))
  slot.command('reset').description('reset a path slot to default').action(notImplemented('path-slot reset'))

  // Subcommand: history
  const history = program.command('history').description('append-only operation log')
  history.command('list').description('list history entries').action(notImplemented('history list'))

  await program.parseAsync(argv)
}

function notImplemented(label: string): () => never {
  return () => {
    throw new Error(`${label}: not implemented (out of stage-1 scope)`)
  }
}
