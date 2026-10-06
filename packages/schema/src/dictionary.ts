/**
 * Dictionary entries: the shape a word lookup takes on the wire and on a slide.
 *
 * ## Why this is tag-driven and not per-part-of-speech
 *
 * Upstream (wiktextract) describes every inflected form the same way — a string
 * and a flat list of grammatical tags:
 *
 *     { form: 'gehe',        tags: ['first-person','indicative','present','singular'] }
 *     { form: 'schöner',     tags: ['masculine','nominative','singular','strong'] }
 *     { form: 'bin gegangen',tags: ['first-person','indicative','perfect','singular'] }
 *
 * So a verb's conjugation, an adjective's declension and a noun's case table are
 * the *same data* under different tags. Grouping on the tags rather than
 * branching on the part of speech is what makes pronouns, articles, participles
 * and case-governing prepositions work without anyone writing a rule for them —
 * and it is why there is deliberately no `switch (pos)` anywhere in this file.
 *
 * The tag vocabulary below is closed on purpose. Upstream carries long-tail
 * qualifiers ('Ruhrdeutsch', '18th-ct.', 'especially') that would each split a
 * table into another near-empty section; anything not named here is ignored
 * rather than allowed to fragment the grid.
 */

/** One cell run of a form table. `null` is a gap, not an empty string. */
export interface FormRow {
  label: string;
  cells: (string | null)[];
}

/**
 * One block of a form table — a tense, a mood, a degree, a declension pattern,
 * or the unlabelled `base` block for words whose forms carry no section tag.
 */
export interface FormSection {
  /** Stable slug of the section's tag set: 'indicative-present', 'base'. */
  key: string;
  label: string;
  /** Empty when the section is a flat list rather than a grid. */
  columnLabels: string[];
  rows: FormRow[];
}

export interface DictionarySense {
  gloss: string;
  tags?: string[];
  example?: string;
}

export interface DictionaryEntry {
  /** The word as it was looked up — the inflected form the reader clicked. */
  word: string;
  /** The headword the entry actually describes. Equal to `word` for a lemma. */
  lemma: string;
  /** Language of the entry, as a bare code: 'de', 'fr'. */
  lang: string;
  /** Part of speech, verbatim from upstream: verb | noun | adj | prep | … */
  pos: string;
  /** Display line for the headword: 'Haus n', 'gehen (class 7 strong)'. */
  headword?: string;
  /** Grammar facts that belong beside the table, not in it: gender, auxiliary. */
  labels: string[];
  senses: DictionarySense[];
  sections: FormSection[];
  /** Set when the looked-up word was an inflected form of `lemma`. */
  resolvedFrom?: string;
  source: { name: string; url: string };
}

/* ------------------------------------------------------------------- caps */

/*
 * An entry can be projected onto the wall, which puts it in session state and
 * therefore in every snapshot to every phone. `gehen` alone carries 111 forms
 * and 36 KB of upstream JSON, so the caps are the whole defence. They are
 * enforced here and re-checked by the session reducer: a host bundle is not a
 * trust boundary.
 */
export const MAX_SENSES = 6;
/*
 * A German verb runs to 20 mood/tense blocks and an adjective to 17 — measured,
 * not guessed. The cap is a guard against a pathological entry, not a budget:
 * capping lower silently dropped the imperative off `gehen`, which is not a
 * form a language class can do without. A full entry serializes to ~5 KB, so
 * MAX_ENTRY_BYTES stays the real ceiling.
 */
export const MAX_SECTIONS = 24;
export const MAX_SECTION_COLUMNS = 8;
export const MAX_SECTION_ROWS = 12;
export const MAX_FORM_CHARS = 40;
export const MAX_GLOSS_CHARS = 200;
export const MAX_ENTRY_BYTES = 8192;

/* ------------------------------------------------------- the tag vocabulary */

