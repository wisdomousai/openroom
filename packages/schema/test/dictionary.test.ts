import { describe, expect, it } from 'vitest';

import {
  buildSections,
  cleanForms,
  headwordLabels,
  MAX_ENTRY_BYTES,
  parseDictionaryEntry,
  type DictionaryEntry,
  type FormSection,
} from '../src/dictionary.js';
import fixtures from './fixtures/wiktextract.json' with { type: 'json' };

/*
 * The fixtures are real upstream rows, trimmed to the fields the grouping
 * reads. They are the contract: a German verb, noun and adjective, a
 * preposition with almost no table, and an inflected form that only points at
 * its lemma. Between them they cover every branch worth defending.
 */
const RAW = fixtures as Record<
  string,
  { word: string; pos: string; forms: unknown[]; senses: { glosses?: string[]; form_of?: { word: string }[] }[] }
>;

function sectionsFor(name: string): FormSection[] {
  return buildSections(cleanForms(RAW[name]!.forms).forms);
}

function section(name: string, key: string): FormSection {
  const found = sectionsFor(name).find((entry) => entry.key === key);
  expect(found, `${name} has no section '${key}'`).toBeDefined();
  return found!;
}

/** A section's grid as `rowLabel → cells`, which is what a reader sees. */
function grid(entry: FormSection): Record<string, (string | null)[]> {
  return Object.fromEntries(entry.rows.map((row) => [row.label, row.cells]));
}

describe('cleanForms', () => {
  it('lifts the verb class and auxiliary out of the table', () => {
    // Upstream ships these as form rows tagged `class` / `auxiliary`. They are
    // grammar a tutor wants beside the table, but they are not inflected forms.
    const { labels, forms } = cleanForms(RAW.gehen!.forms);
    expect(labels).toContain('aux: sein');
    expect(labels).toContain('7 strong');
    expect(forms.map((form) => form.form)).not.toContain('sein');
  });

  it('drops the rows that describe the table rather than the word', () => {
    const { forms } = cleanForms(RAW.gehen!.forms);
    const kept = forms.map((form) => form.form);
    expect(kept).not.toContain('de-conj'); // inflection-template
    expect(kept).not.toContain('strong'); // table-tags
  });

  it('keeps compound forms, which carry the tag that marks them multiword', () => {
    // `multiword-construction` is the single most common tag on a German verb
    // and marks the perfect and future — dropping those rows would lose the
    // tenses a class spends the most time on.
    const { forms } = cleanForms(RAW.gehen!.forms);
    expect(forms.map((form) => form.form)).toContain('bin gegangen');
  });

  it('refuses a forms list that is not a list', () => {
    expect(cleanForms(undefined)).toEqual({ labels: [], forms: [] });
    expect(cleanForms('nope')).toEqual({ labels: [], forms: [] });
  });
});

describe('buildSections — one path for every part of speech', () => {
  it('gives a verb its conjugation, person by number', () => {
    expect(grid(section('gehen', 'indicative-present'))).toEqual({
      '1st person': ['gehe', 'gehen'],
      '2nd person': ['gehst', 'geht'],
      '3rd person': ['geht', 'gehen'],
    });
    expect(section('gehen', 'indicative-present').columnLabels).toEqual(['singular', 'plural']);
  });

  it('keeps the imperative, which a lower section cap used to swallow', () => {
    // No person row: an imperative is second-person throughout, so person has
    // one value and earns neither a row nor a column.
    const imperative = section('gehen', 'imperative');
    expect(imperative.columnLabels).toEqual(['singular', 'plural']);
    expect(imperative.rows).toEqual([{ label: '', cells: ['geh, gehe', 'geht'] }]);
  });

  it('gives a noun one case grid, plural included', () => {
    // The plural forms carry `definite`; treating that as a section tag split
    // them into a block of their own and left the plural column empty.
    const sections = sectionsFor('Haus');
    expect(sections).toHaveLength(1);
    expect(grid(sections[0]!)).toEqual({
      nominative: ['Haus', 'Häuser'],
      genitive: ['Hauses', 'Häuser'],
      dative: ['Haus, Hause', 'Häusern'],
      accusative: ['Haus', 'Häuser'],
    });
  });

  it('gives an adjective a block per declension and degree', () => {
    const keys = sectionsFor('schoen').map((entry) => entry.key);
    for (const key of ['strong', 'weak', 'mixed', 'predicative']) {
      expect(keys).toContain(key);
      expect(keys).toContain(`${key}-comparative`);
      expect(keys).toContain(`${key}-superlative`);
    }
    expect(section('schoen', 'strong').columnLabels).toEqual(['singular', 'plural']);
    expect(grid(section('schoen', 'strong')).nominative).toEqual([
      'schöner, schöne, schönes',
      'schöne',
    ]);
  });

  it('puts the plain forms of an adjective ahead of its comparative', () => {
    // Positive carries no degree tag at all, so ranking degree above declension
    // sorted every plain form behind every comparative one.
    const keys = sectionsFor('schoen').map((entry) => entry.key);
    expect(keys.indexOf('strong')).toBeLessThan(keys.indexOf('strong-comparative'));
    expect(keys.indexOf('strong-comparative')).toBeLessThan(keys.indexOf('strong-superlative'));
  });

  it('leaves a preposition almost bare rather than inventing a table', () => {
    const sections = sectionsFor('mit');
    expect(sections.every((entry) => entry.rows.length <= 2)).toBe(true);
  });

  it('gives an inflected form no table of its own', () => {
    expect(sectionsFor('hablo')).toEqual([]);
    expect(RAW.hablo!.senses[0]?.form_of?.[0]?.word).toBe('hablar');
  });
});

