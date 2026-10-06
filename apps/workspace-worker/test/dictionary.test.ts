import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { dictionaryRoute } from '../src/dictionary-route.js';
import { isLookupWord, languageCode, lemmaTarget, resolveEntry, wordPath } from '../src/dictionary.js';
import worker from '../src/index.js';
import { signCookieValue } from '../src/cookies.js';
import { BASE, createSmokeContext } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

/*
 * Upstream rows, trimmed to what the resolver reads. `gehst` is the shape that
 * matters most: an inflected form with no table of its own, pointing at a lemma.
 */
const GEHST = {
  word: 'gehst',
  pos: 'verb',
  lang_code: 'de',
  forms: [],
  senses: [{ glosses: ['second-person singular present of gehen'], form_of: [{ word: 'gehen' }] }],
};

const GEHEN = {
  word: 'gehen',
  pos: 'verb',
  lang_code: 'de',
  head_templates: [{ expansion: 'gehen (class 7 strong, third-person singular present geht)' }],
  forms: [
    { form: 'gehe', tags: ['first-person', 'indicative', 'present', 'singular'] },
    { form: 'gehst', tags: ['indicative', 'present', 'second-person', 'singular'] },
    { form: 'geht', tags: ['indicative', 'present', 'third-person', 'singular'] },
    { form: 'sein', tags: ['auxiliary'] },
  ],
  senses: [{ glosses: ['to go, to walk'] }],
};

const GEHEN_DE_EDITION = {
  word: 'gehen',
  pos: 'verb',
  lang_code: 'de',
  forms: [],
  senses: [{ glosses: ['sich zu Fuß fortbewegen'] }],
};

function jsonl(...rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n');
}

/** Serves canned bodies by URL and records what was asked for. */
function upstream(routes: Record<string, string | number>): {
  fetch: typeof fetch;
  seen: string[];
} {
  const seen: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const hit = routes[url];
    if (hit === undefined) return new Response('not found', { status: 404 });
    if (typeof hit === 'number') return new Response('upstream said no', { status: hit });
    return new Response(hit, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: impl, seen };
}

const GEHEN_URL = 'https://kaikki.org/dictionary/German/meaning/g/ge/gehen.jsonl';
const GEHST_URL = 'https://kaikki.org/dictionary/German/meaning/g/ge/gehst.jsonl';

/** Each test gets its own word so the isolate-lifetime cache cannot leak. */
let counter = 0;
function unique(word: string): string {
  counter += 1;
  return `${word}${'x'.repeat(counter)}`;
}

describe('wordPath', () => {
  it('uses the word’s own characters as the path prefix', () => {
    expect(wordPath('dictionary/German', 'gehen')).toBe(GEHEN_URL);
  });

  it('keeps capitals, because the prefix is case-sensitive upstream', () => {
    // `H/Ha/Haus.jsonl` is a 200 and `h/ha/Haus.jsonl` is a 404.
    expect(wordPath('dictionary/German', 'Haus')).toBe(
      'https://kaikki.org/dictionary/German/meaning/H/Ha/Haus.jsonl',
    );
  });

  it('keeps accents', () => {
    expect(wordPath('dictionary/French', 'école')).toBe(
      `https://kaikki.org/dictionary/French/meaning/${encodeURIComponent(
        'é',
      )}/${encodeURIComponent('éc')}/${encodeURIComponent('école')}.jsonl`,
    );
  });
});

describe('isLookupWord', () => {
  it('accepts the words a session actually contains', () => {
    for (const word of ['gehen', 'Haus', 'école', "qu'il", 'well-known']) {
      expect(isLookupWord(word), word).toBe(true);
    }
  });

  it('refuses anything that could leave the path', () => {
    for (const word of ['../secret', 'a/b', 'gehen.jsonl', '', 'x'.repeat(60), '<script>']) {
      expect(isLookupWord(word), word).toBe(false);
    }
  });
});

describe('languageCode', () => {
  it('reduces a tag to the code the language maps are keyed by', () => {
    expect(languageCode('fr-FR')).toBe('fr');
    expect(languageCode('DE')).toBe('de');
  });

  it('refuses a language name, which is not a code', () => {
    // An outline may carry `language: French` as prose; that is not a locale.
    expect(languageCode('French')).toBeNull();
    expect(languageCode(undefined)).toBeNull();
  });
});

describe('lemmaTarget', () => {
  it('reads the lemma an inflected form points at', () => {
    expect(lemmaTarget(GEHST)).toBe('gehen');
    expect(lemmaTarget(GEHEN)).toBeNull();
  });
});

