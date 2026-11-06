import { useRef } from 'react';
import type { SessionMarkView } from '@openroom/sdk';
import { InkMarks, useTokenBoxes } from '@openroom/slides';

/** Learners paint the tutor's marks in their own layout; they never capture ink. */
export function InkLayer({ marks }: { marks?: SessionMarkView[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxes = useTokenBoxes(rootRef, marks);
  return <div ref={rootRef} className="learner-ink" aria-hidden="true"><InkMarks marks={marks} boxes={boxes} /></div>;
}

/**
 * The word a tap landed on, read off the same `[data-part][data-token]`
 * attributes the ink measures.
 *
 * Deliberately a separate handler rather than a hook into `InkLayer`: the ink
 * path stays a pure paint path, and "there is no capture here, only paint"
 * stays true of it.
 */
export function tappedWord(
  event: { target: EventTarget | null },
): { word: string; token: Element } | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const token = target.closest('[data-token]');
  if (token === null) return null;
  const word = lookupWord(token.textContent ?? '');
  return word === null ? null : { word, token };
}

/**
 * A token as the dictionary takes it: the punctuation a word carries in running
 * text ("passé,", "(vraiment)", "peut-être;") comes off both ends. Inner
 * apostrophes and hyphens stay. What is left must be a word the lookup route
 * accepts, so "1er" or "19h30" is not sent as "er" or "h".
 */
const PUNCTUATION_EDGES = /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu;
const LOOKUP_WORD = /^[\p{L}\p{M}][\p{L}\p{M}\p{Pd}'’]{0,39}$/u;

export function lookupWord(text: string): string | null {
  const word = text.replace(PUNCTUATION_EDGES, '');
  return LOOKUP_WORD.test(word) ? word : null;
}
