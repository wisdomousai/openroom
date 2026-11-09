/**
 * Paid memory: snapshot an ended session to R2, then let the Durable Object die.
 *
 * Written from the Worker command path after a successful `session.end` — the DO
 * has no D1 or R2 binding, and this must never execute on the answer hot path.
 */
import { and, asc, desc, eq, exists, isNotNull, isNull, lt, lte, gt, or, sql, type SQL } from 'drizzle-orm';

import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { orm } from './db/client.js';
import { decks, liveSessions, sessionArchives, spaceMembers } from './db/schema.js';
import { readEntitlements, sessionEntitlementOwner } from './entitlements.js';
import { parseExportFormat } from 'openroom-relay/export';
import type { SavedResults, SavedResultsFile } from '@openroom/schema';

export interface ArchiveEnv extends ControlEnv {
  MEDIA: R2Bucket;
  SESSIONS: DurableObjectNamespace;
}

const KEEP_MS = 90 * 24 * 60 * 60 * 1000;

/** Physical expiry, outside the live command path. Keep the pointer until R2 confirms deletion. */
export async function expireSessionArchives(env: Pick<ArchiveEnv, 'DB' | 'MEDIA'>, now = Date.now()): Promise<number> {
  const results = await orm(env)
    .select({ id: sessionArchives.id, r2Key: sessionArchives.r2Key })
    .from(sessionArchives)
    .where(lte(sessionArchives.expiresAt, now))
    .orderBy(asc(sessionArchives.expiresAt), asc(sessionArchives.id))
    .limit(100);
  let removed = 0;
  for (const row of results) {
    await env.MEDIA.delete(row.r2Key);
    const result = await orm(env).delete(sessionArchives)
      .where(and(eq(sessionArchives.id, row.id), eq(sessionArchives.r2Key, row.r2Key), lte(sessionArchives.expiresAt, now)))
      .run();
    removed += result.meta.changes;
  }
  return removed;
}

export interface SessionArchiveRecord {
  aggregates: unknown;
  answersCsv?: string;
}

export async function maybeArchiveEndedSession(
  env: ArchiveEnv,
  sessionCode: string,
  fetchExport: (format: 'json' | 'answers', allowAnswers: boolean) => Promise<Response>,
): Promise<void> {
  // One immutable archive per session, including retried end commands from any client.
  const id = sessionCode;
  if (await orm(env).select({ id: sessionArchives.id }).from(sessionArchives).where(eq(sessionArchives.id, id)).get()) return;
  const owner = await sessionEntitlementOwner(env, sessionCode);
  if (!owner?.userId) return;
  const key = `archives/${id}.json`;
  // Recover an already-paid capture if its D1 pointer failed, even after downgrade.
  let object = await env.MEDIA.head(key);
  if (!object) {
    const entitlements = await readEntitlements(env, owner.userId);
    if (!entitlements.keep) return;

    const jsonRes = await fetchExport('json', false);
    if (!jsonRes.ok) return;
    const aggregates: unknown = await jsonRes.json();

    let answersCsv: string | undefined;
    if (entitlements.rawExport) {
      const answersRes = await fetchExport('answers', true);
      if (answersRes.ok) answersCsv = await answersRes.text();
    }

    const record: SessionArchiveRecord = { aggregates, ...(answersCsv === undefined ? {} : { answersCsv }) };
    object = await env.MEDIA.put(key, JSON.stringify(record), {
      onlyIf: new Headers({ 'if-none-match': '*' }),
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { kind: answersCsv === undefined ? 'aggregates' : 'full' },
    }) ?? await env.MEDIA.head(key);
  }
  if (!object || !['aggregates', 'full'].includes(object.customMetadata?.kind ?? '')) throw new Error('archive-capture-unavailable');
  const now = object.uploaded.getTime();
  await orm(env)
    .insert(sessionArchives)
    .values({
      id,
      userId: owner.userId,
      sessionCode,
      r2Key: key,
      kind: object.customMetadata!.kind!,
      createdAt: now,
      expiresAt: now + KEEP_MS,
    })
    .onConflictDoNothing()
    .run();
}

export async function archivedAnswersCsv(
  env: ArchiveEnv,
  sessionCode: string,
): Promise<string | null> {
  const row = await orm(env)
    .select({ r2Key: sessionArchives.r2Key })
    .from(sessionArchives)
    .where(and(eq(sessionArchives.sessionCode, sessionCode), gt(sessionArchives.expiresAt, Date.now())))
    .orderBy(desc(sessionArchives.createdAt))
    .limit(1)
    .get();
  if (row === undefined) return null;
  const object = await env.MEDIA.get(row.r2Key);
  if (object === null) return null;
  const record = (await object.json()) as SessionArchiveRecord;
  return record.answersCsv ?? null;
}

