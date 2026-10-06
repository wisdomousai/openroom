/**
 * Normalize a short-text answer for equality checks against `correctAnswers`.
 */

export type AccentPolicy = 'require' | 'ignore';
export type PunctuationPolicy = 'keep' | 'strip';

export interface TextMatchOptions {
  /** BCP 47 locale used for case-folding. Default en-US. */
  locale?: string;
  /** require = accents are significant; ignore = strip combining marks. */
  accents?: AccentPolicy;
  /** strip = drop punctuation and apostrophes before compare. */
  punctuation?: PunctuationPolicy;
}

const DEFAULT_LOCALE = 'en-US';

function foldCase(text: string, locale: string): string {
  try {
    return text.toLocaleLowerCase(locale);
  } catch {
    return text.toLocaleLowerCase(DEFAULT_LOCALE);
  }
}

function stripCombiningMarks(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

function stripPunctuation(text: string): string {
  return text.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ');
}

/**
 * Trim + locale case-fold, then optional accent / punctuation folding.
 */
export function normalizeTextAnswer(text: string, options: TextMatchOptions = {}): string {
  const locale = options.locale?.trim() || DEFAULT_LOCALE;
  let next = foldCase(text.trim().normalize('NFC'), locale);
  if (options.accents === 'ignore') next = stripCombiningMarks(next);
  if (options.punctuation === 'strip') next = stripPunctuation(next);
  return next.trim();
}

/**
 * True when `text` matches any entry in `correctAnswers` after normalization.
 */
export function textAnswerMatches(
  text: string,
  correctAnswers: readonly string[] | undefined,
  options: TextMatchOptions = {},
): boolean {
  if (correctAnswers === undefined || correctAnswers.length === 0) return false;
  const needle = normalizeTextAnswer(text, options);
  if (needle === '') return false;
  return correctAnswers.some((answer) => normalizeTextAnswer(answer, options) === needle);
}
