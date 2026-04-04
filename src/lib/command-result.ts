/**
 * Structured error type for command modules.
 *
 * Instead of calling `process.exit(code)` directly, command handlers throw a
 * `CommandError` with an exit code and optional message. The CLI boundary
 * (`src/cli.ts`) catches these and translates them into `process.exit()` calls.
 *
 * Exit-code conventions:
 *   0 — graceful early exit (user cancellation, `--list` output, etc.)
 *   1 — validation failure or runtime error
 */
export class CommandError extends Error {
  /** Process exit code (0 for graceful early exit, 1 for failure). */
  readonly exitCode: number;

  constructor(exitCode: number, message?: string) {
    super(message ?? '');
    this.name = 'CommandError';
    this.exitCode = exitCode;
  }
}
