/**
 * Archive-on-keep: entitled end writes R2 + D1; the DO still forgets.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { signCookieValue } from '../src/tokens.js';
import worker from '../src/index.js';
import { BASE, SMOKE_OUTLINE, command } from './helpers.js';
import { expireSessionArchives, maybeArchiveEndedSession } from '../src/archives.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

describe('session archives', () => {
  it('writes nothing for a free owner', async () => {
    const user = await seedUser('{}');
    const session = await createOwnedSession(user);
    const ended = await command(session.sessionCode, session.hostToken, { command: 'session.end' });
    expect(ended.status).toBe(200);
    const listed = await asUser(user, '/api/my/archives');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ archives: [] });
  });

  it('keeps aggregates and optional ballots after end, downloadable after the DO would have purged', async () => {
    const user = await seedUser(JSON.stringify({ keep: true, rawExport: true }));
    const session = await createOwnedSession(user);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    const ended = await command(session.sessionCode, session.hostToken, { command: 'session.end' });
    expect(ended.status).toBe(200);

    const listed = await asUser(user, '/api/my/archives');
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      archives: { id: string; sessionCode: string; kind: string }[];
    };
    expect(body.archives).toHaveLength(1);
    expect(body.archives[0]!.sessionCode).toBe(session.sessionCode);
    expect(body.archives[0]!.kind).toBe('full');

    const jsonRes = await asUser(user, `/api/my/archives/${body.archives[0]!.id}`);
    expect(jsonRes.status).toBe(200);
    const snapshot = (await jsonRes.json()) as { code: string };
    expect(snapshot.code).toBe(session.sessionCode);

    const ballots = await asUser(
      user,
      `/api/my/archives/${body.archives[0]!.id}?format=ballots`,
    );
    expect(ballots.status).toBe(200);
    expect((await ballots.text()).startsWith('interactionId,prompt,participantId')).toBe(true);

    const stranger = await seedUser(JSON.stringify({ keep: true }));
    const stolen = await asUser(stranger, `/api/my/archives/${body.archives[0]!.id}`);
    expect(stolen.status).toBe(404);
  });

  it('stores aggregates only when keep is set without rawExport', async () => {
    const user = await seedUser(JSON.stringify({ keep: true }));
    const session = await createOwnedSession(user);
    await command(session.sessionCode, session.hostToken, { command: 'session.end' });
    const listed = await asUser(user, '/api/my/archives');
    const body = (await listed.json()) as { archives: { id: string; kind: string }[] };
    expect(body.archives[0]!.kind).toBe('aggregates');
    const ballots = await asUser(
      user,
      `/api/my/archives/${body.archives[0]!.id}?format=ballots`,
    );
    expect(ballots.status).toBe(404);
  });

  it('recovers a captured archive after its database pointer fails without recapturing or extending retention', async () => {
    const user = await seedUser(JSON.stringify({ keep: true, rawExport: true })), session = await createOwnedSession(user);
    const capture = () => maybeArchiveEndedSession(env, session.sessionCode, async (format) => format === 'json' ? Response.json({ code: session.sessionCode, preserved: true }) : new Response('original responses'));
    await env.DB.exec("CREATE TRIGGER archive_test_failure BEFORE INSERT ON session_archives BEGIN SELECT RAISE(ABORT,'test failure'); END");
    try { await expect(capture()).rejects.toThrow('test failure'); }
    finally { await env.DB.exec('DROP TRIGGER archive_test_failure'); }
    const object = await env.MEDIA.head(`archives/${session.sessionCode}.json`);
    expect(object).not.toBeNull();
    await env.DB.prepare("UPDATE users SET entitlements='{}' WHERE id=?1").bind(user.userId).run();
    const retry = () => maybeArchiveEndedSession(env, session.sessionCode, async () => { throw new Error('must not recapture'); });
    await Promise.all([retry(), retry(), retry()]);
    const listed = await (await asUser(user, '/api/my/archives')).json() as { archives: { id: string; createdAt: number; expiresAt: number }[] };
    expect(listed.archives).toHaveLength(1);
    const saved = listed.archives[0]!;
    expect(saved.createdAt).toBe(object!.uploaded.getTime());
    expect(saved.expiresAt).toBe(object!.uploaded.getTime() + 90 * 86400000);
    expect(await (await asUser(user, `/api/my/archives/${saved.id}?format=ballots`)).text()).toBe('original responses');
    expect((await env.MEDIA.head(object!.key))!.etag).toBe(object!.etag);
  });

  it('retains exactly the winning capture when end requests race', async () => {
    const user = await seedUser(JSON.stringify({ keep: true })), session = await createOwnedSession(user);
    let secondArrived!: () => void, firstSaved!: () => void;
    const bothCapturing = new Promise<void>((resolve) => { secondArrived = resolve; });
    const saved = new Promise<void>((resolve) => { firstSaved = resolve; });
    const first = maybeArchiveEndedSession(env, session.sessionCode, async () => { await bothCapturing; return Response.json({ version: 1 }); });
    const second = maybeArchiveEndedSession(env, session.sessionCode, async () => { secondArrived(); await saved; return Response.json({ version: 2 }); });
    try { await first; } finally { firstSaved(); }
    await second;
    const object = await env.MEDIA.get(`archives/${session.sessionCode}.json`);
    const original = await object!.json() as { aggregates: { version: number } };
    expect(original.aggregates.version).toBe(1);
    const listed = await (await asUser(user, '/api/my/archives')).json() as { archives: { id: string; createdAt: number }[] };
    expect(listed.archives).toHaveLength(1);
    expect(listed.archives[0]!.createdAt).toBe(object!.uploaded.getTime());
    expect(await (await asUser(user, `/api/my/archives/${listed.archives[0]!.id}`)).json()).toEqual(original.aggregates);
    await env.DB.prepare('UPDATE session_archives SET expires_at=?1 WHERE id=?2').bind(Date.now() - 1, listed.archives[0]!.id).run();
    expect((await asUser(user, `/api/my/archives/${listed.archives[0]!.id}`)).status).toBe(404);
    expect(await (await asUser(user, '/api/my/archives')).json()).toEqual({ archives: [] });
  });

  it('paginates tied captures without omitting or repeating files or admitting another account', async () => {
    const owner = await seedUser('{}'), other = await seedUser('{}'), now = Date.now();
    const ids = Array.from({ length: 53 }, () => crypto.randomUUID());
    await env.DB.batch(ids.map((id) => env.DB.prepare('INSERT INTO session_archives (id,user_id,session_code,r2_key,kind,created_at,expires_at) VALUES (?1,?2,?1,?1,\'aggregates\',?3,?4)').bind(id, owner.userId, now, now + 86400000)));
    type Page = { archives: { id: string }[]; nextCursor?: string };
    const first = await (await asUser(owner, '/api/my/archives')).json() as Page;
    expect(first.archives).toHaveLength(50); expect(first.nextCursor).toBeTruthy();
    const nextPath = `/api/my/archives?cursor=${encodeURIComponent(first.nextCursor!)}`;
    const second = await (await asUser(owner, nextPath)).json() as Page;
    expect(second.archives).toHaveLength(3); expect(second.nextCursor).toBeUndefined();
    expect([...first.archives, ...second.archives].map(({ id }) => id).sort()).toEqual(ids.sort());
    expect(await (await asUser(other, nextPath)).json()).toEqual({ archives: [] });
    expect((await asUser(owner, '/api/my/archives?cursor=malformed')).status).toBe(422);
    expect(await (await asUser(owner, '/api/my/archives?deckId=another-deck')).json()).toEqual({ archives: [] });
  });
});

describe('physical archive retention', () => {
  async function saved(expiresAt: number) {
    const owner = await seedUser('{}'), id = crypto.randomUUID(), key = `archives/${id}.json`;
    await env.MEDIA.put(key, JSON.stringify({ aggregates: { fixture: 'private results' } }));
    await env.DB.prepare("INSERT INTO session_archives (id,user_id,session_code,r2_key,kind,created_at,expires_at) VALUES (?1,?2,?1,?3,'aggregates',?4,?5)").bind(id, owner.userId, key, Date.now(), expiresAt).run();
    return { id, key, owner };
  }
  const hourly = { cron: '17 * * * *', scheduledTime: Date.now(), noRetry() {} };

  it('removes expired R2 bytes and their index through cron while retaining current results', async () => {
    const expired = await saved(Date.now() - 1), current = await saved(Date.now() + 86400000);
    expect((await asUser(expired.owner, `/api/my/archives/${expired.id}`)).status).toBe(404);
    await worker.scheduled(hourly, env);
    expect(await env.MEDIA.head(expired.key)).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM session_archives WHERE id=?1').bind(expired.id).first()).toBeNull();
    expect((await asUser(current.owner, `/api/my/archives/${current.id}`)).status).toBe(200);
    expect(await env.MEDIA.head(current.key)).not.toBeNull();
    expect(await expireSessionArchives(env)).toBe(0);
  });

  it('retains the only index when byte deletion fails, and completes on retry', async () => {
    const expired = await saved(Date.now() - 1);
    const failDelete = vi.spyOn(env.MEDIA, 'delete').mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_DETAIL'));
    try { await expect(expireSessionArchives(env)).rejects.toThrow('PRIVATE_PROVIDER_DETAIL'); }
    finally { failDelete.mockRestore(); }
    expect(await env.MEDIA.head(expired.key)).not.toBeNull();
    expect(await env.DB.prepare('SELECT id FROM session_archives WHERE id=?1').bind(expired.id).first()).not.toBeNull();
    expect(await expireSessionArchives(env)).toBe(1);
    expect(await env.MEDIA.head(expired.key)).toBeNull();
  });

  it('finishes archive cleanup after an audio-job failure and emits no raw provider details', async () => {
    const expired = await saved(Date.now() - 1), prepare = env.DB.prepare.bind(env.DB);
    const database = new Proxy(env.DB, { get(target, property) {
      if (property === 'prepare') return (sql: string) => {
        if (sql.includes('FROM learner_audio')) throw new Error('PRIVATE_PROVIDER_DETAIL');
        return prepare(sql);
      };
      return Reflect.get(target, property);
    } });
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(worker.scheduled(hourly, { ...env, DB: database })).rejects.toThrow('Retention cleanup needs attention');
      expect(await env.MEDIA.head(expired.key)).toBeNull();
      expect(warnings.mock.calls).toEqual([[JSON.stringify({ event: 'retention.cleanup.failed', kind: 'learner-audio' })]]);
    } finally { warnings.mockRestore(); }
  });

  it('drains a backlog in bounded passes without extending expiry', async () => {
    const owner = await seedUser('{}'), now = Date.now(), ids = Array.from({ length: 101 }, () => crypto.randomUUID());
    await env.DB.batch(ids.map(id => env.DB.prepare("INSERT INTO session_archives (id,user_id,session_code,r2_key,kind,created_at,expires_at) VALUES (?1,?2,?1,?1,'aggregates',?3,?3)").bind(id, owner.userId, now - 1)));
    expect(await expireSessionArchives(env, now)).toBe(100);
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM session_archives WHERE user_id=?1').bind(owner.userId).first<{ count: number }>())!.count).toBe(1);
    expect(await expireSessionArchives(env, now)).toBe(1);
    expect(await expireSessionArchives(env, now)).toBe(0);
  });
});

async function seedUser(entitlementsJson: string): Promise<{ userId: string; cookie: string }> {
  const userId = `arch-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Archive Host', now, entitlementsJson)
    .run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, now + 30 * 24 * 60 * 60 * 1000)
    .run();
  const signed = await signCookieValue(TOKEN_SECRET, sessionId);
  return { userId, cookie: `${SESSION_COOKIE}=${encodeURIComponent(signed)}` };
}

function asUser(session: { cookie: string }, path: string): Promise<Response> {
  const headers = new Headers({
    cookie: session.cookie,
    'content-type': 'application/json',
    [CSRF_HEADER]: '1',
  });
  return worker.fetch(new Request(`${BASE}${path}`, { method: 'GET', headers }), env as never);
}

async function createOwnedSession(
  session: { cookie: string },
): Promise<{ sessionCode: string; hostToken: string }> {
  const headers = new Headers({
    cookie: session.cookie,
    'content-type': 'application/json',
    [CSRF_HEADER]: '1',
  });
  const res = await worker.fetch(
    new Request(`${BASE}/api/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ outline: SMOKE_OUTLINE }),
    }),
    env as never,
  );
  if (res.status !== 201) {
    throw new Error(`createOwnedSession failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { sessionCode: string; hostToken: string };
}
