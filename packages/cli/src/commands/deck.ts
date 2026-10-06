/**
 * `openroom deck …` — the deck editor, headless.
 *
 * The browser's deck editor does five things: read the plan file, stamp a
 * validated version, park unvalidated working text, list the history, and open a
 * session from it. Those five are here under the same five routes, because the
 * browser and the CLI are peer clients of one application service (`AGENTS.md`
 * §"Product architecture") — not because the CLI is a debugging tool for the UI.
 *
 * Two choices are worth stating:
 *
 * **A deck's currency is its plan file.** `deck get` prints YAML on stdout
 * and nothing else, so `openroom deck get <id> > plan.yaml` gives you the
 * document you can edit and hand straight back to `deck save`. Summaries go to
 * stderr, where a redirect cannot pick them up.
 *
 * **Saving validates locally first.** `parseOutline` runs before the request, so
 * a broken plan file costs zero round trips and reports the schema errors the
 * server would have reported, in the same shape. `--base` defaults to the
 * deck's current version, read immediately before the write; passing it
 * explicitly is how you assert what you think you are overwriting. Either way
 * the server refuses a stale base with `version-conflict`, which surfaces here as
 * `E_VERSION_CONFLICT` carrying the version it actually holds.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseOutline } from '@openroom/schema';
import { stringify as stringifyYaml } from 'yaml';

import { ApiClient, type FetchLike } from '../api.js';
import { flagString, requireFlag, UsageError, type ParsedArgs } from '../args.js';
import { CliError, Reporter } from '../output.js';

export interface DeckCommandDeps {
  fetchImpl?: FetchLike;
  cwd?: string;
}

export const DECK_USAGE = `usage:
  openroom deck get <id> [--version <n>] [--yaml] --url <base> --token <bearer>
  openroom deck save <id> --file <plan.yaml> [--base <n>] --url <base> --token <bearer>
  openroom deck draft get <id> --url <base> --token <bearer>
  openroom deck draft put <id> --file <plan.yaml> [--base <n>] --url <base> --token <bearer>
  openroom deck draft discard <id> --url <base> --token <bearer>
  openroom deck versions <id> --url <base> --token <bearer>
  openroom deck start <id> [--version <n>] [--title <text>] --url <base> --token <bearer>`;

interface Ctx {
  client: ApiClient;
  token: string;
  cwd: string;
}

function context(args: ParsedArgs, deps: DeckCommandDeps): Ctx {
  return {
    client: new ApiClient({
      baseUrl: requireFlag(args, 'url'),
      ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    }),
    token: requireFlag(args, 'token'),
    cwd: deps.cwd ?? process.cwd(),
  };
}

function deckPath(deckId: string): string {
  return `/api/decks/${encodeURIComponent(deckId)}`;
}

function readPlanFile(args: ParsedArgs, cwd: string): { path: string; source: string } {
  const file = requireFlag(args, 'file');
  const path = resolve(cwd, file);
  try {
    return { path, source: readFileSync(path, 'utf8') };
  } catch {
    throw new CliError(`cannot read plan file: ${path}`, { code: 'E_FILE', path });
  }
}

function intFlag(args: ParsedArgs, name: string): number | undefined {
  const raw = flagString(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new UsageError(`option --${name} must be a non-negative whole number`);
  }
  return value;
}

/** The deck's `currentVersion` — what an unqualified save is based on. */
async function currentVersion(ctx: Ctx, deckId: string): Promise<number> {
  const { body } = await ctx.client.tutoringRequest('GET', deckPath(deckId), ctx.token);
  const version = (body as { deck?: { currentVersion?: unknown } } | null)?.deck?.currentVersion;
  if (typeof version !== 'number') {
    throw new CliError('deck read returned no currentVersion', { code: 'E_BAD_RESPONSE', body });
  }
  return version;
}

/**
 * Re-label the server's optimistic-concurrency refusal. `E_HTTP 409` says
 * nothing a caller can act on; `E_VERSION_CONFLICT` plus `latestVersion` says
 * "re-read that version, re-apply your edit, save again".
 */
function rethrowConflict(error: unknown, deckId: string): never {
  if (error instanceof CliError && error.details['status'] === 409) {
    const body = error.details['body'] as { error?: string; latestVersion?: number } | null;
    if (body?.error === 'version-conflict') {
      const latest = body.latestVersion;
      throw new CliError(
        `version conflict: the deck has moved on${latest === undefined ? '' : ` (server is at version ${String(latest)})`} — re-read it and save again`,
        {
          code: 'E_VERSION_CONFLICT',
          deckId,
          ...(latest === undefined ? {} : { latestVersion: latest }),
        },
      );
    }
  }
  throw error;
}

