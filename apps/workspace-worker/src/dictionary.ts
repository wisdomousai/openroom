/**
 * Word lookup: the dictionary entry, and the meaning in the student's language.
 *
 * Tutor and learner convenience, never a session command and never on the ballot
 * path. This module holds no auth of its own — the two routes that call it
 * bring their own credential, because they carry different ones (a control
 * session for the tutor, a session capability token for the learner in a session).
 *
 * ## Where the data comes from, and why it is two places
 *
 * Upstream is kaikki.org, Tatu Ylonen's wiktextract of Wiktionary, served as
 * one static JSONL file per word.
 *
 *   forms   `/dictionary/{EnglishName}/meaning/{c1}/{c1c2}/{word}.jsonl`
 *   meaning `/{code}wiktionary/{NameInThatEdition}/meaning/{c1}/{c1c2}/{word}.jsonl`
 *
 * The English extraction is used for the table whatever the session language is,
 * because it is by far the richest: French `aller` carries 63 forms there and 8
 * in the German edition. The student-language edition is asked only for a short
 * sense, which is the one thing the English extraction cannot give a class whose
 * students do not read English.
 *
 * The language-name segment of the second URL is written in that edition's own
 * language ('Französisch', not 'French'), so it is a hand-verified map. Guessing
 * it produces a 404, and a 404 here would read as "no such word".
 *
 * ## Path segments are verbatim
 *
 * `Haus` lives at `H/Ha/Haus.jsonl` and `école` at `é/éc/école.jsonl` — case and
 * accents preserved. Lower-casing the prefix is a 404.
 */
import {
  buildSections,
  cleanForms,
  headwordLabels,
  DICTIONARY_ROOTS,
  meaningEdition,
  nativeNeedsEdition,
  type DictionaryEntry,
} from '@openroom/schema';

const BASE = 'https://kaikki.org';
const USER_AGENT = 'OpenRoom/1.0 (https://openroom.app)';
/** 36 KB of ungzipped JSONL is normal here; 2 s is not enough for it. */
const FETCH_TIMEOUT_MS = 4000;
const ENTRY_CACHE_MS = 24 * 60 * 60 * 1000;
const ENTRY_CACHE_MAX = 200;
/** Upstream ships one JSON object per part of speech; nothing needs hundreds. */
const MAX_LINES = 200;

const entryCache = new Map<string, { value: LookupResult; until: number }>();

export interface LookupResult {
  entry: DictionaryEntry | null;
  meaning: string | null;
  /** Set when a language pair is outside the verified maps above. */
  unsupported?: 'language' | 'meaning-language';
}

/**
 * Words this will ask upstream about. Letters, combining marks, hyphens and
 * apostrophes — enough for `école`, `qu'il` and `well-known`, and nothing that
 * could walk out of the path.
 */
const WORD = /^[\p{L}\p{M}][\p{L}\p{M}\p{Pd}'’]{0,39}$/u;

export function isLookupWord(word: string): boolean {
  return WORD.test(word);
}

/** A BCP-47-ish tag reduced to the bare code the maps are keyed by. */
export function languageCode(locale: string | undefined): string | null {
  if (typeof locale !== 'string') return null;
  const base = locale.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return /^[a-z]{2,3}$/.test(base) ? base : null;
}

/** `Haus` → `.../H/Ha/Haus.jsonl`. Verbatim prefixes, each segment encoded. */
export function wordPath(root: string, word: string): string {
  const first = [...word][0] ?? '';
  const second = [...word].slice(0, 2).join('');
  return `${BASE}/${root}/meaning/${encodeURIComponent(first)}/${encodeURIComponent(
    second,
  )}/${encodeURIComponent(word)}.jsonl`;
}

/** One upstream row, narrowed to the fields this reads. */
interface UpstreamRow {
  word?: unknown;
  pos?: unknown;
  lang_code?: unknown;
  forms?: unknown;
  senses?: unknown;
  head_templates?: unknown;
}

function parseJsonl(text: string): UpstreamRow[] {
  const rows: UpstreamRow[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null) rows.push(parsed as UpstreamRow);
    } catch {
      // A truncated last line is the normal shape of a clipped response.
    }
    if (rows.length >= MAX_LINES) break;
  }
  return rows;
}

