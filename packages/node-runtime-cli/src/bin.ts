#!/usr/bin/env node
// forgeax — single binary entry. Subcommands are registered in
// src/commands/*. Output is JSON / NDJSON by default so AI agents and
// shell scripts can pipe through grep, jq, etc.

import { run } from './index.js'
import { CliError } from './errors.js'

run(process.argv).catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(err instanceof CliError ? err.exitCode : 1)
})
