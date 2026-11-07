/** Characters a phone keyboard hides behind a long press, per target language. */
const ACCENT_KEYS: Record<string, readonly string[]> = {
  fr: ['à', 'â', 'ç', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'ù', 'û', 'ü', 'œ'],
  de: ['ä', 'ö', 'ü', 'ß'],
  es: ['á', 'é', 'í', 'ñ', 'ó', 'ú', 'ü', '¿', '¡'],
  it: ['à', 'è', 'é', 'ì', 'ò', 'ù'],
  pt: ['á', 'â', 'ã', 'à', 'ç', 'é', 'ê', 'í', 'ó', 'ô', 'õ', 'ú'],
};

/** The accent keys for a BCP 47 locale's language; none when the language has no row or is unknown. */
export function accentKeysFor(locale: string | undefined): readonly string[] {
  if (!locale) return [];
  return ACCENT_KEYS[locale.split('-')[0]!.toLowerCase()] ?? [];
}

/** Replace the selection with one character. Null when the field is already full. */
export function insertCharacter(value: string, start: number | null, end: number | null, character: string, maxLength: number): { value: string; caret: number } | null {
  const from = Math.min(start ?? value.length, value.length);
  const to = Math.max(from, Math.min(end ?? from, value.length));
  const next = value.slice(0, from) + character + value.slice(to);
  if (maxLength > 0 && next.length > maxLength) return null;
  return { value: next, caret: from + character.length };
}
