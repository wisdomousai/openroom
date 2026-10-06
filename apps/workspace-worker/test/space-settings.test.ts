/**
 * `PATCH /api/my/spaces/:id` — the space's language pair.
 *
 * The contract worth testing is the refusal: the pair the dictionary cannot
 * serve must not be storable, or a session gets a picker-shaped setting and no
 * lookups. Everything else here is the workspace's usual access rule.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import worker from '../src/index.js';
import { signCookieValue } from '../src/cookies.js';
import { BASE } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

async function seedSession(): Promise<string> {
  const userId = `user-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{}')`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Host', now)
    .run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, now + 86_400_000)
    .run();
  return `${SESSION_COOKIE}=${encodeURIComponent(await signCookieValue(TOKEN_SECRET, sessionId))}`;
}

function asUser(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('content-type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env as never);
}

/** The caller's personal space, bootstrapped by the first read. */
async function ownSpace(cookie: string): Promise<string> {
  const res = await asUser(cookie, '/api/my/spaces');
  const { spaces } = (await res.json()) as { spaces: { id: string }[] };
  return spaces[0]!.id;
}

const patch = (cookie: string, spaceId: string, body: unknown) =>
  asUser(cookie, `/api/my/spaces/${spaceId}`, { method: 'PATCH', body: JSON.stringify(body) });

describe('PATCH /api/my/spaces/:id', () => {
  it('stores a supported pair and reads it back on the space', async () => {
    const cookie = await seedSession();
    const spaceId = await ownSpace(cookie);
    const res = await patch(cookie, spaceId, { languages: { taught: 'fr', native: 'de' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      settings: { experience: 'classroom', languages: { taught: 'fr', native: 'de' } },
    });

    const tree = (await (await asUser(cookie, `/api/my/spaces/${spaceId}`)).json()) as {
      space: { settings?: unknown };
    };
    expect(tree.space.settings).toEqual({ experience: 'classroom', languages: { taught: 'fr', native: 'de' } });
  });

  /*
   * `it ← nl` has a Wiktionary edition too thin to serve meanings, so it is not
   * in the table the picker offers. Storing it would produce a space whose
   * dictionary silently returns nothing.
   */
  it('refuses a pair the dictionary has no source for', async () => {
    const cookie = await seedSession();
    const spaceId = await ownSpace(cookie);
    const res = await patch(cookie, spaceId, { languages: { taught: 'it', native: 'nl' } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: 'unsupported-language-pair' });
  });

  it('refuses a language it does not teach at all', async () => {
    const cookie = await seedSession();
    const spaceId = await ownSpace(cookie);
    const res = await patch(cookie, spaceId, { languages: { taught: 'ja', native: 'en' } });
    expect(res.status).toBe(422);
  });

  it('clears the pair with an explicit null', async () => {
    const cookie = await seedSession();
    const spaceId = await ownSpace(cookie);
    await patch(cookie, spaceId, { languages: { taught: 'de', native: 'en' } });
    const res = await patch(cookie, spaceId, { languages: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, settings: { experience: 'classroom' } });
  });

  it('refuses a body that names nothing to change', async () => {
    const cookie = await seedSession();
    const spaceId = await ownSpace(cookie);
    const res = await patch(cookie, spaceId, { name: 'Renamed' });
    expect(res.status).toBe(422);
  });

  it('hides a space the caller is not a member of', async () => {
    const owner = await seedSession();
    const spaceId = await ownSpace(owner);
    const stranger = await seedSession();
    const res = await patch(stranger, spaceId, { languages: { taught: 'de', native: 'en' } });
    expect(res.status).toBe(404);
  });
});
