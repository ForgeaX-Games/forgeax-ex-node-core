// Bootstrap a Runtime for a CLI command: create it, then register ops by
// scanning the configured battery folder (skipped when none is given).

import { createRuntime, createBatteryLoader } from '@forgeax/node-runtime'
import type { Runtime } from '@forgeax/node-runtime'
import { CliError } from './errors.js'
import type { CliConfig } from './config.js'

export async function loadRuntime(config: CliConfig): Promise<Runtime> {
  const runtime = createRuntime({
    projectRoot: config.projectRoot,
    pipelineId: config.pipelineId,
    pluginId: config.pluginId,
  })

  if (config.batteriesDir) {
    const loader = createBatteryLoader(runtime.registry, {
      pluginId: config.pluginId,
      scanDirs: [config.batteriesDir],
      layout: 'flexible',
    })
    const result = await loader.scan()
    if (result.errors.length > 0) {
      const detail = result.errors.map((e) => `  ${e.dir}: ${e.reason}`).join('\n')
      throw new CliError(`battery scan failed:\n${detail}`, 2)
    }
  }

  return runtime
}