/** Rows that describe the table rather than the word. Never forms. */
const META_TAGS = new Set([
  'table-tags',
  'inflection-template',
  'class',
  'auxiliary',
  'error-unrecognized-form',
]);

/**
 * Rows worth dropping outright. A teaching table wants the forms a student will
 * meet, not every attestation the dictionary holds.
 */
const DROP_TAGS = new Set([
  'obsolete',
  'archaic',
  'dialectal',
  'rare',
  'nonstandard',
  'romanization',
  'alternative',
]);

/**
 * Tags that carry no grammar for our purposes. Dropped from a form's tag set
 * while the form itself is kept.
 *
 * `multiword-construction` is the important one: it marks the compound tenses
 * ('bin gegangen', 'werde gehen'), which are the single largest group of forms
 * on a German verb and exactly what a learner needs. It is a shape marker, not
 * a grammatical category.
 */
const IGNORE_TAGS = new Set([
  'multiword-construction',
  'includes-article',
  'without-article',
  'also',
  'especially',
  // Redundant on adjectives, where strong/weak/mixed already names the article
  // pattern — and actively wrong on nouns, where the plural forms carry
  // `definite` and would otherwise split out of the case grid into a section
  // of their own ('Häuser' leaving 'Haus' with an empty plural column).
  'definite',
  'indefinite',
]);

/**
 * Tags implied by a more specific one. German marks its compound futures as
 * both `future` and `future-i`, so without this a section reads
 * "Infinitive future future I".
 */
const IMPLIED_BY: Record<string, string> = {
  'future-i': 'future',
  'future-ii': 'future',
  'subjunctive-i': 'subjunctive',
  'subjunctive-ii': 'subjunctive',
};

/**
 * Axis families, in the order a table prefers them. Members of these become the
 * rows and columns of a grid; everything else names the section.
 *
 * Degree is deliberately *not* here: an adjective's comparative deserves its own
 * full case × gender grid, not a column inside the positive one.
 */
const AXIS_FAMILIES: { family: string; values: string[] }[] = [
  { family: 'number', values: ['singular', 'dual', 'plural'] },
  {
    family: 'gender',
    values: ['masculine', 'feminine', 'neuter', 'common', 'animate', 'inanimate'],
  },
  {
    family: 'case',
    values: [
      'nominative',
      'genitive',
      'dative',
      'accusative',
      'vocative',
      'instrumental',
      'locative',
      'ablative',
      'prepositional',
    ],
  },
  { family: 'person', values: ['first-person', 'second-person', 'third-person'] },
  { family: 'politeness', values: ['formal', 'informal'] },
];

const AXIS_OF = new Map<string, string>();
for (const { family, values } of AXIS_FAMILIES) {
  for (const value of values) AXIS_OF.set(value, family);
}

/** Preferred column family, most grid-like first. */
const COLUMN_PREFERENCE = ['number', 'gender', 'politeness', 'case'];
/** Preferred row family. Whatever the column took is skipped. */
const ROW_PREFERENCE = ['person', 'case', 'gender', 'number'];

/**
 * Section tags, ranked. The rank fixes the order blocks appear in, so the same
 * entry always renders the same way — a table whose rows move between lookups
 * is unreadable in front of a class.
 */
const SECTION_RANK: Record<string, number> = {
  // Non-finite first: the headword's own shapes.
  infinitive: 10,
  participle: 11,
  gerund: 12,
  supine: 13,
  /*
   * Declension outranks degree on purpose. A positive adjective carries no
   * degree tag at all, so ranking `comparative` first would sort every plain
   * form behind every comparative one and let the cap drop the base table —
   * the one block a class actually needs.
   */
  strong: 20,
  weak: 21,
  mixed: 22,
  predicative: 23,
  attributive: 24,
  // Degree, for adjectives and adverbs.
  positive: 30,
  comparative: 31,
  superlative: 32,
  // Mood.
  indicative: 40,
  subjunctive: 41,
  'subjunctive-i': 42,
  'subjunctive-ii': 43,
  conditional: 44,
  imperative: 45,
  // Tense.
  present: 50,
  past: 51,
  preterite: 52,
  imperfect: 53,
  perfect: 54,
  pluperfect: 55,
  future: 56,
  'future-i': 57,
  'future-ii': 58,
  // Voice.
  active: 60,
  passive: 61,
  // Polarity.
  negative: 70,
};

