/**
 * The embed probe and the reading-material import.
 *
 * These are the only routes that fetch a URL the caller chose, so the sharpest
 * tests here are the ones that pin the SSRF guard: a refused target must cost
 * **zero** outbound requests, and a redirect must be re-checked rather than
 * trusted because its first hop was public.
 */
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { embedCheckRoute, embedImportRoute, embedTargetIssue, framingRefusal } from '../src/embed-route.js';
import worker from '../src/index.js';
import { signCookieValue } from '../src/cookies.js';
import { BASE } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

const OUTLINE = {
  version: 1,
  meta: { title: 'Reading', subject: 'English', level: 'B1' },
  steps: [
    { id: 'intro', kind: 'title', title: 'Hello' },
    { id: 'ask', kind: 'interaction', interactionId: 'q1' },
  ],
  interactions: [
    {
      id: 'q1',
      type: 'choice',
      prompt: 'Ready?',
      options: [
        { id: 'y', label: 'Yes' },
        { id: 'n', label: 'No' },
      ],
    },
  ],
};

async function seedCookie(): Promise<string> {
  const userId = `tutor-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{}')`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Tutor', now)
    .run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, now + 86_400_000)
    .run();
  return `${SESSION_COOKIE}=${encodeURIComponent(await signCookieValue(TOKEN_SECRET, sessionId))}`;
}