/* ------------------------------------------------------------------- get */

async function deckGet(
  args: ParsedArgs,
  reporter: Reporter,
  ctx: Ctx,
  deckId: string,
): Promise<number> {
  const version = intFlag(args, 'version');
  const query = version === undefined ? '' : `?version=${String(version)}`;
  const { body } = await ctx.client.tutoringRequest('GET', `${deckPath(deckId)}${query}`, ctx.token);
  const detail = body as {
    deck?: { title?: string; currentVersion?: number };
    spaceName?: string | null;
    folderName?: string | null;
    contentVersion?: number | null;
    content?: unknown;
  } | null;
  if (detail?.deck === undefined) {
    throw new CliError('deck read returned no deck', { code: 'E_BAD_RESPONSE', body });
  }
  if (detail.content === null || detail.content === undefined) {
    throw new CliError(`deck ${deckId} has no stamped content yet`, {
      code: 'E_NO_CONTENT',
      deckId,
    });
  }
  const yaml = stringifyYaml(detail.content, { lineWidth: 100 });
  // The summary goes to stderr so `deck get > plan.yaml` captures the plan
  // file and only the plan file.
  reporter.errorLine(
    `# ${detail.deck.title ?? deckId} · version ${String(detail.contentVersion ?? 0)}` +
      (detail.folderName == null ? '' : ` · ${detail.folderName}`),
  );
  if (!reporter.json) reporter.raw(yaml.replace(/\n$/, ''));
  reporter.emit({
    ok: true,
    deckId,
    version: detail.contentVersion ?? null,
    title: detail.deck.title ?? null,
    spaceName: detail.spaceName ?? null,
    folderName: detail.folderName ?? null,
    yaml,
    content: detail.content,
  });
  return 0;
}

/* ------------------------------------------------------------------ save */

async function deckSave(
  args: ParsedArgs,
  reporter: Reporter,
  ctx: Ctx,
  deckId: string,
): Promise<number> {
  const { source } = readPlanFile(args, ctx.cwd);
  const parsed = parseOutline(source);
  if (!parsed.ok) {
    reporter.errorLine('the plan file does not validate — nothing was sent');
    for (const error of parsed.errors) {
      reporter.errorLine(`${error.code} ${error.path} ${error.message}`);
    }
    reporter.emit({ ok: false, error: { code: 'E_OUTLINE_INVALID' }, errors: parsed.errors });
    return 1;
  }
  const baseVersion = intFlag(args, 'base') ?? (await currentVersion(ctx, deckId));
  let result: { status: number; body: unknown };
  try {
    result = await ctx.client.tutoringRequest('POST', `${deckPath(deckId)}/versions`, ctx.token, {
      content: parsed.outline,
      baseVersion,
    });
  } catch (error) {
    rethrowConflict(error, deckId);
  }
  const saved = result.body as { version?: number; unchanged?: boolean } | null;
  const version = saved?.version ?? baseVersion;
  const unchanged = saved?.unchanged === true;
  reporter.line(
    unchanged
      ? `no change — deck ${deckId} is already at version ${String(version)}`
      : `saved deck ${deckId} as version ${String(version)}`,
  );
  reporter.emit({ ok: true, deckId, version, unchanged, baseVersion });
  return 0;
}

/* ----------------------------------------------------------------- draft */

async function deckDraft(
  args: ParsedArgs,
  reporter: Reporter,
  ctx: Ctx,
): Promise<number> {
  const action = args.positionals[2];
  const deckId = args.positionals[3];
  if (deckId === undefined || !['get', 'put', 'discard'].includes(action ?? '')) {
    throw new UsageError(DECK_USAGE);
  }
  const path = `${deckPath(deckId)}/draft`;

  if (action === 'get') {
    const { body } = await ctx.client.tutoringRequest('GET', path, ctx.token);
    const draft = body as { source?: string; baseVersion?: number; updatedAt?: number } | null;
    if (typeof draft?.source !== 'string') {
      throw new CliError('draft read returned no source', { code: 'E_BAD_RESPONSE', body });
    }
    reporter.errorLine(`# draft on version ${String(draft.baseVersion ?? 0)}`);
    if (!reporter.json) reporter.raw(draft.source.replace(/\n$/, ''));
    reporter.emit({ ok: true, deckId, ...draft });
    return 0;
  }

  if (action === 'discard') {
    await ctx.client.tutoringRequest('DELETE', path, ctx.token);
    reporter.line(`discarded the draft on deck ${deckId}`);
    reporter.emit({ ok: true, deckId, discarded: true });
    return 0;
  }

  // put — working text is stored exactly as written. It is not validated here
  // because it is not validated by the server either: a draft is allowed to be
  // half-typed, and that is the whole point of having one.
  const { source } = readPlanFile(args, ctx.cwd);
  const baseVersion = intFlag(args, 'base') ?? (await currentVersion(ctx, deckId));
  const { body } = await ctx.client.tutoringRequest('PUT', path, ctx.token, { source, baseVersion });
  const savedAt = (body as { savedAt?: number } | null)?.savedAt ?? null;
  reporter.line(`saved draft on deck ${deckId} (based on version ${String(baseVersion)})`);
  reporter.emit({ ok: true, deckId, baseVersion, savedAt });
  return 0;
}