/** Words used to build a human label out of a tag. */
const TAG_LABEL: Record<string, string> = {
  'first-person': '1st person',
  'second-person': '2nd person',
  'third-person': '3rd person',
  'subjunctive-i': 'subjunctive I',
  'subjunctive-ii': 'subjunctive II',
  'future-i': 'future I',
  'future-ii': 'future II',
};

function labelFor(tag: string): string {
  return TAG_LABEL[tag] ?? tag;
}

/**
 * Reading order for a section label, which is not the same as sort order: a
 * table sorts by declension so the plain forms come first, but the label reads
 * "Comparative strong", not "Strong comparative".
 */
const LABEL_ORDER = [
  'positive',
  'comparative',
  'superlative',
  'infinitive',
  'participle',
  'gerund',
  'supine',
  'indicative',
  'subjunctive',
  'subjunctive-i',
  'subjunctive-ii',
  'conditional',
  'imperative',
  'present',
  'past',
  'preterite',
  'imperfect',
  'perfect',
  'pluperfect',
  'future',
  'future-i',
  'future-ii',
  'active',
  'passive',
  'strong',
  'weak',
  'mixed',
  'predicative',
  'attributive',
  'negative',
];

function sectionLabel(tags: string[]): string {
  const ordered = [...tags].sort((a, b) => {
    const left = LABEL_ORDER.indexOf(a);
    const right = LABEL_ORDER.indexOf(b);
    return (left === -1 ? 999 : left) - (right === -1 ? 999 : right);
  });
  return sentenceCase(ordered.map(labelFor).join(' '));
}

function sentenceCase(text: string): string {
  return text === '' ? text : text[0]!.toUpperCase() + text.slice(1);
}

/* ------------------------------------------------------------- the grouping */

/** A form as upstream hands it over. */
export interface RawForm {
  form?: unknown;
  tags?: unknown;
}

interface CleanForm {
  form: string;
  tags: string[];
}

/**
 * Facts lifted out of the meta rows on the way past — a verb's class and its
 * auxiliary are grammar a tutor wants, but they are not inflected forms and
 * they have no place in the grid.
 */
export interface LiftedLabels {
  labels: string[];
  forms: CleanForm[];
}

const TEMPLATE_NAME = /^[a-z]{2,3}-[a-z0-9-]+$/;

export function cleanForms(raw: unknown): LiftedLabels {
  const labels: string[] = [];
  const forms: CleanForm[] = [];
  if (!Array.isArray(raw)) return { labels, forms };

  for (const candidate of raw) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const row = candidate as RawForm;
    const form = typeof row.form === 'string' ? row.form.trim() : '';
    const tags = Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];
    if (form === '' || form === '-' || form.includes('\n')) continue;
    if (form.length > MAX_FORM_CHARS) continue;

    if (tags.includes('class')) {
      labels.push(form);
      continue;
    }
    if (tags.includes('auxiliary')) {
      labels.push(`aux: ${form}`);
      continue;
    }
    if (tags.some((tag) => META_TAGS.has(tag))) continue;
    if (tags.some((tag) => DROP_TAGS.has(tag))) continue;
    // A bare template name ('de-conj') that escaped its tag.
    if (tags.length === 0 && TEMPLATE_NAME.test(form)) continue;

    const kept = tags.filter((tag) => !IGNORE_TAGS.has(tag));
    forms.push({ form, tags: kept });
  }
  return { labels: [...new Set(labels)], forms };
}