async function fetchRows(
  url: string,
  fetchImpl: typeof fetch,
): Promise<UpstreamRow[] | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseJsonl(await response.text());
  } catch {
    return null;
  }
}

function textList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .slice(0, max)
    .map((item) => item.trim());
}

interface SenseRow {
  glosses?: unknown;
  tags?: unknown;
  form_of?: unknown;
  examples?: unknown;
}

function sensesOf(row: UpstreamRow): SenseRow[] {
  return Array.isArray(row.senses)
    ? row.senses.filter((s): s is SenseRow => typeof s === 'object' && s !== null)
    : [];
}

/** The lemma an inflected form points at, if that is all this row is. */
export function lemmaTarget(row: UpstreamRow): string | null {
  for (const sense of sensesOf(row)) {
    if (!Array.isArray(sense.form_of)) continue;
    for (const target of sense.form_of) {
      if (typeof target !== 'object' || target === null) continue;
      const word = (target as { word?: unknown }).word;
      if (typeof word === 'string' && word.trim() !== '') return word.trim();
    }
  }
  return null;
}

/**
 * The row that best describes the word: the one with the most inflected forms.
 * A word is often several parts of speech at once (`Haus` is a noun and a
 * surname; `schön` is an adjective and an adverb), and the richest table is the
 * one a reader meant to look up.
 */
function bestRow(rows: UpstreamRow[], lang: string): UpstreamRow | null {
  const matching = rows.filter((row) => row.lang_code === lang || row.lang_code === undefined);
  const pool = matching.length > 0 ? matching : rows;
  let best: UpstreamRow | null = null;
  let bestCount = -1;
  for (const row of pool) {
    const count = Array.isArray(row.forms) ? row.forms.length : 0;
    if (count > bestCount) {
      best = row;
      bestCount = count;
    }
  }
  return best;
}

function headwordOf(row: UpstreamRow): string | undefined {
  if (!Array.isArray(row.head_templates)) return undefined;
  for (const template of row.head_templates) {
    if (typeof template !== 'object' || template === null) continue;
    const expansion = (template as { expansion?: unknown }).expansion;
    if (typeof expansion === 'string' && expansion.trim() !== '') {
      return expansion.trim().replace(/\s+/g, ' ').slice(0, 120);
    }
  }
  return undefined;
}

function toEntry(
  row: UpstreamRow,
  options: { word: string; lemma: string; lang: string; url: string; resolvedFrom?: string },
): DictionaryEntry {
  const { labels, forms } = cleanForms(row.forms);
  const rawSenses = sensesOf(row);
  const senses = sensesOf(row)
    .map((sense) => {
      const gloss = textList(sense.glosses, 1)[0];
      if (gloss === undefined) return null;
      const tags = textList(sense.tags, 6);
      return { gloss, ...(tags.length === 0 ? {} : { tags }) };
    })
    .filter((sense): sense is { gloss: string; tags?: string[] } => sense !== null)
    .slice(0, 6);

  const headword = headwordOf(row);
  return {
    word: options.word,
    lemma: options.lemma,
    lang: options.lang,
    pos: typeof row.pos === 'string' ? row.pos : 'unknown',
    ...(headword === undefined ? {} : { headword }),
    /*
     * A verb's class and auxiliary come off the meta form rows; a noun's
     * gender only ever appears on its senses. Both end up in one list, because
     * a tutor reads them as one line under the headword.
     */
    labels: [...labels, ...headwordLabels(rawSenses, labels)],
    senses,
    sections: buildSections(forms),
    ...(options.resolvedFrom === undefined ? {} : { resolvedFrom: options.resolvedFrom }),
    source: { name: 'kaikki', url: options.url },
  };
}

