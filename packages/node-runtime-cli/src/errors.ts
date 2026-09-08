// Structured CLI failure carrying a process exit code. bin.ts maps it.
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = 1,
  ) {
    super(message)
    this.name = 'CliError'
  }
}
