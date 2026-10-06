import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { ApiClient, type FetchLike } from '../api.js';
import { flagString, requireFlag, UsageError, type ParsedArgs } from '../args.js';
import { CliError, Reporter } from '../output.js';

export interface ApiCommandDeps {
  fetchImpl?: FetchLike;
  cwd?: string;
}

const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

function readBody(args: ParsedArgs, cwd: string): unknown {
  const inline = flagString(args, 'body');
  const file = flagString(args, 'file');
  if (inline !== undefined && file !== undefined) {
    throw new UsageError('use either --body or --file, not both');
  }
  const source = file === undefined
    ? inline
    : (() => {
        const path = resolve(cwd, file);
        try {
          return readFileSync(path, 'utf8');
        } catch {
          throw new CliError(`cannot read API body file: ${path}`, { code: 'E_FILE', path });
        }
      })();
  if (source === undefined) return undefined;
  try {
    return parseYaml(source) as unknown;
  } catch (error) {
    throw new CliError(`API body is not valid JSON or YAML: ${(error as Error).message}`, {
      code: 'E_BODY_PARSE',
    });
  }
}

/** Generic parity adapter for the user-scoped tutoring business API. */
export async function cmdApi(
  args: ParsedArgs,
  reporter: Reporter,
  deps: ApiCommandDeps = {},
): Promise<number> {
  const rawMethod = args.positionals[1];
  const path = args.positionals[2];
  if (rawMethod === undefined || path === undefined) {
    throw new UsageError(
      'usage: openroom api <GET|POST|PATCH|PUT|DELETE> </api/tutoring/...> --url <base> --token <bearer> [--body <json>|--file <json-or-yaml>]',
    );
  }
  const method = rawMethod.toUpperCase();
  if (!METHODS.has(method)) throw new UsageError(`unsupported API method "${rawMethod}"`);

  const client = new ApiClient({
    baseUrl: requireFlag(args, 'url'),
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
  });
  const body = readBody(args, deps.cwd ?? process.cwd());
  const result = await client.tutoringRequest(
    method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path,
    requireFlag(args, 'token'),
    body,
  );

  reporter.line(`${method} ${path} → ${result.status}`);
  if (result.body !== null) reporter.line(JSON.stringify(result.body, null, 2));
  reporter.emit({ ok: true, status: result.status, body: result.body });
  return 0;
}