/** The short sense in the reader's own language, or null when unavailable. */
async function fetchMeaning(
  word: string,
  lang: string,
  meaningLang: string,
  fetchImpl: typeof fetch,
): Promise<{ meaning: string | null; unsupported: boolean }> {
  const edition = meaningEdition(lang, meaningLang);
  if (edition === null) return { meaning: null, unsupported: true };
  // The edition names the taught language in its own words — 'Französisch', not
  // 'French' — and it is a path segment, not decoration.
  const rows = await fetchRows(wordPath(`${meaningLang}wiktionary/${edition}`, word), fetchImpl);
  if (rows === null) return { meaning: null, unsupported: false };
  for (const row of rows) {
    for (const sense of sensesOf(row)) {
      const gloss = textList(sense.glosses, 1)[0];
      if (gloss !== undefined) return { meaning: gloss.slice(0, 200), unsupported: false };
    }
  }
  return { meaning: null, unsupported: false };
}

export interface ResolveInput {
  word: string;
  /** Language being taught. */
  lang: string;
  /** The student's own language. Omit to skip the meaning entirely. */
  meaningLang?: string;
}

/**
 * Look a word up, following one hop from an inflected form to its lemma.
 *
 * The hop is capped at one on purpose. Upstream occasionally chains (Spanish
 * `allés` points at the participle `allé`, not at `aller`), and a loop here
 * would be an unbounded fan-out onto someone else's static host.
 */
export async function resolveEntry(
  input: ResolveInput,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<LookupResult> {
  const { word, lang, meaningLang } = input;
  if (!isLookupWord(word)) return { entry: null, meaning: null };

  const root = DICTIONARY_ROOTS[lang];
  if (root === undefined) return { entry: null, meaning: null, unsupported: 'language' };

  const cacheKey = `${lang}\0${meaningLang ?? ''}\0${word}`;
  const cached = entryCache.get(cacheKey);
  if (cached !== undefined && now < cached.until) return cached.value;

  const url = wordPath(`dictionary/${root}`, word);
  const rows = await fetchRows(url, fetchImpl);

  let entry: DictionaryEntry | null = null;
  if (rows !== null && rows.length > 0) {
    const row = bestRow(rows, lang);
    if (row !== null) {
      const hasForms = Array.isArray(row.forms) && row.forms.length > 0;
      const lemma = hasForms ? null : lemmaTarget(row);
      if (lemma !== null && lemma !== word && isLookupWord(lemma)) {
        const lemmaUrl = wordPath(`dictionary/${root}`, lemma);
        const lemmaRows = await fetchRows(lemmaUrl, fetchImpl);
        const lemmaRow = lemmaRows === null ? null : bestRow(lemmaRows, lang);
        entry =
          lemmaRow === null
            ? toEntry(row, { word, lemma: word, lang, url })
            : toEntry(lemmaRow, { word, lemma, lang, url: lemmaUrl, resolvedFrom: word });
      } else {
        entry = toEntry(row, { word, lemma: word, lang, url });
      }
    }
  }

  let meaning: string | null = null;
  let unsupported: LookupResult['unsupported'];
  if (meaningLang !== undefined) {
    if (nativeNeedsEdition(lang, meaningLang)) {
      const result = await fetchMeaning(entry?.lemma ?? word, lang, meaningLang, fetchImpl);
      meaning = result.meaning;
      if (result.unsupported) unsupported = 'meaning-language';
    } else {
      /*
       * English students, and a monolingual session, both read the entry's own
       * senses: the forms come from the English extraction, so its glosses are
       * already English. That is a whole second fetch saved for what is likely
       * the most common pair.
       */
      meaning = entry?.senses[0]?.gloss ?? null;
    }
  }

  const value: LookupResult = {
    entry,
    meaning,
    ...(unsupported === undefined ? {} : { unsupported }),
  };

  // Sweep on write rather than on a timer: the map lives for the isolate's
  // lifetime and nothing else here executes often enough to notice.
  if (entryCache.size >= ENTRY_CACHE_MAX) {
    for (const [key, held] of entryCache) {
      if (now >= held.until) entryCache.delete(key);
    }
    if (entryCache.size >= ENTRY_CACHE_MAX) {
      const oldest = entryCache.keys().next();
      if (!oldest.done) entryCache.delete(oldest.value);
    }
  }
  entryCache.set(cacheKey, { value, until: now + ENTRY_CACHE_MS });
  return value;
}
