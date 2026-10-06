/**
 * Paid memory: snapshot an ended session to R2, then let the Durable Object die.
 *
 * Written from the Worker command path after a successful `session.end` — the DO
 * has no D1 or R2 binding, and this must never execute on the ballot hot path.
 */
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { readEntitlements, sessionEntitlementOwner } from './entitlements.js';
import { parseExportFormat } from './export.js';
import type { SavedResults, SavedResultsFile } from '@openroom/schema';

export interface ArchiveEnv extends ControlEnv {
  MEDIA: R2Bucket;
  SESSIONS: DurableObjectNamespace;
}

const KEEP_MS = 90 * 24 * 60 * 60 * 1000;

/** Physical expiry, outside the live command path. Keep the pointer until R2 confirms deletion. */
export async function expireSessionArchives(env: Pick<ArchiveEnv, 'DB' | 'MEDIA'>, now = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare('SELECT id,r2_key FROM session_archives WHERE expires_at<=?1 ORDER BY expires_at,id LIMIT 100')
    .bind(now).all<{ id: string; r2_key: string }>();
  let removed = 0;
  for (const row of results) {
    await env.MEDIA.delete(row.r2_key);
    const result = await env.DB.prepare('DELETE FROM session_archives WHERE id=?1 AND r2_key=?2 AND expires_at<=?3').bind(row.id, row.r2_key, now).run();
    removed += result.meta.changes;
  }
  return removed;
}

export interface SessionArchiveRecord {
  aggregates: unknown;
  ballotsCsv?: string;
}

export async function maybeArchiveEndedSession(
  env: ArchiveEnv,
  sessionCode: string,
  fetchExport: (format: 'json' | 'ballots', allowBallots: boolean) => Promise<Response>,
): Promise<void> {
  // One immutable archive per session, including retried end commands from any client.
  const id = sessionCode;
  if (await env.DB.prepare('SELECT id FROM session_archives WHERE id = ?1').bind(id).first()) return;
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

    let ballotsCsv: string | undefined;
    if (entitlements.rawExport) {
      const ballotsRes = await fetchExport('ballots', true);
      if (ballotsRes.ok) ballotsCsv = await ballotsRes.text();
    }

    const record: SessionArchiveRecord = { aggregates, ...(ballotsCsv === undefined ? {} : { ballotsCsv }) };
    object = await env.MEDIA.put(key, JSON.stringify(record), {
      onlyIf: new Headers({ 'if-none-match': '*' }),
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { kind: ballotsCsv === undefined ? 'aggregates' : 'full' },
    }) ?? await env.MEDIA.head(key);
  }
  if (!object || !['aggregates', 'full'].includes(object.customMetadata?.kind ?? '')) throw new Error('archive-capture-unavailable');
  const now = object.uploaded.getTime();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session_archives (id, user_id, session_code, r2_key, kind, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      id,
      owner.userId,
      sessionCode,
      key,
      object.customMetadata!.kind!,
      now,
      now + KEEP_MS,
    )
    .run();
}

export async function archivedBallotsCsv(
  env: ArchiveEnv,
  sessionCode: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT r2_key FROM session_archives
      WHERE session_code = ?1 AND expires_at > ?2
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(sessionCode, Date.now())
    .first<{ r2_key: string }>();
  if (row === null) return null;
  const object = await env.MEDIA.get(row.r2_key);
  if (object === null) return null;
  const record = (await object.json()) as SessionArchiveRecord;
  return record.ballotsCsv ?? null;
}

