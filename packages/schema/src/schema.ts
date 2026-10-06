import sessionSchemaJson from '../schema/session.schema.json' with { type: 'json' };
import type { Display, InteractionType } from './types.js';

/**
 * Shared interaction definitions for Outline v1 (draft 2020-12), also available
 * as a file at `@openroom/schema/schema/session.schema.json` for non-JS consumers.
 */
export const sessionSchema: Record<string, unknown> = sessionSchemaJson as Record<
  string,
  unknown
>;

export const SESSION_SCHEMA_ID = 'https://openroom.app/schema/session.schema.json';

/** Allowed display styles per interaction type. The FIRST entry is the default. */
export const DISPLAY_STYLES: Record<InteractionType, readonly Display[]> = {
  choice: ['bars', 'columns', 'donut', 'pie', 'radial', 'emoji-pulse', 'number', 'tally', 'emoji', 'cards'],
  scale: ['dots', 'gauge', 'bars', 'scale'],
  numeric: ['histogram', 'number'],
  text: ['list', 'word-cloud', 'wordcloud', 'cards'],
  qna: ['list', 'cards'],
  ranking: ['ordered-bars', 'sentence', 'rank'],
  'fill-the-gaps': ['gaps', 'bank', 'choices'],
  match: ['pairs'],
};

/**
 * Displays a picker may offer for this interaction type.
 * Ill-fitting types are absent, not disabled — a word cloud needs open text,
 * a scale-with-mean needs a scale. Same table the validator uses.
 */
export function displaysFor(type: InteractionType): readonly Display[] {
  return DISPLAY_STYLES[type];
}

export function defaultDisplay(type: InteractionType): Display {
  const styles = displaysFor(type);
  // Every type has at least one style; the non-null assertion is safe by construction.
  return styles[0] as Display;
}

/** Choice interactions must have between MIN and MAX options (inclusive). */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;

/** Ranking interactions must have between MIN and MAX options (inclusive). */
export const MIN_RANKING_OPTIONS = 2;
export const MAX_RANKING_OPTIONS = 6;

/** Scale interactions must satisfy MIN_SPAN <= (max - min) <= MAX_SPAN. */
export const MIN_SCALE_SPAN = 2;
export const MAX_SCALE_SPAN = 10;

/** Text answer length default and hard cap. */
export const DEFAULT_TEXT_MAX_LENGTH = 200;
export const TEXT_MAX_LENGTH_CAP = 500;

/** Max accepted short-text answers on a scored `text` interaction. */
export const MAX_CORRECT_ANSWERS = 20;

/** FillTheGaps interactions must have between MIN and MAX gaps (inclusive). */
export const MIN_FILL_THE_GAPS_GAPS = 1;
export const MAX_FILL_THE_GAPS_GAPS = 8;
