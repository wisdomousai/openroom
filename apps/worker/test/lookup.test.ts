import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE } from '../src/auth.js';
import worker from '../src/index.js';
import {
  lookupRoute,
  parseWiktionaryGlosses,
  parseWiktionaryPartOfSpeech,
  sectionKey,
} from '../src/lookup.js';
import { signCookieValue } from '../src/cookies.js';
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

function lookupRequest(cookie: string | null, body: unknown, method = 'POST'): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookie !== null) headers.set('cookie', cookie);
  return new Request(`${BASE}/api/tutoring/lookup`, {
    method,
    headers,
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

/** Upstream stand-in: never let a test reach the real Wiktionary. */
function wiktionary(payload: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: ok ? 200 : 503,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

const SAMPLE = { fr: [{ definitions: [{ definition: 'to miss the train' }] }] };

/**
 * A word that exists in two languages. `gehen` is only German, but the REST
 * payload is keyed by language and an entry routinely carries several sections
 * — which is the whole reason the parser takes a language.
 */
const TWO_SECTIONS = {
  de: [{ partOfSpeech: 'Verb', definitions: [{ definition: 'to <i>go</i>, to walk' }] }],
  en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'an unrelated English sense' }] }],
};

describe('parseWiktionaryGlosses', () => {
  it('pulls short definitions from the REST payload', () => {
    const glosses = parseWiktionaryGlosses(
      {
        en: [
          {
            definitions: [
              { definition: 'to <i>miss</i> a train' },
              { definition: 'to fail to catch' },
            ],
          },
        ],
      },
      'en',
    );
    expect(glosses).toEqual(['to miss a train', 'to fail to catch']);
  });

  it('reads only the language section it was asked for', () => {
    // The bug this replaces walked every section and concatenated them, so a
    // tutor teaching German could be offered an English sense of the same word.
    expect(parseWiktionaryGlosses(TWO_SECTIONS, 'de')).toEqual(['to go, to walk']);
    expect(parseWiktionaryGlosses(TWO_SECTIONS, 'en')).toEqual(['an unrelated English sense']);
  });

  it('treats a missing language section as a miss', () => {
    expect(parseWiktionaryGlosses(TWO_SECTIONS, 'fr')).toEqual([]);
  });

  it('returns an empty list for a broken payload', () => {
    expect(parseWiktionaryGlosses(null, 'en')).toEqual([]);
    expect(parseWiktionaryGlosses({ en: 'nope' }, 'en')).toEqual([]);
  });
});

describe('parseWiktionaryPartOfSpeech', () => {
  it('keeps the part of speech the payload carries', () => {
    expect(parseWiktionaryPartOfSpeech(TWO_SECTIONS, 'de')).toBe('Verb');
    expect(parseWiktionaryPartOfSpeech(TWO_SECTIONS, 'en')).toBe('Noun');
    expect(parseWiktionaryPartOfSpeech(TWO_SECTIONS, 'fr')).toBeUndefined();
  });
});

describe('sectionKey', () => {
  it('reduces a locale tag to the code the payload is keyed by', () => {
    expect(sectionKey('fr-FR')).toBe('fr');
    expect(sectionKey('DE')).toBe('de');
    expect(sectionKey('pt_BR')).toBe('pt');
  });

  it('falls back to English for a tag it cannot read', () => {
    expect(sectionKey('')).toBe('en');
    expect(sectionKey('!!')).toBe('en');
  });
});

describe('POST /api/tutoring/lookup', () => {
  it('refuses a caller with no session', async () => {
    const res = await worker.fetch(lookupRequest(null, { word: 'rater' }), env as never);
    expect(res.status).toBe(401);
  });

  it('refuses a wrong method', async () => {
    const res = await worker.fetch(lookupRequest(null, null, 'GET'), env as never);
    expect(res.status).toBe(405);
  });

  it('refuses an empty or missing word with 422', async () => {
    const cookie = await seedSession();
    const empty = await lookupRoute(lookupRequest(cookie, { word: '   ' }), env as never);
    expect(empty.status).toBe(422);
    const missing = await lookupRoute(lookupRequest(cookie, {}), env as never);
    expect(missing.status).toBe(422);
  });

  it('returns the parsed glosses for the session locale', async () => {
    const cookie = await seedSession();
    const res = await lookupRoute(
      lookupRequest(cookie, { word: 'rater', locale: 'fr-FR' }),
      env as never,
      wiktionary(SAMPLE),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ glosses: ['to miss the train'] });
  });

  it('asks en.wiktionary.org whatever the session locale is', async () => {
    // fr.wiktionary.org and every other edition answer 501 for this endpoint,
    // so a French session has to ask the English edition for its French section.
    const cookie = await seedSession();
    const seen: string[] = [];
    const spy = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify(SAMPLE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const res = await lookupRoute(
      lookupRequest(cookie, { word: 'rater', locale: 'fr-FR' }),
      env as never,
      spy,
    );
    expect(res.status).toBe(200);
    expect(seen).toEqual(['https://en.wiktionary.org/api/rest_v1/page/definition/rater']);
  });

  it('budgets 30 lookups a minute per user and then 429s', async () => {
    const cookie = await seedSession();
    const now = Date.now();
    for (let i = 0; i < 30; i += 1) {
      const ok = await lookupRoute(
        lookupRequest(cookie, { word: 'rater' }),
        env as never,
        wiktionary(SAMPLE),
        now,
      );
      expect(ok.status).toBe(200);
    }
    const limited = await lookupRoute(
      lookupRequest(cookie, { word: 'rater' }),
      env as never,
      wiktionary(SAMPLE),
      now,
    );
    expect(limited.status).toBe(429);

    // The window is fixed, so the next one starts clean.
    const later = await lookupRoute(
      lookupRequest(cookie, { word: 'rater' }),
      env as never,
      wiktionary(SAMPLE),
      now + 60_001,
    );
    expect(later.status).toBe(200);
  });

  it('soft-fails to an empty list when the dictionary is unreachable', async () => {
    const cookie = await seedSession();
    const notOk = await lookupRoute(
      lookupRequest(cookie, { word: 'rater' }),
      env as never,
      wiktionary({}, false),
    );
    expect(notOk.status).toBe(200);
    expect(await notOk.json()).toEqual({ glosses: [] });

    const thrown = await lookupRoute(
      lookupRequest(cookie, { word: 'rater' }),
      env as never,
      (() => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    );
    expect(thrown.status).toBe(200);
    expect(await thrown.json()).toEqual({ glosses: [] });
  });
});
