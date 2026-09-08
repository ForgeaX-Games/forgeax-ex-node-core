// Single output seam. JSON (default, pretty) or NDJSON (one compact line
// per record -- the grep/jq path for AI agents; see docs/05-NORTH-STAR-llm-loop.md
// section 2, the CLI-default-NDJSON invariant).

export type OutputMode = 'json' | 'ndjson'

export interface Emitter {
  record(obj: unknown): void
}

export function makeEmitter(mode: OutputMode): Emitter {
  return {
    record(obj: unknown): void {
      const line = mode === 'ndjson' ? JSON.stringify(obj) : JSON.stringify(obj, null, 2)
      process.stdout.write(line + '\n')
    },
  }
}
