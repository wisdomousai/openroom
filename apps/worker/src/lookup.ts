/**
 * Tutor-only word lookup. Fills the private meaning draft. Not a session command,
 * not on the Durable Object, never on the ballot path.
 *
 * ## Why this always talks to en.wiktionary.org
 *
 * The Wikimedia REST endpoint `/page/definition/` is served by **one** edition:
 * `en.wiktionary.org`. Every other edition answers `501 Internal error`, and the
 * request that looked most obviously right —
 * `https://fr.wiktionary.org/…/definition/rater` for a French session — has never
 * returned anything. The payload is keyed by language code precisely so the
 * English edition can be asked about a foreign word: `payload['fr']` is the
 * French section of the entry, written in English.
 *
 * So the session locale selects a *section of the response*, never a hostname.
 */
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { readJson } from './control-utils.js';

const LOOKUP_LIMIT = 30;
const LOOKUP_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

/** The only edition that serves the definition endpoint. */
const DEFINITION_HOST = 'https://en.wiktionary.org';

/** One part-of-speech block of an entry, as the REST endpoint shapes it. */
interface DefinitionBlock {
  partOfSpeech?: unknown;
  definitions?: unknown;
}

/**
 * The blocks for one language section. Returns an empty list when the entry has
 * no section in that language — a German word looked up for a French session is
 * a miss, not a reason to fall back to whatever else the page happened to hold.
 */
function languageBlocks(payload: unknown, lang: string): DefinitionBlock[] {
  if (payload === null || typeof payload !== 'object') return [];
  const section = (payload as Record<string, unknown>)[lang];
  if (!Array.isArray(section)) return [];
  return section.filter(
    (entry): entry is DefinitionBlock => typeof entry === 'object' && entry !== null,
  );
}

function cleanDefinition(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/<[^>]+>/g, '')
    .trim()
    .slice(0, 200);
  return cleaned === '' ? null : cleaned;
}

/**
 * Short definitions for one language section of a REST payload.
 *
 * `lang` is required on purpose. This used to walk `Object.values(payload)` and
 * concatenate every language section, so an English sense of a German word
 * could be handed to a tutor teaching German.
 */
export function parseWiktionaryGlosses(payload: unknown, lang: string, max = 5): string[] {
  const glosses: string[] = [];
  for (const block of languageBlocks(payload, lang)) {
    if (!Array.isArray(block.definitions)) continue;
    for (const definition of block.definitions) {
      if (typeof definition !== 'object' || definition === null) continue;
      const text = cleanDefinition((definition as { definition?: unknown }).definition);
      if (text === null) continue;
      glosses.push(text);
      if (glosses.length >= max) return glosses;
    }
  }
  return glosses;
}

/**
 * The part of speech of the first block that has one. The REST payload carries
 * it and the old parser threw it away; a tutor picking between senses wants to
 * know whether they are looking at a verb or a noun.
 */
export function parseWiktionaryPartOfSpeech(payload: unknown, lang: string): string | undefined {
  for (const block of languageBlocks(payload, lang)) {
    if (typeof block.partOfSpeech === 'string' && block.partOfSpeech.trim() !== '') {
      return block.partOfSpeech.trim().slice(0, 40);
    }
  }
  return undefined;
}

/** A BCP-47-ish tag down to the bare language code the payload is keyed by. */
export function sectionKey(locale: string): string {
  const trimmed = locale.trim().toLowerCase();
  const base = trimmed.split(/[-_]/)[0] ?? '';
  return /^[a-z]{2,3}$/.test(base) ? base : 'en';
}

function allow(userId: string, now: number): boolean {
  const current = buckets.get(userId);
  if (current === undefined || now >= current.resetAt) {
    // The map lives for the isolate's lifetime, so lapsed windows are swept
    // whenever one rolls over rather than accruing one entry per user forever.
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
    buckets.set(userId, { count: 1, resetAt: now + LOOKUP_WINDOW_MS });
    return true;
  }
  if (current.count >= LOOKUP_LIMIT) return false;
  current.count += 1;
  return true;
}

export async function lookupRoute(
  request: Request,
  env: ControlEnv,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  if (!allow(guard.user.id, now)) return json({ error: 'lookup-rate-limited' }, 429);

  const body = (await readJson(request)) ?? {};
  const word = typeof body.word === 'string' ? body.word.trim().slice(0, 80) : '';
  if (word === '') return json({ error: 'invalid-word' }, 422);
  const locale = typeof body.locale === 'string' ? body.locale : 'en';
  const lang = sectionKey(locale);

  const url = `${DEFINITION_HOST}/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return json({ glosses: [] });
    const payload: unknown = await response.json();
    const partOfSpeech = parseWiktionaryPartOfSpeech(payload, lang);
    return json({
      glosses: parseWiktionaryGlosses(payload, lang),
      ...(partOfSpeech === undefined ? {} : { partOfSpeech }),
    });
  } catch {
    return json({ glosses: [] });
  }
}
