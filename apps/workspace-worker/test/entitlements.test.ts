/**
 * Entitlements reader: parse is a pure function; `/api/me` is the HTTP surface.
 * No user route writes the column — that stays a D1 UPDATE in this file only.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import {
  FREE_ENTITLEMENTS,
  hasEntitlement,
  parseEntitlements,
} from '../src/entitlements.js';
import { signCookieValue } from '../src/cookies.js';
import worker from '../src/index.js';
import { BASE, SMOKE_OUTLINE, call } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

const ALL_TRUE = {
  keep: true,
  roster: true,
  rawExport: true,
  branding: true,
  team: true,
  connectors: true,
} as const;

describe('parseEntitlements', () => {
  it('treats empty, missing, and junk as the free default', () => {
    expect(parseEntitlements(undefined)).toEqual(FREE_ENTITLEMENTS);
    expect(parseEntitlements(null)).toEqual(FREE_ENTITLEMENTS);
    expect(parseEntitlements('')).toEqual(FREE_ENTITLEMENTS);
    expect(parseEntitlements('not-json')).toEqual(FREE_ENTITLEMENTS);
    expect(parseEntitlements('[]')).toEqual(FREE_ENTITLEMENTS);
    expect(parseEntitlements({})).toEqual(FREE_ENTITLEMENTS);
    expect(parseEntitlements('{}')).toEqual(FREE_ENTITLEMENTS);
  });

  it('sets a flag only on JSON true', () => {
    expect(parseEntitlements({ keep: true, roster: false, rawExport: 'true' })).toEqual({
      ...FREE_ENTITLEMENTS,
      keep: true,
    });
    expect(parseEntitlements('{"branding":true,"team":1}')).toEqual({
      ...FREE_ENTITLEMENTS,
      branding: true,
    });
  });

  it('ignores unknown keys so a future flag cannot grant access here', () => {
    expect(parseEntitlements({ keep: true, oem: true, unlimited: true })).toEqual({
      ...FREE_ENTITLEMENTS,
      keep: true,
    });
  });

  it('hasEntitlement reads the parsed object, not the raw blob', () => {
    const paid = parseEntitlements({ roster: true });
    expect(hasEntitlement(paid, 'roster')).toBe(true);
    expect(hasEntitlement(paid, 'keep')).toBe(false);
    expect(hasEntitlement(FREE_ENTITLEMENTS, 'rawExport')).toBe(false);
  });
});

describe('GET /api/me entitlements', () => {
  it('returns the free object when the column is the default empty blob', async () => {
    const session = await seedUser('{}');
    const res = await asUser(session, '/api/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { entitlements: typeof FREE_ENTITLEMENTS } };
    expect(body.user.entitlements).toEqual(FREE_ENTITLEMENTS);
  });

  it('refuses the ballot export for a free owner and allows it with rawExport', async () => {
    const free = await seedUser('{}');
    const freeSession = await createOwnedSession(free);
    const refused = await call(`/api/sessions/${freeSession.sessionCode}/export?format=ballots`, {
      headers: { authorization: `Bearer ${freeSession.hostToken}` },
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ ok: false, error: 'raw-export-required' });

    const counts = await call(`/api/sessions/${freeSession.sessionCode}/export?format=csv`, {
      headers: { authorization: `Bearer ${freeSession.hostToken}` },
    });
    expect(counts.status).toBe(200);
    expect((await counts.text()).startsWith('interactionId,prompt,type,status,total,summary')).toBe(
      true,
    );

    const paid = await seedUser(JSON.stringify({ rawExport: true }));
    const paidSession = await createOwnedSession(paid);
    const allowed = await call(`/api/sessions/${paidSession.sessionCode}/export?format=ballots`, {
      headers: { authorization: `Bearer ${paidSession.hostToken}` },
    });
    expect(allowed.status).toBe(200);
    expect((await allowed.text()).startsWith('interactionId,prompt,participantId')).toBe(true);
  });

  it('returns the parsed flags when the column has been written out of band', async () => {
    const session = await seedUser(JSON.stringify({ keep: true, rawExport: true }));
    const res = await asUser(session, '/api/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { entitlements: typeof ALL_TRUE } };
    expect(body.user.entitlements).toEqual({
      ...FREE_ENTITLEMENTS,
      keep: true,
      rawExport: true,
    });
  });
});

async function seedUser(entitlementsJson: string): Promise<{ cookie: string }> {
  const userId = `ent-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Entitled Host', now, entitlementsJson)
    .run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, now + 30 * 24 * 60 * 60 * 1000)
    .run();
  const signed = await signCookieValue(TOKEN_SECRET, sessionId);
  return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(signed)}` };
}

function asUser(
  session: { cookie: string },
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', session.cookie);
  headers.set('content-type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(
    new Request(`${BASE}${path}`, { method: 'GET', ...init, headers }),
    env as never,
  );
}

async function createOwnedSession(
  session: { cookie: string },
): Promise<{ sessionCode: string; hostToken: string }> {
  const res = await asUser(session, '/api/sessions', {
    method: 'POST',
      body: JSON.stringify({ outline: SMOKE_OUTLINE }),
  });
  if (res.status !== 201) {
    throw new Error(`createOwnedSession failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { sessionCode: string; hostToken: string };
}