export async function listArchivesRoute(request: Request, env: ArchiveEnv): Promise<Response> {
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  const now = Date.now();
  const url = new URL(request.url), binds: (string | number)[] = [guard.user.id, now];
  let filter = '';
  for (const [parameter, column] of [['deckId', 'l.deck_id'], ['sessionId', 'l.session_id'], ['sessionCode', 'a.session_code']] as const) {
    const value = url.searchParams.get(parameter);
    if (value !== null) {
      if (!value || value.length > 128) return json({ error: 'invalid-filter' }, 422);
      binds.push(value); filter += ` AND ${column} = ?${binds.length}`;
    }
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    if (cursor.length > 512) return json({ error: 'invalid-cursor' }, 422);
    let decoded: unknown;
    try { decoded = JSON.parse(atob(cursor)); } catch { return json({ error: 'invalid-cursor' }, 422); }
    if (!Array.isArray(decoded) || decoded.length !== 2 || !Number.isSafeInteger(decoded[0]) || typeof decoded[1] !== 'string' || decoded[1].length > 128) return json({ error: 'invalid-cursor' }, 422);
    binds.push(decoded[0], decoded[1]);
    filter += ` AND (a.created_at < ?${binds.length - 1} OR (a.created_at = ?${binds.length - 1} AND a.id < ?${binds.length}))`;
  }
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.session_code, a.kind, a.created_at, a.expires_at,
            l.title, l.deck_id, l.space_id, d.folder_id
       FROM session_archives a LEFT JOIN live_sessions l ON l.code = a.session_code
       LEFT JOIN decks d ON d.id = l.deck_id
      WHERE ${ARCHIVE_ACCESS} AND a.expires_at > ?2${filter}
      ORDER BY a.created_at DESC, a.id DESC LIMIT 51`,
  )
    .bind(...binds)
    .all<ArchiveRow>();
  const page = results.slice(0, 50), last = page.at(-1);
  return json({
    ...(results.length > 50 && last ? { nextCursor: btoa(JSON.stringify([last.created_at, last.id])) } : {}),
    archives: page.map((item) => ({
      ...fileView(item),
      sessionCode: item.session_code,
      kind: item.kind,
      createdAt: item.created_at,
      expiresAt: item.expires_at,
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
  const row = await env.DB.prepare(
    `SELECT a.id, a.r2_key, a.kind, a.session_code, a.expires_at, a.created_at,
            l.title, l.deck_id, l.space_id, d.folder_id FROM session_archives a
      LEFT JOIN live_sessions l ON l.code = a.session_code
      LEFT JOIN decks d ON d.id = l.deck_id
      WHERE a.id = ?2 AND ${ARCHIVE_ACCESS}`,
  )
    .bind(guard.user.id, archiveId)
    .first<ArchiveRow & { r2_key: string }>();
  if (row === null || row.expires_at <= Date.now()) return json({ error: 'not-found' }, 404);
  const object = await env.MEDIA.get(row.r2_key);
  if (object === null) return json({ error: 'not-found' }, 404);
  const record = (await object.json()) as SessionArchiveRecord;
  if (url.pathname.endsWith('/document')) {
    const summary = (record.aggregates as { summary?: SavedResults }).summary;
    if (!summary) return json({ error: 'summary-unavailable' }, 409);
    return json({ file: fileView(row), results: summary });
  }
  const format = parseExportFormat(url.searchParams.get('format'));
  if (format === 'ballots') {
    if (record.ballotsCsv === undefined) return json({ error: 'ballots-not-kept' }, 404);
    return new Response(record.ballotsCsv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename="openroom-${row.session_code}-ballots.csv"`,
      },
    });
  }
  return json(record.aggregates, 200, {
    'content-disposition': `attachment; filename="openroom-${row.session_code}.json"`,
  });
}

// Existing work stays accessible after downgrade; removal from its space still revokes it.
const ARCHIVE_ACCESS = `((l.space_id IS NULL AND a.user_id = ?1) OR
  (l.space_id IS NOT NULL AND EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = l.space_id AND m.user_id = ?1)))`;

interface ArchiveRow {
  id: string; session_code: string; kind: string; created_at: number; expires_at: number;
  title: string | null; deck_id: string | null; space_id: string | null; folder_id: string | null;
}
function fileView(row: ArchiveRow): SavedResultsFile {
  return { id: row.id, title: row.title || 'Saved results', deckId: row.deck_id, spaceId: row.space_id,
    folderId: row.folder_id, hasIndividualResponses: row.kind === 'full' };
}