/* -------------------------------------------------------------- versions */

async function deckVersions(
  reporter: Reporter,
  ctx: Ctx,
  deckId: string,
): Promise<number> {
  const { body } = await ctx.client.tutoringRequest('GET', `${deckPath(deckId)}/versions`, ctx.token);
  const versions = (body as { versions?: { version: number; createdAt: number; createdBy: string }[] } | null)
    ?.versions ?? [];
  if (versions.length === 0) reporter.line(`deck ${deckId} has no stamped versions yet`);
  for (const entry of versions) {
    reporter.line(`v${String(entry.version)}\t${new Date(entry.createdAt).toISOString()}\t${entry.createdBy}`);
  }
  reporter.emit({ ok: true, deckId, versions });
  return 0;
}

/* ----------------------------------------------------------------- start */

async function deckStart(
  args: ParsedArgs,
  reporter: Reporter,
  ctx: Ctx,
  deckId: string,
): Promise<number> {
  const version = intFlag(args, 'version');
  const title = flagString(args, 'title');
  // A durable session is filed first because a session is what a delivery
  // *is* — the live console is the session being live. There is no route that
  // skips the filing step.
  const created = await ctx.client.tutoringRequest('POST', '/api/sessions', ctx.token, {
    deckId,
    ...(version === undefined ? {} : { deckVersion: version }),
    ...(title === undefined ? {} : { title }),
  });
  const sessionId = (created.body as { session?: { id?: string } } | null)?.session?.id;
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new CliError('session creation returned no session id', {
      code: 'E_BAD_RESPONSE',
      body: created.body,
    });
  }
  const { body } = await ctx.client.tutoringRequest(
    'POST',
    `/api/sessions/${encodeURIComponent(sessionId)}/launch`,
    ctx.token,
    { start: true },
  );
  const live = body as {
    sessionCode?: string;
    code?: string;
    joinUrl?: string;
    hostToken?: string;
    stageToken?: string;
    deckVersion?: number;
    started?: boolean;
    startFailed?: string;
  } | null;
  if (live === null || typeof live.sessionCode !== 'string') {
    throw new CliError('launch returned no session', { code: 'E_BAD_RESPONSE', body });
  }
  reporter.line(`session ${live.sessionCode}`);
  reporter.line(`code ${live.code ?? ''}`);
  if (live.joinUrl !== undefined) reporter.line(`join ${live.joinUrl}`);
  if (live.startFailed !== undefined) {
    reporter.errorLine(`warning: the session was created but did not start (${live.startFailed})`);
  }
  reporter.emit({ ok: true, deckId, sessionId, ...live });
  return 0;
}

/* ------------------------------------------------------------- dispatch */

export async function cmdDeck(
  args: ParsedArgs,
  reporter: Reporter,
  deps: DeckCommandDeps = {},
): Promise<number> {
  const sub = args.positionals[1];
  if (sub === undefined) throw new UsageError(DECK_USAGE);

  const ctx = context(args, deps);
  if (sub === 'draft') return deckDraft(args, reporter, ctx);

  const deckId = args.positionals[2];
  if (deckId === undefined) throw new UsageError(DECK_USAGE);

  switch (sub) {
    case 'get':
      return deckGet(args, reporter, ctx, deckId);
    case 'save':
      return deckSave(args, reporter, ctx, deckId);
    case 'versions':
      return deckVersions(reporter, ctx, deckId);
    case 'start':
      return deckStart(args, reporter, ctx, deckId);
    default:
      throw new UsageError(`unknown deck subcommand "${sub}"\n${DECK_USAGE}`);
  }
}