export async function listArchivesRoute(request: Request, env: ArchiveEnv): Promise<Response> {
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  const now = Date.now();
  const url = new URL(request.url);
  const conditions: SQL[] = [archiveAccess(env, guard.user.id), gt(sessionArchives.expiresAt, now)];
  for (const [parameter, column] of [['deckId', liveSessions.deckId], ['sessionId', liveSessions.sessionId], ['sessionCode', sessionArchives.sessionCode]] as const) {
    const value = url.searchParams.get(parameter);
    if (value !== null) {
      if (!value || value.length > 128) return json({ error: 'invalid-filter' }, 422);
      conditions.push(eq(column, value));
    }
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    if (cursor.length > 512) return json({ error: 'invalid-cursor' }, 422);
    let decoded: unknown;
    try { decoded = JSON.parse(atob(cursor)); } catch { return json({ error: 'invalid-cursor' }, 422); }
    if (!Array.isArray(decoded) || decoded.length !== 2 || !Number.isSafeInteger(decoded[0]) || typeof decoded[1] !== 'string' || decoded[1].length > 128) return json({ error: 'invalid-cursor' }, 422);
    const [createdAt, id] = decoded as [number, string];
    conditions.push(or(
      lt(sessionArchives.createdAt, createdAt),
      and(eq(sessionArchives.createdAt, createdAt), lt(sessionArchives.id, id)),
    )!);
  }
  const results = await orm(env)
    .select(archiveFields)
    .from(sessionArchives)
    .leftJoin(liveSessions, eq(liveSessions.code, sessionArchives.sessionCode))
    .leftJoin(decks, eq(decks.id, liveSessions.deckId))
    .where(and(...conditions))
    .orderBy(desc(sessionArchives.createdAt), desc(sessionArchives.id))
    .limit(51);
  const page = results.slice(0, 50), last = page.at(-1);
  return json({
    ...(results.length > 50 && last ? { nextCursor: btoa(JSON.stringify([last.createdAt, last.id])) } : {}),
    archives: page.map((item) => ({
      ...fileView(item),
      sessionCode: item.sessionCode,
      kind: item.kind,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
    })),
  });
}

export async function downloadArchiveRoute(
  request: Request,
  env: ArchiveEnv,
  archiveId: string,
  url: URL,
): Promise<Response> {
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  const row = await orm(env)
    .select({ ...archiveFields, r2Key: sessionArchives.r2Key })
    .from(sessionArchives)
    .leftJoin(liveSessions, eq(liveSessions.code, sessionArchives.sessionCode))
    .leftJoin(decks, eq(decks.id, liveSessions.deckId))
    .where(and(eq(sessionArchives.id, archiveId), archiveAccess(env, guard.user.id)))
    .get();
  if (row === undefined || row.expiresAt <= Date.now()) return json({ error: 'not-found' }, 404);
  const object = await env.MEDIA.get(row.r2Key);
  if (object === null) return json({ error: 'not-found' }, 404);
  const record = (await object.json()) as SessionArchiveRecord;
  if (url.pathname.endsWith('/document')) {
    const summary = (record.aggregates as { summary?: SavedResults }).summary;
    if (!summary) return json({ error: 'summary-unavailable' }, 409);
    return json({ file: fileView(row), results: summary });
  }
  const format = parseExportFormat(url.searchParams.get('format'));
  if (format === null) return json({ error: 'invalid-format' }, 400);
  if (format === 'answers') {
    if (record.answersCsv === undefined) return json({ error: 'answers-not-kept' }, 404);
    return new Response(record.answersCsv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename="openroom-${row.sessionCode}-answers.csv"`,
      },
    });
  }
  return json(record.aggregates, 200, {
    'content-disposition': `attachment; filename="openroom-${row.sessionCode}.json"`,
  });
}

const archiveFields = {
  id: sessionArchives.id,
  sessionCode: sessionArchives.sessionCode,
  kind: sessionArchives.kind,
  createdAt: sessionArchives.createdAt,
  expiresAt: sessionArchives.expiresAt,
  title: liveSessions.title,
  deckId: liveSessions.deckId,
  spaceId: liveSessions.spaceId,
  folderId: decks.folderId,
};

// Existing work stays accessible after downgrade; removal from its space still revokes it.
function archiveAccess(env: ControlEnv, userId: string): SQL {
  return or(
    and(isNull(liveSessions.spaceId), eq(sessionArchives.userId, userId)),
    and(
      isNotNull(liveSessions.spaceId),
      exists(
        orm(env)
          .select({ one: sql`1` })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, liveSessions.spaceId), eq(spaceMembers.userId, userId))),
      ),
    ),
  )!;
}

function fileView(row: { id: string; kind: string; title: string | null; deckId: string | null; spaceId: string | null; folderId: string | null }): SavedResultsFile {
  return { id: row.id, title: row.title || 'Saved results', deckId: row.deckId, spaceId: row.spaceId,
    folderId: row.folderId, hasIndividualResponses: row.kind === 'full' };
}
