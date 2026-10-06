/** stdout/stderr discipline: in --json mode stdout carries exactly one JSON object. */

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const defaultIo: Io = {
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
};

export class Reporter {
  constructor(
    readonly json: boolean,
    private readonly io: Io = defaultIo,
  ) {}

  /** Human-readable line. Routed to stderr when --json is active. */
  line(text: string): void {
    if (this.json) this.io.stderr(text);
    else this.io.stdout(text);
  }

  /** Human-readable error line. Always stderr. */
  errorLine(text: string): void {
    this.io.stderr(text);
  }

  /** The single JSON object for --json mode. No-op otherwise. */
  emit(value: unknown): void {
    if (this.json) this.io.stdout(JSON.stringify(value));
  }

  /** Raw stdout write (export payloads). */
  raw(text: string): void {
    this.io.stdout(text);
  }
}

/** A failure that should exit with code 1 and (in --json mode) print {ok:false,...}. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'CliError';
  }
}
