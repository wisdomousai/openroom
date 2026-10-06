import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE } from '../src/auth.js';
import worker from '../src/index.js';
import { parsePixabayHits, stockRoute } from '../src/stock.js';
import { signCookieValue } from '../src/tokens.js';
import { BASE } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

async function seedSession(): Promise<string> {
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
  const signed = await signCookieValue(TOKEN_SECRET, sessionId);
  return `${SESSION_COOKIE}=${encodeURIComponent(signed)}`;
}

function stockRequest(cookie: string | null, query: string, method = 'GET'): Request {
  const headers = new Headers();
  if (cookie !== null) headers.set('cookie', cookie);
  return new Request(`${BASE}/api/tutoring/stock?q=${encodeURIComponent(query)}`, {
    method,
    headers,
  });
}

/** The key never leaves the worker, so the upstream is always a stand-in here. */
function pixabay(payload: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: ok ? 200 : 502,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

const PAYLOAD = {
  hits: [
    {
      id: 195893,
      previewURL: 'https://cdn.pixabay.com/preview.jpg',
      largeImageURL: 'https://pixabay.com/get/large.jpg',
      pageURL: 'https://pixabay.com/photos/red-roses-195893/',
      tags: 'roses',
      user: 'anna',
      imageWidth: 1280,
      imageHeight: 853,
    },
  ],
};

const configured = { ...(env as object), PIXABAY_API_KEY: 'test-key' } as never;
// `.dev.vars` may carry a real key locally; a test must never depend on that,
// nor reach Pixabay for real.
const unconfigured = { ...(env as object), PIXABAY_API_KEY: '' } as never;

describe('parsePixabayHits', () => {
  it('maps hosted image URLs and skips broken rows', () => {
    const hits = parsePixabayHits({
      totalHits: 2,
      hits: [
        {
          id: 195893,
          previewURL: 'https://cdn.pixabay.com/preview.jpg',
          largeImageURL: 'https://pixabay.com/get/large.jpg',
          pageURL: 'https://pixabay.com/photos/red-roses-195893/',
          tags: 'roses, red, flower',
          user: 'anna',
          imageWidth: 1280,
          imageHeight: 853,
        },
        { id: 'nope' },
      ],
    });
    expect(hits).toEqual([
      {
        id: 195893,
        previewUrl: 'https://cdn.pixabay.com/preview.jpg',
        imageUrl: 'https://pixabay.com/get/large.jpg',
        pageUrl: 'https://pixabay.com/photos/red-roses-195893/',
        tags: 'roses, red, flower',
        user: 'anna',
        width: 1280,
        height: 853,
      },
    ]);
  });

  it('returns an empty list for a broken payload', () => {
    expect(parsePixabayHits(null)).toEqual([]);
    expect(parsePixabayHits({ hits: 'nope' })).toEqual([]);
  });
});

describe('GET /api/tutoring/stock', () => {
  it('refuses a caller with no session', async () => {
    const res = await worker.fetch(stockRequest(null, 'roses'), env as never);
    expect(res.status).toBe(401);
  });

  it('refuses a wrong method', async () => {
    const res = await worker.fetch(stockRequest(null, 'roses', 'POST'), env as never);
    expect(res.status).toBe(405);
  });

  it('answers 501 when the deployment carries no Pixabay key', async () => {
    const cookie = await seedSession();
    const res = await stockRoute(
      stockRequest(cookie, 'roses'),
      unconfigured,
      pixabay(PAYLOAD),
    );
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'stock-unconfigured' });
  });

  it('refuses a one-character query (empty means browse, one letter means nothing)', async () => {
    const cookie = await seedSession();
    const res = await stockRoute(stockRequest(cookie, 'r'), configured, pixabay(PAYLOAD));
    expect(res.status).toBe(422);
  });

  it('returns hosted hits with the attribution source', async () => {
    const cookie = await seedSession();
    const res = await stockRoute(stockRequest(cookie, 'roses'), configured, pixabay(PAYLOAD));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: { imageUrl: string }[]; source: string };
    expect(body.source).toBe('Pixabay');
    expect(body.hits.map((hit) => hit.imageUrl)).toEqual(['https://pixabay.com/get/large.jpg']);
  });

  it('browses popular photos when the query is empty and forwards page', async () => {
    const cookie = await seedSession();
    let seen = '';
    const fetchImpl = (async (input: RequestInfo | URL) => {
      seen = String(input);
      return new Response(JSON.stringify({ ...PAYLOAD, totalHits: 80 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const headers = new Headers();
    headers.set('cookie', cookie);
    const res = await stockRoute(
      new Request(`${BASE}/api/tutoring/stock?page=2`, { headers }),
      configured,
      fetchImpl,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: number; totalHits: number };
    expect(body.page).toBe(2);
    expect(body.totalHits).toBe(80);
    const upstream = new URL(seen);
    expect(upstream.searchParams.get('q')).toBeNull();
    expect(upstream.searchParams.get('page')).toBe('2');
    expect(upstream.searchParams.get('per_page')).toBe('24');
    expect(upstream.searchParams.get('order')).toBe('popular');
  });

  it('budgets 30 searches a minute per user and then 429s', async () => {
    const cookie = await seedSession();
    const now = Date.now();
    for (let i = 0; i < 30; i += 1) {
      const ok = await stockRoute(
        stockRequest(cookie, 'roses'),
        configured,
        pixabay(PAYLOAD),
        now,
      );
      expect(ok.status).toBe(200);
    }
    const limited = await stockRoute(
      stockRequest(cookie, 'roses'),
      configured,
      pixabay(PAYLOAD),
      now,
    );
    expect(limited.status).toBe(429);

    const later = await stockRoute(
      stockRequest(cookie, 'roses'),
      configured,
      pixabay(PAYLOAD),
      now + 60_001,
    );
    expect(later.status).toBe(200);
  });

  it('reports an unreachable Pixabay as 502 rather than an empty grid', async () => {
    const cookie = await seedSession();
    const notOk = await stockRoute(stockRequest(cookie, 'unreachable'), configured, pixabay({}, false));
    expect(notOk.status).toBe(502);
    expect(await notOk.json()).toEqual({ error: 'stock-upstream' });

    const thrown = await stockRoute(
      stockRequest(cookie, 'unreachable-throw'),
      configured,
      (() => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    );
    expect(thrown.status).toBe(502);
    expect(await thrown.json()).toEqual({ error: 'stock-upstream' });
  });
});