describe('resolveEntry', () => {
  it('builds an entry with its table, headword and lifted labels', async () => {
    const word = unique('gehen');
    const { fetch: impl } = upstream({
      [wordPath('dictionary/German', word)]: jsonl(GEHEN),
    });
    const { entry } = await resolveEntry({ word, lang: 'de' }, impl);
    expect(entry?.pos).toBe('verb');
    expect(entry?.headword).toContain('class 7 strong');
    expect(entry?.labels).toContain('aux: sein');
    expect(entry?.sections[0]?.key).toBe('indicative-present');
  });

  it('follows an inflected form to its lemma, and only once', async () => {
    const { fetch: impl, seen } = upstream({
      [GEHST_URL]: jsonl(GEHST),
      [GEHEN_URL]: jsonl(GEHEN),
    });
    const { entry } = await resolveEntry({ word: 'gehst', lang: 'de' }, impl);
    expect(entry?.lemma).toBe('gehen');
    expect(entry?.resolvedFrom).toBe('gehst');
    expect(entry?.sections.length).toBeGreaterThan(0);
    expect(seen).toEqual([GEHST_URL, GEHEN_URL]);
  });

  it('stops at one hop when the lemma is itself a form', async () => {
    // Upstream chains: Spanish `allés` points at the participle `allé`. A loop
    // here would be an unbounded fan-out onto someone else's static host.
    const first = unique('allés');
    const second = unique('allé');
    const { fetch: impl, seen } = upstream({
      [wordPath('dictionary/French', first)]: jsonl({
        word: first,
        pos: 'verb',
        lang_code: 'fr',
        forms: [],
        senses: [{ glosses: ['form of'], form_of: [{ word: second }] }],
      }),
      [wordPath('dictionary/French', second)]: jsonl({
        word: second,
        pos: 'verb',
        lang_code: 'fr',
        forms: [],
        senses: [{ glosses: ['also a form of'], form_of: [{ word: 'aller' }] }],
      }),
    });
    await resolveEntry({ word: first, lang: 'fr' }, impl);
    expect(seen).toHaveLength(2);
  });

  it('reports an unmapped taught language instead of guessing a URL', async () => {
    const { fetch: impl, seen } = upstream({});
    const result = await resolveEntry({ word: unique('szo'), lang: 'hu' }, impl);
    expect(result.unsupported).toBe('language');
    expect(seen).toEqual([]);
  });

  it('reports an uncovered meaning pair rather than showing English', async () => {
    // Italian ← Dutch is left out of the pair table: the extraction is 1.4 MB,
    // too thin to promise. An Italian student must not be handed an English
    // sense just because that is what the English extraction carried.
    const word = unique('huis');
    const { fetch: impl } = upstream({
      [wordPath('dictionary/Dutch', word)]: jsonl({
        word,
        pos: 'noun',
        lang_code: 'nl',
        forms: [{ form: 'huizen', tags: ['plural'] }],
        senses: [{ glosses: ['a house'] }],
      }),
    });
    const result = await resolveEntry({ word, lang: 'nl', meaningLang: 'it' }, impl);
    expect(result.unsupported).toBe('meaning-language');
    expect(result.meaning).toBeNull();
    expect(result.entry).not.toBeNull();
  });

  it('reads an English student’s meaning off the entry, with no second fetch', async () => {
    // The forms come from the English extraction, so its glosses are already
    // English — the most likely pair costs one request, not two.
    const word = unique('gehen');
    const { fetch: impl, seen } = upstream({
      [wordPath('dictionary/German', word)]: jsonl(GEHEN),
    });
    const result = await resolveEntry({ word, lang: 'de', meaningLang: 'en' }, impl);
    expect(result.meaning).toBe('to go, to walk');
    expect(result.unsupported).toBeUndefined();
    expect(seen).toHaveLength(1);
  });

  it('takes the meaning from the reader’s own Wiktionary edition', async () => {
    // A German student learning French: the entry comes from the English
    // extraction (richest forms) and the meaning from the German edition,
    // whose path names French in German — `dewiktionary/Französisch`.
    const word = unique('aller');
    const { fetch: impl, seen } = upstream({
      [wordPath('dictionary/French', word)]: jsonl({
        word,
        pos: 'verb',
        lang_code: 'fr',
        forms: [{ form: 'vais', tags: ['first-person', 'indicative', 'present', 'singular'] }],
        senses: [{ glosses: ['to go'] }],
      }),
      [wordPath('dewiktionary/Französisch', word)]: jsonl({
        word,
        pos: 'verb',
        lang_code: 'fr',
        forms: [],
        senses: [{ glosses: ['sich von einem Ort zu einem anderen fortbewegen'] }],
      }),
    });
    const result = await resolveEntry({ word, lang: 'fr', meaningLang: 'de' }, impl);
    expect(result.entry?.senses[0]?.gloss).toBe('to go');
    expect(result.meaning).toBe('sich von einem Ort zu einem anderen fortbewegen');
    expect(seen).toContain(wordPath('dewiktionary/Französisch', word));
  });

  it('uses the entry’s own sense when both languages are the same', async () => {
    const word = unique('gehen');
    const { fetch: impl } = upstream({
      [wordPath('dictionary/German', word)]: jsonl(GEHEN),
    });
    const result = await resolveEntry({ word, lang: 'de', meaningLang: 'de' }, impl);
    expect(result.meaning).toBe('to go, to walk');
  });

  it('never returns a word it would not put in a URL', async () => {
    const { fetch: impl, seen } = upstream({});
    const result = await resolveEntry({ word: '../../etc/passwd', lang: 'de' }, impl);
    expect(result.entry).toBeNull();
    expect(seen).toEqual([]);
  });

  it('serves a repeated lookup from cache', async () => {
    const word = unique('gehen');
    const { fetch: impl, seen } = upstream({
      [wordPath('dictionary/German', word)]: jsonl(GEHEN),
    });
    await resolveEntry({ word, lang: 'de' }, impl);
    await resolveEntry({ word, lang: 'de' }, impl);
    expect(seen).toHaveLength(1);
  });

  it('returns an empty entry, not an error, when upstream is down', async () => {
    const word = unique('gehen');
    const { fetch: impl } = upstream({ [wordPath('dictionary/German', word)]: 503 });
    const result = await resolveEntry({ word, lang: 'de' }, impl);
    expect(result.entry).toBeNull();

    const thrown = (() => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const crashed = await resolveEntry({ word: unique('gehen'), lang: 'de' }, thrown);
    expect(crashed.entry).toBeNull();
  });

  it('survives a response clipped mid-line', async () => {
    const word = unique('gehen');
    const { fetch: impl } = upstream({
      [wordPath('dictionary/German', word)]: `${JSON.stringify(GEHEN)}\n{"word":"trunca`,
    });
    const { entry } = await resolveEntry({ word, lang: 'de' }, impl);
    expect(entry?.pos).toBe('verb');
  });
});

async function seedSession(): Promise<{ cookie: string; userId: string }> {
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
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(await signCookieValue(TOKEN_SECRET, sessionId))}`;
  return { cookie, userId };
}

/** A second member of an existing space, at a role that cannot change settings. */
async function seedMember(spaceId: string, role: string): Promise<string> {
  const { cookie, userId } = await seedSession();
  await env.DB.prepare(
    'INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(spaceId, userId, role, Date.now())
    .run();
  return cookie;
}

function asUser(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('content-type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env as never);
}

/**
 * A space with one deck in it, configured to teach German to English
 * speakers. Pass `null` for a space that is not a language-tutoring space.
 */
async function seedConfiguredSpace(
  languages: { taught: string; native: string } | null = { taught: 'de', native: 'en' },
): Promise<{ cookie: string; spaceId: string; deckId: string }> {
  const { cookie } = await seedSession();
  const { contextId, spaceId } = await createSmokeContext((path, init) => asUser(cookie, path, init ?? {}));
  const res = await asUser(cookie, '/api/decks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Perfekt', contextId, spaceId }),
  });
  expect(res.status).toBe(201);
  const { deck } = (await res.json()) as { deck: { id: string } };
  await env.DB.prepare('UPDATE spaces SET settings = ?1 WHERE id = ?2')
    .bind(JSON.stringify(languages === null ? {} : { languages }), spaceId)
    .run();
  return { cookie, spaceId, deckId: deck.id };
}

function dictionaryRequest(cookie: string | null, body: unknown, method = 'POST'): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookie !== null) headers.set('cookie', cookie);
  return new Request(`${BASE}/api/tutoring/dictionary`, {
    method,
    headers,
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

describe('POST /api/tutoring/dictionary', () => {
  it('refuses a caller with no session', async () => {
    const res = await dictionaryRoute(dictionaryRequest(null, { word: 'gehen' }), env as never);
    expect(res.status).toBe(401);
  });

  it('refuses a wrong method', async () => {
    const res = await dictionaryRoute(dictionaryRequest(null, null, 'GET'), env as never);
    expect(res.status).toBe(405);
  });

  it('refuses a word it would not put in a URL', async () => {
    const { cookie, deckId } = await seedConfiguredSpace();
    const res = await dictionaryRoute(
      dictionaryRequest(cookie, { word: '../x', scope: { deckId } }),
      env as never,
    );
    expect(res.status).toBe(422);
  });

  it('needs a scope it can resolve to a space', async () => {
    const { cookie } = await seedConfiguredSpace();
    for (const scope of [undefined, {}, { deckId: 'nope' }, { sessionCode: 'ZZZZZZ' }]) {
      const res = await dictionaryRoute(
        dictionaryRequest(cookie, { word: 'gehen', ...(scope === undefined ? {} : { scope }) }),
        env as never,
      );
      expect(res.status).toBe(404);
    }
  });

  it('hides a space the caller is not a member of behind the same 404', async () => {
    const { deckId } = await seedConfiguredSpace();
    const { cookie: stranger } = await seedSession();
    const res = await dictionaryRoute(
      dictionaryRequest(stranger, { word: 'gehen', scope: { deckId } }),
      env as never,
    );
    expect(res.status).toBe(404);
  });

  /*
   * The refusal names the space and says whether this caller may fix it, so the
   * console can offer the pair picker where the lookup failed instead of
   * sending a tutor out of a live session. Both facts were already resolved to
   * reach this branch.
   */
  it('refuses a space with no language pair configured, naming the space', async () => {
    const { cookie, spaceId, deckId } = await seedConfiguredSpace(null);
    const res = await dictionaryRoute(
      dictionaryRequest(cookie, { word: 'gehen', scope: { deckId } }),
      env as never,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'languages-not-configured',
      spaceId,
      canEdit: true,
    });
  });

  it('tells a presenter the pair is unset but not theirs to set', async () => {
    const { spaceId, deckId } = await seedConfiguredSpace(null);
    const presenter = await seedMember(spaceId, 'presenter');
    const res = await dictionaryRoute(
      dictionaryRequest(presenter, { word: 'gehen', scope: { deckId } }),
      env as never,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'languages-not-configured',
      spaceId,
      canEdit: false,
    });
  });

  /*
   * The point of the scope. A caller that names a language gets the space's
   * language anyway, so nobody can shop for a dictionary their space did not
   * configure — and no surface has to know the pair to ask a question.
   */
  it('takes the language from the space and ignores one in the body', async () => {
    const { cookie, deckId } = await seedConfiguredSpace();
    const word = unique('gehen');
    const { fetch: impl, seen } = upstream({
      [wordPath('dictionary/German', word)]: jsonl({ ...GEHEN, word }),
    });
    const res = await dictionaryRoute(
      dictionaryRequest(cookie, { word, locale: 'fr', meaningLocale: 'it', scope: { deckId } }),
      env as never,
      impl,
    );
    expect(res.status).toBe(200);
    expect(seen).toEqual([wordPath('dictionary/German', word)]);
    const body = (await res.json()) as { entry: { lang: string } | null };
    expect(body.entry?.lang).toBe('de');
  });

  it('resolves a session code to the same space', async () => {
    const { cookie, spaceId } = await seedConfiguredSpace();
    const code = `RM${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    await env.DB.prepare(
      'INSERT INTO live_sessions (code, user_id, title, created_at, ended, space_id) VALUES (?1, NULL, ?2, ?3, 0, ?4)',
    )
      .bind(code, 'Lesson', Date.now(), spaceId)
      .run();
    const word = unique('gehen');
    const { fetch: impl } = upstream({
      [wordPath('dictionary/German', word)]: jsonl({ ...GEHEN, word }),
    });
    const res = await dictionaryRoute(
      dictionaryRequest(cookie, { word, scope: { sessionCode: code } }),
      env as never,
      impl,
    );
    expect(res.status).toBe(200);
  });

  it('budgets 30 lookups a minute per user and then 429s', async () => {
    const { cookie, deckId } = await seedConfiguredSpace();
    const now = Date.now();
    const word = unique('gehen');
    const { fetch: impl } = upstream({
      [wordPath('dictionary/German', word)]: jsonl({ ...GEHEN, word }),
    });
    for (let i = 0; i < 30; i += 1) {
      const ok = await dictionaryRoute(
        dictionaryRequest(cookie, { word, scope: { deckId } }),
        env as never,
        impl,
        now,
      );
      expect(ok.status).toBe(200);
    }
    const limited = await dictionaryRoute(
      dictionaryRequest(cookie, { word, scope: { deckId } }),
      env as never,
      impl,
      now,
    );
    expect(limited.status).toBe(429);
  });
});