/**
 * Headword properties a tutor states out loud, lifted from the senses.
 *
 * These are facts about the word, not inflected forms, so they belong beside
 * the headword and not in the grid. A closed set on purpose: sense tags also
 * carry register ('colloquial'), dialect and usage notes, and a table captioned
 * "colloquial" would be telling the class the wrong thing.
 *
 * Nouns are the case that makes this necessary. A verb's class and auxiliary
 * arrive as meta *form* rows and are lifted by `cleanForms`; a noun's gender
 * arrives only here.
 */
const HEADWORD_TAGS = new Set([
  // gender
  'masculine',
  'feminine',
  'neuter',
  'common-gender',
  // declension class
  'strong',
  'weak',
  'mixed',
  // countability and number-defective nouns
  'countable',
  'uncountable',
  'plural-only',
  'singular-only',
  'plurale-tantum',
  'singulare-tantum',
  // valency
  'transitive',
  'intransitive',
  'ditransitive',
  'ambitransitive',
  'reflexive',
  'impersonal',
  // aspect (Slavic) and animacy (Slavic, Semitic)
  'perfective',
  'imperfective',
  'animate',
  'inanimate',
]);

const MAX_HEADWORD_LABELS = 6;

/**
 * The headword properties carried by a word's senses.
 *
 * A candidate already spoken for by a label lifted from the forms is dropped:
 * a German strong verb arrives with a class row reading "7 strong", and
 * appending a bare "strong" beside it says the same thing twice.
 */
export function headwordLabels(senses: unknown, existing: string[] = []): string[] {
  if (!Array.isArray(senses)) return [];
  const spoken = new Set(existing.flatMap((label) => label.split(/[\s:]+/)));
  const found: string[] = [];
  for (const candidate of senses) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const tags = (candidate as { tags?: unknown }).tags;
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      if (typeof tag !== 'string') continue;
      if (!HEADWORD_TAGS.has(tag)) continue;
      if (spoken.has(tag) || found.includes(tag)) continue;
      found.push(tag);
    }
  }
  return found.slice(0, MAX_HEADWORD_LABELS);
}

function sectionKeyOf(tags: string[]): string[] {
  const named = tags.filter((tag) => !AXIS_OF.has(tag) && tag in SECTION_RANK);
  const implied = new Set(
    named.map((tag) => IMPLIED_BY[tag]).filter((tag): tag is string => tag !== undefined),
  );
  return named
    .filter((tag) => !implied.has(tag))
    .sort((a, b) => (SECTION_RANK[a] ?? 999) - (SECTION_RANK[b] ?? 999));
}

function axisValue(tags: string[], family: string): string | null {
  for (const tag of tags) if (AXIS_OF.get(tag) === family) return tag;
  return null;
}

function orderedValues(family: string, present: Set<string>): string[] {
  const declared = AXIS_FAMILIES.find((entry) => entry.family === family)?.values ?? [];
  return declared.filter((value) => present.has(value));
}

/**
 * Turn a flat form list into ordered, labelled blocks.
 *
 * Every part of speech takes the same path. What differs is only which tags the
 * forms happen to carry:
 *
 * - verb      → sections by mood + tense, grid of person × number
 * - noun      → one `base` section, grid of case × number
 * - adjective → sections by degree + declension, grid of case × gender
 * - pronoun   → one section, grid of case × number or gender
 * - preposition, adverb → no sections at all; the senses carry the meaning
 */
export function buildSections(forms: CleanForm[]): FormSection[] {
  const grouped = new Map<string, { tags: string[]; forms: CleanForm[] }>();
  for (const form of forms) {
    const sectionTags = sectionKeyOf(form.tags);
    const key = sectionTags.length === 0 ? 'base' : sectionTags.join('-');
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, { tags: sectionTags, forms: [form] });
    else bucket.forms.push(form);
  }

  const ranked: { section: FormSection; rank: number }[] = [];
  for (const [key, bucket] of grouped) {
    const section = buildOneSection(key, bucket.tags, bucket.forms);
    if (section !== null) ranked.push({ section, rank: sectionSort(bucket.tags) });
  }

  ranked.sort((a, b) => a.rank - b.rank || a.section.key.localeCompare(b.section.key));
  return ranked.slice(0, MAX_SECTIONS).map((entry) => entry.section);
}