function asBrowser(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('content-type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env as never);
}

/** Serves canned responses by URL and records every URL asked for. */
function upstream(routes: Record<string, { body?: string; status?: number; headers?: Record<string, string> }>): {
  fetch: typeof fetch;
  seen: string[];
} {
  const seen: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const hit = routes[url];
    if (hit === undefined) return new Response('not found', { status: 404 });
    return new Response(hit.body ?? '', {
      status: hit.status ?? 200,
      headers: { 'content-type': 'text/html; charset=utf-8', ...(hit.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, seen };
}

let cookie = '';
let deckId = '';

function post(path: string, body: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', [CSRF_HEADER]: '1' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  cookie = await seedCookie();
  const contextRes = await asBrowser(cookie, '/api/tutoring/contexts', {
    method: 'POST',
    body: JSON.stringify({ displayName: 'Camille', kind: 'person', context: { level: 'B1' } }),
  });
  expect(contextRes.status).toBe(201);
  const contextId = ((await contextRes.json()) as { context: { id: string } }).context.id;

  const deckRes = await asBrowser(cookie, '/api/decks', {
    method: 'POST',
    body: JSON.stringify({ contextId, outline: OUTLINE, shape: 'tutoring' }),
  });
  expect(deckRes.status).toBe(201);
  deckId = ((await deckRes.json()) as { deck: { id: string } }).deck.id;
});

describe('embedTargetIssue', () => {
  it('accepts an ordinary public https page', () => {
    expect(embedTargetIssue('https://example.test/article?id=1')).toBeNull();
  });

  it('refuses the shapes an attacker can aim inward', () => {
    expect(embedTargetIssue('http://example.test/a')).toMatch(/https/);
    expect(embedTargetIssue('https://user:pw@example.test/a')).toMatch(/credentials/);
    expect(embedTargetIssue('https://localhost/a')).toMatch(/local/);
    expect(embedTargetIssue('https://127.0.0.1/a')).toMatch(/IP address/);
    expect(embedTargetIssue('https://169.254.169.254/latest/meta-data/')).toMatch(/IP address/);
    expect(embedTargetIssue('https://[::1]/a')).toMatch(/IP address/);
    expect(embedTargetIssue('https://db.internal/a')).toMatch(/local/);
    expect(embedTargetIssue('https://printer.local/a')).toMatch(/local/);
    expect(embedTargetIssue('https://intranet/a')).toMatch(/public host/);
  });
});

describe('framingRefusal', () => {
  it('reads a refusal off either header', () => {
    expect(framingRefusal(new Headers({ 'x-frame-options': 'DENY' }))).toBe('x-frame-options');
    expect(framingRefusal(new Headers({ 'x-frame-options': 'SAMEORIGIN' }))).toBe('x-frame-options');
    expect(
      framingRefusal(new Headers({ 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" })),
    ).toBe('frame-ancestors');
  });

  it('lets a page through when it says anyone may frame it', () => {
    expect(framingRefusal(new Headers())).toBeNull();
    expect(framingRefusal(new Headers({ 'content-security-policy': 'frame-ancestors *' }))).toBeNull();
  });

  // frame-ancestors wins where both appear, the way browsers apply them.
  it('prefers frame-ancestors over x-frame-options', () => {
    const headers = new Headers({
      'x-frame-options': 'DENY',
      'content-security-policy': 'frame-ancestors *',
    });
    expect(framingRefusal(headers)).toBeNull();
  });
});

describe('POST /api/tutoring/embed-check', () => {
  it('reports a page that refuses framing', async () => {
    const url = 'https://blocked.test/repo';
    const up = upstream({ [url]: { headers: { 'x-frame-options': 'deny' } } });
    const res = await embedCheckRoute(post('/api/tutoring/embed-check', { url, deckId }), env as never, up.fetch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ embeddable: false, reason: 'x-frame-options' });
  });

  it('reports a page that allows it', async () => {
    const url = 'https://open.test/page';
    const up = upstream({ [url]: { body: '<html><body><p>Hi</p></body></html>' } });
    const res = await embedCheckRoute(post('/api/tutoring/embed-check', { url, deckId }), env as never, up.fetch);
    expect(await res.json()).toEqual({ embeddable: true });
  });

  // The guard runs before the fetch, so a refused target is not a request we made.
  it('refuses an unsafe target without reaching the network', async () => {
    for (const url of [
      'http://plain.test/a',
      'https://127.0.0.1/latest/meta-data/',
      'https://localhost:8787/api',
      'https://db.internal/secrets',
    ]) {
      const up = upstream({});
      const res = await embedCheckRoute(post('/api/tutoring/embed-check', { url, deckId }), env as never, up.fetch);
      expect(res.status).toBe(422);
      expect(up.seen).toEqual([]);
    }
  });

  // A public first hop must not launder a private second one.
  it('refuses a redirect that lands on a private address', async () => {
    const url = 'https://open.test/redirect';
    const up = upstream({
      [url]: { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' } },
    });
    const res = await embedCheckRoute(post('/api/tutoring/embed-check', { url, deckId }), env as never, up.fetch);
    expect(await res.json()).toEqual({ embeddable: false, reason: 'unreachable' });
    expect(up.seen).toEqual([url]);
  });

  it('follows a redirect that stays public', async () => {
    const url = 'https://open.test/go';
    const final = 'https://open.test/final';
    const up = upstream({
      [url]: { status: 301, headers: { location: final } },
      [final]: { body: '<p>ok</p>' },
    });
    const res = await embedCheckRoute(post('/api/tutoring/embed-check', { url, deckId }), env as never, up.fetch);
    expect(await res.json()).toEqual({ embeddable: true });
    expect(up.seen).toEqual([url, final]);
  });

  it('needs a session and a deck the caller can reach', async () => {
    const up = upstream({});
    const anon = new Request(`${BASE}/api/tutoring/embed-check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://open.test/p', deckId }),
    });
    expect((await embedCheckRoute(anon, env as never, up.fetch)).status).toBe(401);

    const stranger = await embedCheckRoute(
      post('/api/tutoring/embed-check', { url: 'https://open.test/p', deckId: 'no-such-deck' }),
      env as never,
      up.fetch,
    );
    expect(stranger.status).toBe(404);
    expect(up.seen).toEqual([]);
  });

  it('answers 405 on the wrong method', async () => {
    const res = await embedCheckRoute(
      new Request(`${BASE}/api/tutoring/embed-check`, { method: 'GET' }),
      env as never,
      upstream({}).fetch,
    );
    expect(res.status).toBe(405);
  });
});

describe('POST /api/tutoring/embed-import', () => {
  it('converts a page into reading material', async () => {
    const url = 'https://open.test/article';
    const up = upstream({
      [url]: {
        body: [
          '<html><head><title>Tides</title><script>bad()</script></head>',
          '<body><nav>skip me</nav><article>',
          '<h1>Tides</h1><p>The moon <strong>pulls</strong> the sea.</p>',
          '<ul><li>Spring</li><li>Neap</li></ul>',
          '</article></body></html>',
        ].join(''),
      },
    });
    const res = await embedImportRoute(post('/api/tutoring/embed-import', { url, deckId }), env as never, up.fetch);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { markdown: string; title: string };
    expect(body.title).toBe('Tides');
    expect(body.markdown).toContain('# Tides');
    expect(body.markdown).toContain('**pulls**');
    expect(body.markdown).toContain('- Spring');
    // Chrome and script are dropped by the extractor, not carried into a slide.
    expect(body.markdown).not.toContain('bad()');
    expect(body.markdown).not.toContain('skip me');
  });

  it('refuses a response that is not a web page', async () => {
    const url = 'https://open.test/handout.pdf';
    const up = upstream({ [url]: { headers: { 'content-type': 'application/pdf' } } });
    const res = await embedImportRoute(post('/api/tutoring/embed-import', { url, deckId }), env as never, up.fetch);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'page-not-html' });
  });

  it('applies the same guard as the probe', async () => {
    const up = upstream({});
    const res = await embedImportRoute(
      post('/api/tutoring/embed-import', { url: 'https://169.254.169.254/', deckId }),
      env as never,
      up.fetch,
    );
    expect(res.status).toBe(422);
    expect(up.seen).toEqual([]);
  });
});
