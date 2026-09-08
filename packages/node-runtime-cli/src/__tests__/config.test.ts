import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../config.js'
import { CliError } from '../errors.js'

describe('resolveConfig', () => {
  it('maps flags to config with defaults', () => {
    const cfg = resolveConfig({ pipelineId: 'p1', projectRoot: '/tmp/x', batteries: '/tmp/b' })
    expect(cfg).toEqual({
      projectRoot: '/tmp/x',
      pipelineId: 'p1',
      pluginId: 'forgeax.cli',
      batteriesDir: '/tmp/b',
    })
  })

  it('defaults projectRoot to cwd and pluginId to forgeax.cli', () => {
    const cfg = resolveConfig({ pipelineId: 'p1' })
    expect(cfg.projectRoot).toBe(process.cwd())
    expect(cfg.pluginId).toBe('forgeax.cli')
    expect(cfg.batteriesDir).toBe('')
  })

  it('throws CliError(exitCode 2) when pipelineId is missing', () => {
    try {
      resolveConfig({})
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(CliError)
      expect((e as CliError).exitCode).toBe(2)
      expect((e as CliError).message).toMatch(/pipeline-id/)
    }
  })
})
