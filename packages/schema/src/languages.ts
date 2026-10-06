/**
 * The language pairs a tutoring space can be configured for.
 *
 * A pair is **taught** (the language being taught) plus **native** (the
 * language the student already has). The dictionary entry — part of speech and
 * the whole forms table — is always built from the taught language. The
 * *meaning* is a short sense written in the native one.
 *
 * ## Why this list is closed, and why it lives here
 *
 * The two halves come from different upstream sources, and neither covers
 * everything:
 *
 * - Forms come from the **English** Wiktionary extraction, which is by far the
 *   richest for inflection whatever the language (French `aller`: 63 forms
 *   there against 8 in the German edition).
 * - Meanings come from the **native language's own** Wiktionary edition, whose
 *   path segment names the taught language in that edition's words —
 *   `Französisch`, not `French`. Those names cannot be derived; they were read
 *   off each edition's index.
 *
 * Coverage is uneven, so a pair is listed only when the extraction is
 * substantial enough to be worth offering. Measured sizes are in the comment on
 * MEANING_EDITIONS. A pair that is absent here is reported to the caller as
 * unsupported rather than quietly answered in the wrong language — a Spanish
 * student handed an English sense has been given nothing.
 *
 * This table is shared on purpose: the space picker must offer exactly the
 * pairs the lookup can serve, so both read the same list.
 */

export interface LanguageChoice {
  code: string;
  /** For UI in English. */
  name: string;
  /** The language's own name, for the picker. */
  endonym: string;
}

/** Languages that can be taught: the English extraction covers all of these. */
export const TAUGHT_LANGUAGES: LanguageChoice[] = [
  { code: 'de', name: 'German', endonym: 'Deutsch' },
  { code: 'en', name: 'English', endonym: 'English' },
  { code: 'es', name: 'Spanish', endonym: 'Español' },
  { code: 'fr', name: 'French', endonym: 'Français' },
  { code: 'it', name: 'Italian', endonym: 'Italiano' },
  { code: 'nl', name: 'Dutch', endonym: 'Nederlands' },
  { code: 'pt', name: 'Portuguese', endonym: 'Português' },
];

/** The language segment of the English extraction, by taught code. */
export const DICTIONARY_ROOTS: Record<string, string> = {
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  nl: 'Dutch',
  pt: 'Portuguese',
};

/**
 * `native → taught → the taught language's name in the native edition`.
 *
 * Sizes of each extraction, measured against the live service, in MB:
 *
 *   de:  en 82.4 · it 27.3 · fr 24.8 · pt 9.0 · es 8.8 · nl 3.1
 *   fr:  de 1100 · it 1094 · pt 318 · es 257 · en 196 · nl 51.4
 *   es:  en 41.9 · fr 9.7 · pt 7.9 · it 7.6 · de 5.1 · nl 1.6 (dropped)
 *   it:  en 17.1 · fr 15.1 · de 7.8 · es 3.1 · nl 1.4 (dropped) · pt 0.8 (dropped)
 *
 * English is deliberately absent as a native language: the entry's own senses
 * are already English, so an English-speaking class needs no second fetch. See
 * `nativeNeedsEdition`.
 */
export const MEANING_EDITIONS: Record<string, Record<string, string>> = {
  de: {
    en: 'Englisch',
    es: 'Spanisch',
    fr: 'Französisch',
    it: 'Italienisch',
    nl: 'Niederländisch',
    pt: 'Portugiesisch',
  },
  fr: {
    de: 'Allemand',
    en: 'Anglais',
    es: 'Espagnol',
    it: 'Italien',
    nl: 'Néerlandais',
    pt: 'Portugais',
  },
  es: {
    de: 'Alemán',
    en: 'Inglés',
    fr: 'Francés',
    it: 'Italiano',
    pt: 'Portugués',
  },
  it: {
    de: 'Tedesco',
    en: 'Inglese',
    es: 'Spagnolo',
    fr: 'Francese',
  },
};

/** Languages a student can have as their own. English needs no edition. */
export const NATIVE_LANGUAGES: LanguageChoice[] = TAUGHT_LANGUAGES.filter(
  (language) => language.code === 'en' || language.code in MEANING_EDITIONS,
);

export function isTaughtLanguage(code: string): boolean {
  return code in DICTIONARY_ROOTS;
}

/**
 * True when the meaning has to come from a separate edition. False for English,
 * whose senses the entry already carries, and for a pair with the same language
 * on both sides (a monolingual session, where the definition is the meaning).
 */
export function nativeNeedsEdition(taught: string, native: string): boolean {
  return native !== 'en' && native !== taught;
}

/** The path segment naming `taught` inside `native`'s Wiktionary edition. */
export function meaningEdition(taught: string, native: string): string | null {
  return MEANING_EDITIONS[native]?.[taught] ?? null;
}

/**
 * Whether a space may be configured for this pair. The picker and the lookup
 * both ask this, so a configuration that cannot be served cannot be saved.
 */
export function isSupportedPair(taught: string, native: string): boolean {
  if (!isTaughtLanguage(taught) || !isTaughtLanguage(native)) return false;
  if (!nativeNeedsEdition(taught, native)) return true;
  return meaningEdition(taught, native) !== null;
}

/** Taught languages available to a student with this native language. */
export function taughtLanguagesFor(native: string): LanguageChoice[] {
  return TAUGHT_LANGUAGES.filter((language) => isSupportedPair(language.code, native));
}

/* -------------------------------------------------------- space settings */

/** The language pair a space is configured for, as stored in `spaces.settings`. */
export interface SpaceLanguages {
  taught: string;
  native: string;
}

