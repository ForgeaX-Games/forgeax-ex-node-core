// Pure flag → CliConfig mapping. No file I/O (forgeax.toml deferred).

import { CliError } from './errors.js'

export interface CliConfig {
  projectRoot: string
  pipelineId: string
  pluginId: string
  /** Absolute or cwd-relative dir of battery folders. '' when not provided. */
  batteriesDir: string
}

export function resolveConfig(opts: Record<string, unknown>): CliConfig {
  const pipelineId = typeof opts.pipelineId === 'string' ? opts.pipelineId : ''
  if (!pipelineId) {
    throw new CliError('missing required --pipeline-id', 2)
  }
  return {
    projectRoot: typeof opts.projectRoot === 'string' ? opts.projectRoot : process.cwd(),
    pipelineId,
    pluginId: typeof opts.pluginId === 'string' ? opts.pluginId : 'forgeax.cli',
    batteriesDir: typeof opts.batteries === 'string' ? opts.batteries : '',
  }
}
