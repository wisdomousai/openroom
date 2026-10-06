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
export function tappedWord(event: { target: EventTarget | null }): string | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const token = target.closest('[data-token]');
  if (token === null) return null;
  const text = (token.textContent ?? '').trim();
  return text === '' ? null : text;
}
