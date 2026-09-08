/**
 * Standardised pino logger with pino-pretty in dev.
 *
 * Configuration is environment-driven so the kernel does not depend on any
 * plugin's config service:
 *   FORGEAX_LOG_LEVEL  trace | debug | info | warn | error  (default: info)
 *   FORGEAX_LOG_PRETTY  '0' | '1'                            (default: '1' unless NODE_ENV=production)
 *
 * Plugins may import this default logger or instantiate their own.
 */

import pino from 'pino'

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

function readLevel(): LogLevel {
  const raw = (process.env.FORGEAX_LOG_LEVEL ?? '').toLowerCase()
  const allowed: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
  if ((allowed as readonly string[]).includes(raw)) return raw as LogLevel
  if (raw === 'warning') return 'warn'
  return 'info'
}

function shouldUsePretty(): boolean {
  const raw = process.env.FORGEAX_LOG_PRETTY
  if (raw === '0' || raw === 'false') return false
  if (raw === '1' || raw === 'true') return true
  return process.env.NODE_ENV !== 'production'
}

export const logger = pino({
  level: readLevel(),
  transport: shouldUsePretty()
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
})