/**
 * The rank of a section's leading tag; the unlabelled `base` block comes first.
 *
 * Ranks come from the tag list, never from re-splitting the joined key: several
 * tags contain a hyphen ('subjunctive-i'), so `key.split('-')[0]` reads back a
 * different tag than the one that went in.
 */
function sectionSort(tags: string[]): number {
  const first = tags[0];
  if (first === undefined) return -1;
  return SECTION_RANK[first] ?? 999;
}

function buildOneSection(key: string, tags: string[], forms: CleanForm[]): FormSection | null {
  if (forms.length === 0) return null;
  const label = key === 'base' ? 'Forms' : sectionLabel(tags);

  // Which axis families are actually used, and by more than one value — a
  // family with a single value everywhere is a fact about the section, not a
  // dimension worth spending a row or a column on.
  const present = new Map<string, Set<string>>();
  for (const form of forms) {
    for (const tag of form.tags) {
      const family = AXIS_OF.get(tag);
      if (family === undefined) continue;
      const values = present.get(family) ?? new Set<string>();
      values.add(tag);
      present.set(family, values);
    }
  }
  const useful = new Set(
    [...present.entries()].filter(([, values]) => values.size > 1).map(([family]) => family),
  );

  const column = COLUMN_PREFERENCE.find((family) => useful.has(family)) ?? null;
  const row = ROW_PREFERENCE.find((family) => useful.has(family) && family !== column) ?? null;

  if (column === null && row === null) {
    // No grid to build: a flat list, one form per line.
    const seen = new Set<string>();
    const rows: FormRow[] = [];
    for (const form of forms) {
      if (seen.has(form.form)) continue;
      seen.add(form.form);
      rows.push({ label: '', cells: [form.form] });
      if (rows.length >= MAX_SECTION_ROWS) break;
    }
    return { key, label, columnLabels: [], rows };
  }

  const columnValues =
    column === null ? [null] : orderedValues(column, present.get(column)!).slice(0, MAX_SECTION_COLUMNS);
  const rowValues = row === null ? [null] : orderedValues(row, present.get(row)!).slice(0, MAX_SECTION_ROWS);

  const rows: FormRow[] = [];
  for (const rowValue of rowValues) {
    const cells: (string | null)[] = [];
    for (const columnValue of columnValues) {
      const hits: string[] = [];
      for (const form of forms) {
        if (rowValue !== null && axisValue(form.tags, row!) !== rowValue) continue;
        if (columnValue !== null && axisValue(form.tags, column!) !== columnValue) continue;
        if (!hits.includes(form.form)) hits.push(form.form);
      }
      cells.push(hits.length === 0 ? null : hits.slice(0, 3).join(', '));
    }
    if (cells.every((cell) => cell === null)) continue;
    rows.push({ label: rowValue === null ? '' : labelFor(rowValue), cells });
  }
  if (rows.length === 0) return null;

  return {
    key,
    label,
    columnLabels: columnValues.map((value) => (value === null ? '' : labelFor(value))),
    rows,
  };
}

/* -------------------------------------------------------------- validation */