describe('buildSections — labels', () => {
  it('drops a tag that a more specific one already implies', () => {
    // Upstream marks the compound future as both `future` and `future-i`.
    expect(section('gehen', 'indicative-future-i').label).toBe('Indicative future I');
  });

  it('reads degree first even though it sorts last', () => {
    expect(section('schoen', 'strong-comparative').label).toBe('Comparative strong');
  });
});

describe('buildSections — determinism', () => {
  it('renders the same entry the same way twice', () => {
    // A table whose rows move between lookups is unreadable in front of a class.
    for (const name of Object.keys(RAW)) {
      expect(JSON.stringify(sectionsFor(name))).toBe(JSON.stringify(sectionsFor(name)));
    }
  });
});

const VALID: DictionaryEntry = {
  word: 'gehst',
  lemma: 'gehen',
  lang: 'de',
  pos: 'verb',
  labels: ['aux: sein'],
  senses: [{ gloss: 'to go' }],
  sections: [{ key: 'base', label: 'Forms', columnLabels: [], rows: [{ label: '', cells: ['gehe'] }] }],
  resolvedFrom: 'gehst',
  source: { name: 'kaikki', url: 'https://example.invalid/gehen' },
};

describe('parseDictionaryEntry', () => {
  it('accepts a well-formed entry unchanged', () => {
    expect(parseDictionaryEntry(structuredClone(VALID))).toEqual(VALID);
  });

  it('refuses an entry missing an identifying field', () => {
    for (const field of ['word', 'lemma', 'lang', 'pos', 'source'] as const) {
      const broken: Record<string, unknown> = structuredClone(VALID);
      delete broken[field];
      expect(parseDictionaryEntry(broken), field).toBeNull();
    }
    expect(parseDictionaryEntry(null)).toBeNull();
    expect(parseDictionaryEntry('gehen')).toBeNull();
  });

  it('refuses an entry too large to sit in session state', () => {
    // The entry rides in every snapshot to every phone once it is projected,
    // so the cap is the session's defence and a host bundle is not a trust
    // boundary. A real full entry is about 5 KB and must still pass.
    const huge = structuredClone(VALID);
    huge.sections = Array.from({ length: 20 }, (_unused, index) => ({
      key: `k${index}`,
      label: 'x'.repeat(60),
      columnLabels: ['a', 'b', 'c', 'd'],
      rows: Array.from({ length: 12 }, () => ({ label: 'y'.repeat(40), cells: ['z'.repeat(120), null, null, null] })),
    }));
    expect(parseDictionaryEntry(huge)).toBeNull();
  });

  it('lets a real full entry through the byte cap', () => {
    const full = structuredClone(VALID);
    full.sections = sectionsFor('gehen');
    const parsed = parseDictionaryEntry(full);
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed).length).toBeLessThan(MAX_ENTRY_BYTES);
  });

  it('pads a short row so every row matches the column count', () => {
    const ragged = structuredClone(VALID) as unknown as Record<string, unknown>;
    ragged.sections = [
      { key: 'base', label: 'Forms', columnLabels: ['singular', 'plural'], rows: [{ label: 'nom', cells: ['Haus'] }] },
    ];
    const parsed = parseDictionaryEntry(ragged);
    expect(parsed?.sections[0]?.rows[0]?.cells).toEqual(['Haus', null]);
  });
});

describe('headwordLabels', () => {
  it('lifts a noun’s gender, which never appears on a form row', () => {
    // The case that made this necessary: a verb's class and auxiliary arrive as
    // meta *forms* and `cleanForms` catches them; a noun's gender does not.
    const senses = [{ tags: ['neuter', 'strong'] }, { tags: ['neuter', 'strong'] }];
    expect(headwordLabels(senses)).toEqual(['neuter', 'strong']);
  });

  it('ignores register, dialect and anything else a sense carries', () => {
    // A table captioned "colloquial" tells the class the wrong thing.
    const senses = [{ tags: ['colloquial', 'dated', 'Switzerland', 'intransitive'] }];
    expect(headwordLabels(senses)).toEqual(['intransitive']);
  });

  it('does not repeat what a form row already said', () => {
    // German strong verbs arrive with a class row reading '7 strong'; adding a
    // bare 'strong' beside it says the same thing twice.
    expect(headwordLabels([{ tags: ['class-7', 'strong', 'intransitive'] }], ['7 strong'])).toEqual([
      'intransitive',
    ]);
    expect(headwordLabels([{ tags: ['sein'] }], ['aux: sein'])).toEqual([]);
  });

  it('survives senses that carry no tags at all', () => {
    expect(headwordLabels([{ gloss: 'x' }, null, 'nope'])).toEqual([]);
    expect(headwordLabels(undefined)).toEqual([]);
  });
});
