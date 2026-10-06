/**
 * The pushed meaning card: what a lookup looks like once the tutor puts it on
 * someone else's screen.
 *
 * Shared because the wall and the learner's browser show the same card — the
 * tutor's own console shows the interactive breakout instead. It is the same
 * card minus every act: no tabs, no push, no close. Structure only; the
 * `meaning-card*` classes are styled by `stage-ui.css` on the wall and by the
 * participant sheet on a learner's screen.
 *
 * Renders the meaning and optional forms from one atomic publication.
 * Either may be absent — a typed meaning
 * has no entry, a monolingual push has no meaning line.
 */
import type { ReactNode } from 'react';
import type { DictionaryEntry } from '@openroom/schema';

import { DictionarySection } from './DictionaryTable';

export interface MeaningCardProps {
  /** The projected entry, when the push carried one. */
  entry?: DictionaryEntry;
  /** The published meaning text, when the push carried one. */
  meaning?: string;
  /** The word as it stands on the slide; the entry's own word wins over it. */
  word?: string;
  /**
   * Surface-specific attribution line (“Your tutor put this up · Wiktionary”).
   * Null for a typed-only push — no source line, because there is no source.
   */
  footer: ReactNode;
}

export function MeaningCard({ entry, meaning, word, footer }: MeaningCardProps) {
  const headword = entry?.lemma ?? word;
  const from = entry !== undefined && entry.word !== entry.lemma ? entry.word : undefined;
  return (
    <div className="meaning-card" role="dialog" aria-label={`Meaning: ${headword ?? meaning ?? ''}`}>
      <div className="meaning-card__head">
        {headword === undefined ? null : <span className="meaning-card__word">{headword}</span>}
        {from === undefined ? null : (
          <span className="meaning-card__from">
            <span aria-hidden="true">←</span> {from}
          </span>
        )}
        {entry === undefined ? null : (
          <span className="meaning-card__facts">
            <span className="meaning-card__pos">{entry.pos}</span>
            {entry.labels.map((label) => (
              <span key={label} className="meaning-card__label">
                {label}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="meaning-card__body">
        {meaning === undefined ? null : <p className="meaning-card__meaning">{meaning}</p>}
        {meaning === undefined && entry !== undefined && entry.senses.length > 0 ? (
          <ol className="meaning-card__senses">
            {entry.senses.map((sense) => (
              <li key={sense.gloss}>
                {sense.gloss}
                {sense.example === undefined ? null : (
                  <span className="meaning-card__example">{sense.example}</span>
                )}
              </li>
            ))}
          </ol>
        ) : null}
        {entry?.sections.map((section) => (
          <DictionarySection key={section.key} section={section} highlight={entry.word} />
        ))}
      </div>
      {/* Wiktionary is CC BY-SA: attribution is part of the artifact. */}
      {footer == null ? null : <div className="meaning-card__foot">{footer}</div>}
    </div>
  );
}
