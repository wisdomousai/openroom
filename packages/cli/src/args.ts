/** Tiny hand-rolled argv parser. No framework, no dependencies. */

export interface ParsedArgs {
  /** Positional arguments in order. */
  positionals: string[];
  /** Flag values. Boolean flags are `true`. Repeated flags keep the last value. */
  flags: Record<string, string | boolean>;
}

export class UsageError extends Error {
  readonly usage: true = true;
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * Flags that never take a value (so `--json validate` keeps `validate` positional).
 *
 * `version` is deliberately absent: `openroom deck get <id> --version 3` names
 * a deck version, while a bare `openroom --version` still parses as `true`
 * because the fallback below treats a flag with nothing after it as boolean.
 */
const BOOLEAN_FLAGS = new Set(['json', 'force', 'help', 'show', 'yaml']);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;

    if (token === '--') {
      for (let j = i + 1; j < argv.length; j += 1) positionals.push(argv[j] as string);
      break;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      if (body === '') throw new UsageError('unexpected empty flag "--"');
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      if (BOOLEAN_FLAGS.has(body)) {
        flags[body] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[body] = true;
        continue;
      }
      flags[body] = next;
      i += 1;
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      // Short flags: only -h and -v are recognised aliases.
      if (token === '-h') flags['help'] = true;
      else if (token === '-v') flags['version'] = true;
      else throw new UsageError(`unknown option "${token}"`);
      continue;
    }

    positionals.push(token);
  }

  return { positionals, flags };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') throw new UsageError(`option --${name} requires a value`);
  return value;
}

export function flagBool(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true || args.flags[name] === 'true';
}

export function requireFlag(args: ParsedArgs, name: string): string {
  const value = flagString(args, name);
  if (value === undefined || value === '') throw new UsageError(`missing required option --${name}`);
  return value;
}
