import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { recapHtml, type OutlineStep, type SessionRecap } from '@openroom/schema';
import { parse as parseYaml } from 'yaml';

import { ApiClient, type FetchLike, type HostCommand } from '../api.js';
import { flagBool, flagString, requireFlag, UsageError, type ParsedArgs } from '../args.js';
import { CliError, Reporter } from '../output.js';
import { readState, requireState, writeState, type SessionState } from '../state.js';
import { parseOrThrow, readSessionFile } from './session-doc.js';

export interface SessionDeps {
  fetchImpl?: FetchLike;
  cwd?: string;
}

function clientFor(baseUrl: string, deps: SessionDeps): ApiClient {
  return new ApiClient({
    baseUrl,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
  });
}

/** --url wins over the stored session url. */
function resolveState(args: ParsedArgs, deps: SessionDeps): SessionState {
  const state = requireState(deps.cwd);
  const override = flagString(args, 'url');
  return override === undefined ? state : { ...state, url: override };
}

export async function cmdSession(
  args: ParsedArgs,
  reporter: Reporter,
  deps: SessionDeps = {},
): Promise<number> {
  const sub = args.positionals[1];
  switch (sub) {
    case 'recap': {
      const state = resolveState(args, deps);
      const file = flagString(args, 'selection');
      const format = flagString(args, 'format') ?? 'json';
      if (!['json', 'html'].includes(format) || (format === 'html' && !file)) throw new UsageError('usage: openroom session recap [--selection <selection.json>] [--format json|html] [--out <file>]');
      const selection: unknown = file ? JSON.parse(readFileSync(resolve(deps.cwd ?? process.cwd(), file), 'utf8')) : undefined;
      const result = await clientFor(state.url, deps).sessionRecap(state.sessionCode, state.hostToken, selection);
      const output = format === 'html' ? recapHtml(result as SessionRecap) : JSON.stringify(result, null, 2) + '\n';
      const destination = flagString(args, 'out');
      if (destination) {
        writeFileSync(resolve(deps.cwd ?? process.cwd(), destination), output);
        reporter.emit({ ok: true, path: destination }); reporter.line(`Written ${destination}`);
      } else if (format === 'html' || !reporter.json) reporter.raw(output);
      else reporter.emit(result);
      return 0;
    }
    case 'facilitate': {
      const code = args.positionals[2];
      if (!code) throw new UsageError('usage: openroom session facilitate <code> --url <base> --token <personal-token>');
      const client = clientFor(requireFlag(args, 'url'), deps);
      const joined = await client.facilitateSession(code, requireFlag(args, 'token'));
      const state: SessionState = {
        url: client.base, sessionCode: String(joined.sessionCode), code: String(joined.code),
        hostToken: String(joined.hostToken), stageToken: String(joined.stageToken),
        createdAt: new Date().toISOString(),
      };
      const statePath = writeState(state, deps.cwd);
      reporter.line(`Joined session ${state.code}`);
      reporter.emit({ ok: true, code: state.code, statePath, facilitation: joined.facilitation });
      return 0;
    }
    case 'handoff': {
      const facilitatorId = args.positionals[2];
      if (!facilitatorId) throw new UsageError('usage: openroom session handoff <facilitatorId>');
      return runCommand({ command: 'presentation.handoff', facilitatorId }, args, reporter, deps);
    }
    case 'recover':
      return runCommand({ command: 'presentation.recover' }, args, reporter, deps);
    case 'start':
      return sessionStart(args, reporter, deps);
    case 'group-set': {
      const file = args.positionals[2];
      if (!file) throw new UsageError('usage: openroom session group-set <group.json>');
      const group = JSON.parse(readFileSync(resolve(deps.cwd ?? process.cwd(), file), 'utf8'));
      return runCommand({ command: 'group.set', group }, args, reporter, deps);
    }
    case 'group-remove': {
      const groupId = args.positionals[2];
      if (!groupId) throw new UsageError('usage: openroom session group-remove <groupId>');
      return runCommand({ command: 'group.remove', groupId }, args, reporter, deps);
    }
    case 'status':
      return sessionStatus(args, reporter, deps);
    case 'open':
    case 'close':
    case 'reveal':
    case 'hide-results':
    case 'show-results':
    case 'revote':
    case 'undo-revote':
      return sessionInteractionCommand(sub, args, reporter, deps);
    case 'advance':
      return sessionSimpleCommand({ command: 'session.advance' }, args, reporter, deps);
    case 'outline-next':
      return sessionSimpleCommand({ command: 'outline.next' }, args, reporter, deps);
    case 'outline-previous':
      return sessionSimpleCommand({ command: 'outline.previous' }, args, reporter, deps);
    case 'outline-goto':
      return sessionOutlineGoto(args, reporter, deps);
    case 'outline-insert':
      return sessionOutlineInsert(args, reporter, deps);
    case 'end':
      return sessionSimpleCommand({ command: 'session.end' }, args, reporter, deps);
    case 'freeze':
      return sessionSimpleCommand({ command: 'session.freeze' }, args, reporter, deps);
    case 'unfreeze':
      return sessionSimpleCommand({ command: 'session.unfreeze' }, args, reporter, deps);
    case 'theme':
      return sessionTheme(args, reporter, deps);
    case 'hide':
    case 'unhide':
      return sessionTextCommand(sub, args, reporter, deps);
    case undefined:
      throw new UsageError(
        'usage: openroom session <start|status|group-set|group-remove|open|close|reveal|hide-results|show-results|revote|undo-revote|advance|outline-next|outline-previous|outline-goto|outline-insert|end|freeze|unfreeze|theme|hide|unhide> [...]',
      );
    default:
      throw new UsageError(`unknown session subcommand "${sub}"`);
  }
}