function stringOr(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

/**
 * Narrow an untrusted value to an entry, or `null`.
 *
 * Hand-written rather than schema-driven: `packages/schema` precompiles Ajv for
 * the authored outline file format because Workers forbid runtime compilation,
 * and a dictionary entry is never in an authored file.
 */
export function parseDictionaryEntry(value: unknown): DictionaryEntry | null {
  if (value === null || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  const word = stringOr(raw.word, MAX_FORM_CHARS);
  const lemma = stringOr(raw.lemma, MAX_FORM_CHARS);
  const lang = stringOr(raw.lang, 8);
  const pos = stringOr(raw.pos, 24);
  if (word === null || lemma === null || lang === null || pos === null) return null;

  const source = raw.source;
  if (source === null || typeof source !== 'object') return null;
  const sourceName = stringOr((source as Record<string, unknown>).name, 32);
  const sourceUrl = stringOr((source as Record<string, unknown>).url, 300);
  if (sourceName === null || sourceUrl === null) return null;

  const labels = Array.isArray(raw.labels)
    ? raw.labels
        .map((label) => stringOr(label, MAX_FORM_CHARS))
        .filter((label): label is string => label !== null)
        .slice(0, 8)
    : [];

  const senses: DictionarySense[] = [];
  if (Array.isArray(raw.senses)) {
    for (const candidate of raw.senses.slice(0, MAX_SENSES)) {
      if (candidate === null || typeof candidate !== 'object') continue;
      const sense = candidate as Record<string, unknown>;
      const gloss = stringOr(sense.gloss, MAX_GLOSS_CHARS);
      if (gloss === null) continue;
      const example = stringOr(sense.example, MAX_GLOSS_CHARS);
      const tags = Array.isArray(sense.tags)
        ? sense.tags
            .map((tag) => stringOr(tag, 24))
            .filter((tag): tag is string => tag !== null)
            .slice(0, 6)
        : undefined;
      senses.push({
        gloss,
        ...(tags === undefined || tags.length === 0 ? {} : { tags }),
        ...(example === null ? {} : { example }),
      });
    }
  }

  const sections = parseSections(raw.sections);
  const headword = stringOr(raw.headword, 120);
  const resolvedFrom = stringOr(raw.resolvedFrom, MAX_FORM_CHARS);

  const entry: DictionaryEntry = {
    word,
    lemma,
    lang,
    pos,
    ...(headword === null ? {} : { headword }),
    labels,
    senses,
    sections,
    ...(resolvedFrom === null ? {} : { resolvedFrom }),
    source: { name: sourceName, url: sourceUrl },
  };

  // The byte cap is the session's real defence, so it is checked on the parsed
  // shape rather than on whatever the caller happened to send.
  if (JSON.stringify(entry).length > MAX_ENTRY_BYTES) return null;
  return entry;
}

function parseSections(value: unknown): FormSection[] {
  if (!Array.isArray(value)) return [];
  const sections: FormSection[] = [];
  for (const candidate of value.slice(0, MAX_SECTIONS)) {
    if (candidate === null || typeof candidate !== 'object') continue;
    const raw = candidate as Record<string, unknown>;
    const key = stringOr(raw.key, 60);
    if (key === null) continue;
    const label = stringOr(raw.label, 60) ?? key;
    const columnLabels = Array.isArray(raw.columnLabels)
      ? raw.columnLabels
          .map((entry) => (typeof entry === 'string' ? entry.slice(0, 40) : ''))
          .slice(0, MAX_SECTION_COLUMNS)
      : [];
    const width = columnLabels.length === 0 ? 1 : columnLabels.length;
    const rows: FormRow[] = [];
    if (Array.isArray(raw.rows)) {
      for (const rowCandidate of raw.rows.slice(0, MAX_SECTION_ROWS)) {
        if (rowCandidate === null || typeof rowCandidate !== 'object') continue;
        const row = rowCandidate as Record<string, unknown>;
        if (!Array.isArray(row.cells)) continue;
        const cells = row.cells
          .slice(0, width)
          .map((cell) => (typeof cell === 'string' ? cell.slice(0, MAX_FORM_CHARS * 3) : null));
        while (cells.length < width) cells.push(null);
        rows.push({
          label: typeof row.label === 'string' ? row.label.slice(0, 40) : '',
          cells,
        });
      }
    }
    if (rows.length === 0) continue;
    sections.push({ key, label, columnLabels, rows });
  }
  return sections;
}
