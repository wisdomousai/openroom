import { FREE_SESSION_PARTICIPANT_LIMIT } from '@openroom/schema';

import { flagBool, parseArgs, UsageError } from './args.js';
import type { FetchLike } from './api.js';
import { CliError, defaultIo, Reporter, type Io } from './output.js';
import { cmdInit, cmdPreview, cmdValidate } from './commands/session-doc.js';
import { cmdApi } from './commands/api.js';
import { cmdDeck } from './commands/deck.js';
import { cmdOutline } from './commands/outline.js';
import { cmdMcp } from './commands/mcp.js';
import { cmdExport, cmdResults, cmdSession } from './commands/session.js';

export const VERSION = '0.1.0';

export const USAGE = `openroom — author and run OpenRoom sessions

Usage:
  openroom init [file] [--force]           write a starter session file (default session.yaml)
  openroom validate <file>                 validate a session file
  openroom preview <file>                  host preview + participant view per interaction
  openroom outline validate <file>            validate a typed Outline v1 locally

  openroom deck get <id> [--version <n>] [--yaml]   print a deck's plan file (YAML on stdout)
  openroom deck save <id> --file plan.yaml [--base <n>]
                                           validate locally, then stamp a new version
  openroom deck draft get|put|discard <id> [--file plan.yaml]
                                           the editor's unvalidated working text
  openroom deck versions <id>              the stamped history, newest first
  openroom deck start <id> [--version <n>] [--title <text>]
                                           file a session and open the live console
                                           (all deck commands take --url <base> --token <bearer>)
                                           a session admits ${FREE_SESSION_PARTICIPANT_LIMIT} participants unless the
                                           space owner holds largeSessions; further new joins
                                           answer 409 session-full, re-entry always works

  openroom api <METHOD> </api/tutoring/...> --url <base> --token <bearer>
               [--body <json> | --file <json-or-yaml>]
                                           manage contexts, decks, versions, sessions, records,
                                           launch, trash/restore, or request a browser
                                           confirmation URL for permanent deletion
                                           (links, learner work, records and identified sessions
                                           need the space owner's continuity capability:
                                           403 continuity-required; contexts and trash/restore
                                           never do)

  openroom session start <file> --url <base> --admin-key <key>
  openroom session status
  openroom session facilitate <code> --url <base> --token <personal-token>
  openroom session handoff <facilitatorId>
  openroom session recover
  openroom session group-set <group.json>
  openroom session group-remove <groupId>
  openroom session open|close|reveal <interactionId>
  openroom session revote <interactionId>       peer instruction: archive round 1, reopen for round 2
  openroom session undo-revote <interactionId>  peer instruction: restore round 1, discard round 2
  openroom session advance
  openroom session outline-next|outline-previous
  openroom session outline-goto <stepId>
  openroom session outline-insert <step-file> [--after <stepId>] [--show]
  openroom session end
  openroom session freeze|unfreeze
  openroom session theme <default|chalkboard|paper|projector|sherbet>   live theme switch
  openroom session hide|unhide <interactionId> <participantId>
  openroom results
  openroom mcp [file.openroom]             stdio MCP (desktop if running, else file, else web)
  openroom export --format csv|json|ballots [--out <file>]
  openroom session recap [--selection <selection.json>] [--format json|html] [--out <file>]

Options:
  --json          machine-readable single-object output on stdout
  --url <base>    API base URL (session start requires it; later commands reuse .openroom.json)
  --force         allow init to overwrite an existing file
  -h, --help      show this help
  -v, --version   print the version

Participant actions (answering, Q&A voting) are intentionally not CLI operations:
the CLI holds a host capability, not a seat in the session.

Exit codes: 0 ok, 1 validation/command failed, 2 usage error.`;

export interface RunOptions {
  io?: Io;
  fetchImpl?: FetchLike;
  cwd?: string;
}

/** Run the CLI. Returns the process exit code; never throws for expected failures. */
export async function run(argv: readonly string[], options: RunOptions = {}): Promise<number> {
  const io = options.io ?? defaultIo;
  let reporter = new Reporter(false, io);

  try {
    const args = parseArgs(argv);
    reporter = new Reporter(flagBool(args, 'json'), io);

    if (flagBool(args, 'version')) {
      reporter.line(VERSION);
      reporter.emit({ ok: true, version: VERSION });
      return 0;
    }

    const command = args.positionals[0];

    if (flagBool(args, 'help') || command === 'help') {
      reporter.line(USAGE);
      reporter.emit({ ok: true, usage: USAGE });
      return 0;
    }

    if (command === undefined) throw new UsageError('no command given');

    const deps = {
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    };

    switch (command) {
      case 'init':
        return cmdInit(args, reporter);
      case 'validate':
        return cmdValidate(args, reporter);
      case 'preview':
        return cmdPreview(args, reporter);
      case 'outline':
        return cmdOutline(args, reporter, options.cwd);
      case 'api':
        return await cmdApi(args, reporter, deps);
      case 'deck':
        return await cmdDeck(args, reporter, deps);
      case 'session':
        return await cmdSession(args, reporter, deps);
      case 'results':
        return await cmdResults(args, reporter, deps);
      case 'export':
        return await cmdExport(args, reporter, deps);
      case 'mcp':
        return await cmdMcp(args, reporter, options.cwd);
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      reporter.errorLine(`error: ${error.message}`);
      if (!reporter.json) reporter.errorLine(USAGE);
      reporter.emit({ ok: false, error: { code: 'E_USAGE', message: error.message } });
      return 2;
    }
    if (error instanceof CliError) {
      reporter.errorLine(`error: ${error.message}`);
      const errors = error.details['errors'];
      if (Array.isArray(errors)) {
        for (const item of errors as { code?: string; path?: string; message?: string }[]) {
          reporter.errorLine(`${item.code ?? 'E_SCHEMA'} ${item.path ?? '/'} ${item.message ?? ''}`);
        }
      }
      reporter.emit({ ok: false, error: { message: error.message, ...error.details } });
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    reporter.errorLine(`error: ${message}`);
    reporter.emit({ ok: false, error: { code: 'E_UNEXPECTED', message } });
    return 1;
  }
}