async function sessionOutlineGoto(
  args: ParsedArgs,
  reporter: Reporter,
  deps: SessionDeps,
): Promise<number> {
  const stepId = args.positionals[2];
  if (stepId === undefined) throw new UsageError('usage: openroom session outline-goto <stepId>');
  return runCommand({ command: 'outline.goto', stepId }, args, reporter, deps);
}

async function sessionOutlineInsert(
  args: ParsedArgs,
  reporter: Reporter,
  deps: SessionDeps,
): Promise<number> {
  const file = args.positionals[2];
  if (file === undefined) {
    throw new UsageError('usage: openroom session outline-insert <step-file> [--after <stepId>] [--show]');
  }
  const path = resolve(deps.cwd ?? process.cwd(), file);
  let step: unknown;
  try {
    step = parseYaml(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new CliError(`cannot parse outline step file ${path}: ${(error as Error).message}`, {
      code: 'E_OUTLINE_STEP_FILE',
      path,
    });
  }
  if (
    step === null ||
    typeof step !== 'object' ||
    Array.isArray(step) ||
    typeof (step as Record<string, unknown>)['id'] !== 'string' ||
    typeof (step as Record<string, unknown>)['kind'] !== 'string'
  ) {
    throw new CliError('outline step file must contain one typed step with id and kind', {
      code: 'E_INVALID_OUTLINE_STEP',
      path,
    });
  }
  const afterStepId = flagString(args, 'after');
  return runCommand({
    command: 'outline.insert',
    step: step as OutlineStep,
    ...(afterStepId === undefined ? {} : { afterStepId }),
    ...(flagBool(args, 'show') ? { show: true } : {}),
  }, args, reporter, deps);
}

async function sessionStart(
  args: ParsedArgs,
  reporter: Reporter,
  deps: SessionDeps,
): Promise<number> {
  const file = args.positionals[2];
  if (file === undefined) {
    throw new UsageError('usage: openroom session start <file> --url <base> --admin-key <key>');
  }
  const baseUrl = requireFlag(args, 'url');
  const adminKey = requireFlag(args, 'admin-key');

  const session = parseOrThrow(readSessionFile(file), file);
  const client = clientFor(baseUrl, deps);
  const created = await client.createSession(session, adminKey);

  const joinUrl = created.joinUrl ?? `https://join.openroom.app/?code=${created.code}`;
  const stageUrl =
    created.stageToken === undefined
      ? `${client.base}/stage/?session=${encodeURIComponent(created.sessionCode)}`
      : `${client.base}/stage/?session=${encodeURIComponent(created.sessionCode)}&token=${encodeURIComponent(created.stageToken)}`;

  const state: SessionState = {
    url: client.base,
    sessionCode: created.sessionCode,
    code: created.code,
    hostToken: created.hostToken,
    ...(created.stageToken === undefined ? {} : { stageToken: created.stageToken }),
    joinUrl,
    stageUrl,
    createdAt: new Date().toISOString(),
  };
  const path = writeState(state, deps.cwd);

  reporter.line(`✓ session created`);
  reporter.line(`  sessionCode:   ${state.sessionCode}`);
  reporter.line(`  code:     ${state.code}`);
  reporter.line(`  join:     ${joinUrl}`);
  reporter.line(`  stage:    ${stageUrl}`);
  reporter.line(`  state:    ${path}`);
  reporter.emit({
    ok: true,
    sessionCode: state.sessionCode,
    code: state.code,
    joinUrl,
    stageUrl,
    statePath: path,
  });
  return 0;
}

interface HostInteractionSummary {
  id: string;
  type: string;
  prompt?: string;
  status: string;
  answered?: number;
  aggregate?: unknown;
}

function asInteractions(snapshot: Record<string, unknown>): HostInteractionSummary[] {
  const raw = snapshot['interactions'];
  return Array.isArray(raw) ? (raw as HostInteractionSummary[]) : [];
}

async function sessionStatus(
  args: ParsedArgs,
  reporter: Reporter,
  deps: SessionDeps,
): Promise<number> {
  const state = resolveState(args, deps);
  const client = clientFor(state.url, deps);
  const snapshot = await client.hostState(state.sessionCode, state.hostToken);

  const status = String(snapshot['status'] ?? 'unknown');
  const revision = String(snapshot['revision'] ?? '?');
  const activeId = snapshot['activeInteractionId'];
  const joined = snapshot['participantCount'] ?? 0;
  const answered = snapshot['answeredCount'] ?? 0;
  const active = asInteractions(snapshot).find((item) => item.id === activeId);

  reporter.line(`session ${state.sessionCode} (code ${state.code})`);
  reporter.line(`  status:   ${status}${snapshot['frozen'] === true ? ' (frozen)' : ''}`);
  reporter.line(`  revision: ${revision}`);
  reporter.line(
    `  active:   ${activeId === null || activeId === undefined ? '—' : `${String(activeId)}${active === undefined ? '' : ` [${active.status}]`}`}`,
  );
  reporter.line(`  joined:   ${String(joined)}   answered: ${String(answered)}`);
  reporter.emit({ ok: true, ...snapshot });
  return 0;
}

async function sessionInteractionCommand(
  verb:
    | 'open'
    | 'close'
    | 'reveal'
    | 'hide-results'
    | 'show-results'
    | 'revote'
    | 'undo-revote',
  args: ParsedArgs,
  reporter: Reporter,
  deps: SessionDeps,
): Promise<number> {
  const interactionId = args.positionals[2];
  if (interactionId === undefined) {
    throw new UsageError(`usage: openroom session ${verb} <interactionId>`);
  }
  const domainVerb =
    verb === 'undo-revote'
      ? 'undoRevote'
      : verb === 'hide-results'
        ? 'hideResults'
        : verb === 'show-results'
          ? 'showResults'
          : verb;
  const command = { command: `interaction.${domainVerb}`, interactionId } as HostCommand;
  return runCommand(command, args, reporter, deps);
}

/**
 * `session hide|unhide <interactionId> <participantId>` — moderation of a single
 * text/Q&A entry. `openroom results` prints the participantId of every entry so
 * the id needed here can be read straight off the results output.
 */
async function sessionTextCommand(
  verb: 'hide' | 'unhide',
  args: ParsedArgs,
  reporter: Reporter,
  deps: SessionDeps,
): Promise<number> {
  const interactionId = args.positionals[2];
  const participantId = args.positionals[3];
  if (interactionId === undefined || participantId === undefined) {
    throw new UsageError(`usage: openroom session ${verb} <interactionId> <participantId>`);
  }
  const command = {
    command: verb === 'hide' ? 'text.hide' : 'text.unhide',
    interactionId,
    participantId,
  } as HostCommand;
  return runCommand(command, args, reporter, deps);
}

/**
 * `session theme <themeId>` — live branding switch. The five built-in ids are
 * checked client-side so a typo costs a round trip only when the server list
 * has moved on; the domain is still the authority (E_INVALID_THEME).
 */
export const SESSION_THEME_IDS = ['default', 'chalkboard', 'paper', 'projector', 'sherbet'];

async function sessionTheme(
  args: ParsedArgs,
  reporter: Reporter,
  deps: SessionDeps,
): Promise<number> {
  const theme = args.positionals[2];
  if (theme === undefined) {
    throw new UsageError(`usage: openroom session theme <${SESSION_THEME_IDS.join('|')}>`);
  }
  if (!SESSION_THEME_IDS.includes(theme)) {
    throw new UsageError(
      `unknown theme "${theme}" (expected one of ${SESSION_THEME_IDS.join(', ')})`,
    );
  }
  return runCommand({ command: 'session.theme', theme }, args, reporter, deps);
}

async function sessionSimpleCommand(
  command: HostCommand,
  args: ParsedArgs,
  reporter: Reporter,
  deps: SessionDeps,
): Promise<number> {
  return runCommand(command, args, reporter, deps);
}

async function runCommand(
  command: HostCommand,
  args: ParsedArgs,
  reporter: Reporter,
  deps: SessionDeps,
): Promise<number> {
  const state = resolveState(args, deps);
  const client = clientFor(state.url, deps);
  const { envelope, result } = await client.sendCommand(state.sessionCode, state.hostToken, command);

  const revision =
    result !== null && typeof result === 'object'
      ? (result as { revision?: unknown }).revision
      : undefined;

  reporter.line(
    `✓ ${command.command}${'interactionId' in command ? ` ${command.interactionId}` : ''}${'theme' in command ? ` ${command.theme}` : ''}${'participantId' in command ? ` ${command.participantId}` : ''}${revision === undefined ? '' : ` → revision ${String(revision)}`}`,
  );
  reporter.emit({
    ok: true,
    command: envelope.command,
    idempotencyKey: envelope.idempotencyKey,
    result,
  });
  return 0;
}

export async function cmdResults(
  args: ParsedArgs,
  reporter: Reporter,
  deps: SessionDeps = {},
): Promise<number> {
  const state = resolveState(args, deps);
  const client = clientFor(state.url, deps);
  const snapshot = await client.hostState(state.sessionCode, state.hostToken);
  const interactions = asInteractions(snapshot);

  reporter.line(`session ${state.sessionCode} — revision ${String(snapshot['revision'] ?? '?')}`);
  for (const item of interactions) {
    reporter.line(
      `${item.id} [${item.type}/${item.status}] answered=${String(item.answered ?? 0)}`,
    );
    for (const line of aggregateLines(item.aggregate)) reporter.line(`   ${line}`);
  }
  reporter.emit({ ok: true, ...snapshot });
  return 0;
}

/** Compact one-line-per-bucket rendering of a domain Aggregate. */
export function aggregateLines(aggregate: unknown): string[] {
  if (aggregate === null || typeof aggregate !== 'object') return [];
  const agg = aggregate as Record<string, unknown>;
  switch (agg['kind']) {
    case 'choice': {
      const counts = (agg['counts'] ?? {}) as Record<string, number>;
      const lines = Object.entries(counts).map(([id, n]) => `${id}: ${String(n)}`);
      lines.push(`total ${String(agg['total'] ?? 0)}, don't know ${String(agg['dontKnow'] ?? 0)}`);
      return lines;
    }
    case 'scale': {
      const counts = (agg['counts'] ?? {}) as Record<string, number>;
      const buckets = Object.entries(counts)
        .map(([value, n]) => `${value}×${String(n)}`)
        .join(' ');
      return [
        buckets,
        `total ${String(agg['total'] ?? 0)}, mean ${String(agg['mean'] ?? '—')}`,
      ].filter((line) => line !== '');
    }
    case 'numeric':
      return [
        `total ${String(agg['total'] ?? 0)}, mean ${String(agg['mean'] ?? '—')}, median ${String(agg['median'] ?? '—')}`,
      ];
    case 'ranking': {
      const scores = (agg['scores'] ?? {}) as Record<string, number>;
      const avgRank = (agg['avgRank'] ?? {}) as Record<string, number | null>;
      // Highest Borda score first — the same order the stage draws.
      const ordered = Object.entries(scores).sort((a, b) =>
        b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1],
      );
      const lines = ordered.map(([id, score], index) => {
        const mean = avgRank[id];
        const rank = mean === null || mean === undefined ? '—' : mean.toFixed(2);
        return `${index + 1}. ${id}: ${String(score)} pts (avg rank ${rank})`;
      });
      lines.push(
        `total ${String(agg['total'] ?? 0)}, don't know ${String(agg['dontKnow'] ?? 0)}`,
      );
      return lines;
    }
    case 'text':
    case 'qna': {
      const entries = Array.isArray(agg['entries'])
        ? (agg['entries'] as {
            participantId?: string;
            text?: string;
            hidden?: boolean;
            votes?: number;
          }[])
        : [];
      // The participantId is printed because it is the argument
      // `openroom session hide <interactionId> <participantId>` needs.
      const lines = entries
        .slice(0, 20)
        .map(
          (entry) =>
            `[${entry.participantId ?? '?'}] ${entry.hidden === true ? '(hidden) ' : ''}${entry.text ?? ''}${entry.votes === undefined ? '' : ` (+${String(entry.votes)})`}`,
        );
      lines.push(`total ${String(agg['total'] ?? entries.length)}`);
      return lines;
    }
    default:
      return [];
  }
}

export async function cmdExport(
  args: ParsedArgs,
  reporter: Reporter,
  deps: SessionDeps = {},
): Promise<number> {
  const format = flagString(args, 'format') ?? 'json';
  if (format !== 'csv' && format !== 'json' && format !== 'ballots') {
    throw new UsageError(`--format must be "csv", "json", or "ballots" (got "${format}")`);
  }
  const state = resolveState(args, deps);
  const client = clientFor(state.url, deps);
  const text = await client.exportRaw(state.sessionCode, state.hostToken, format);

  const out = flagString(args, 'out');
  if (out !== undefined) {
    const path = resolve(deps.cwd ?? process.cwd(), out);
    writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    reporter.line(`✓ wrote ${format} export to ${path}`);
    reporter.emit({ ok: true, format, path });
    return 0;
  }

  if (reporter.json) {
    let parsed: unknown = text;
    if (format === 'json') {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
    }
    reporter.emit({ ok: true, format, data: parsed });
    return 0;
  }

  reporter.raw(text.replace(/\n$/, ''));
  return 0;
}

export { CliError };
