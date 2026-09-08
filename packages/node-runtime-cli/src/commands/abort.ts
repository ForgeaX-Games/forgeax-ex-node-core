import { makeEmitter } from '../output.js'
import { mode } from './shared.js'

export async function pipelineAbort(opts: Record<string, unknown>): Promise<void> {
  makeEmitter(mode(opts)).record({
    command: 'pipeline abort',
    status: 'noop',
    message:
      'abort is in-process only; a one-shot CLI cannot cancel a separate run. Cross-process abort needs the HTTP+WS channel (out of scope for stage-1).',
  })
}
