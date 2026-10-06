import { useState } from 'react';
import { deckAspectRatio } from '@openroom/schema';
import {
  ClockPill,
  MeaningCard,
  ListeningAudience,
  StepLayout,
  type SlideStep,
} from '@openroom/slides';
import type {
  ParticipantSnapshot,
  SessionMarkView,
  SessionMeaningView,
} from '@openroom/sdk';
import { InkLayer, tappedWord } from './ink';

/**
 * Current outline step — same skeleton and skin as stage / host stage-mirror.
 *
 * `@openroom/slides` owns structure; `outline-step.css` owns composition. Word
 * tokens stay on for tutor ink (circle / meaning) to land on the same indices.
 */
export function StepView({
  step,
  design,
  lane,
  hiddenParts,
  marks,
  meaning,
  dictionary,
  clock,
  join,
  onLookUp,
}: {
  step: NonNullable<ParticipantSnapshot['outline']>['currentStep'];
  design?: NonNullable<ParticipantSnapshot['outline']>['design'];
  lane?: 0 | 1;
  hiddenParts?: string[];
  marks?: SessionMarkView[];
  meaning?: SessionMeaningView;
  dictionary?: ParticipantSnapshot['dictionary'];
  clock?: ParticipantSnapshot['clock'];
  join?: { url: string; code: string };
  /** Absent in a session where the learner has no lookup (not identified). */
  onLookUp?: (word: string) => void;
}) {
  const [reading, setReading] = useState(false);
  // Lane is a fact about this step, not the session: only label when cards split.
  const laneNamed =
    lane !== undefined && step.kind === 'cards' && step.items.some((item) => item.lane !== undefined);

  // Interaction steps never land here (Body only renders content steps while
  // no poll is open). StepLayout would return null for them either way.
  if (step.kind === 'interaction') {
    return (
      <section className="waiting" aria-live="polite" />
    );
  }

  const showPill =
    clock !== undefined && (clock.placement === 'corner' || clock.stepId !== step.id);

  return (
    <div className="learner-slide" data-reading={reading ? "true" : "false"} aria-live="polite" style={{ "--slide-aspect": deckAspectRatio(design?.aspectRatio ?? "16:9") } as React.CSSProperties}>
      <div className="learner-slide__view" role="group" aria-label="Content view">
        <button type="button" aria-pressed={!reading} onClick={() => setReading(false)}>Slide</button>
        <button type="button" aria-pressed={reading} onClick={() => setReading(true)}>Reading</button>
      </div>
      {laneNamed ? <p className="step__lane">{lane === 0 ? 'Partner A' : 'Partner B'}</p> : null}
      {/* Ink is a sibling of the step, not the page shell: token marks re-measure
          against this plate so underlines sit under the words, not in the gutter. */}
      <div
        className="learner-slide__plate"
        onClick={
          onLookUp === undefined
            ? undefined
            : (event) => {
                const word = tappedWord(event);
                if (word !== null) onLookUp(word);
              }
        }
      >
        <ListeningAudience.Provider value="participant">
          <StepLayout key={step.id} step={step as SlideStep} design={design} hiddenParts={hiddenParts ? new Set(hiddenParts) : undefined} tokens clock={clock} join={join} />
        </ListeningAudience.Provider>
        <InkLayer marks={reading ? marks?.filter((mark) => mark.kind !== 'pen') : marks} />
        {showPill ? <ClockPill clock={clock} /> : null}
        <PushedMeaning meaning={meaning} dictionary={dictionary} />
      </div>
    </div>
  );
}

/**
 * The card the tutor put up, over this learner's slide on a scrim — the same
 * card the wall shows, minus every act. It replaces the old under-slide forms
 * table and the small gloss over the word.
 */
function PushedMeaning({
  meaning,
  dictionary,
}: {
  meaning?: SessionMeaningView;
  dictionary?: ParticipantSnapshot['dictionary'];
}) {
  const text = meaning?.shown === true ? meaning.text : undefined;
  if (dictionary === undefined && text === undefined) return null;
  return (
    <div className="meaning-layer">
      <div className="meaning-layer__scrim" aria-hidden="true" />
      <MeaningCard
        entry={dictionary?.entry}
        meaning={text}
        word={meaning?.word}
        footer={`From the tutor${
          dictionary === undefined ? '' : ` · ${dictionary.entry.source.name}`
        }`}
      />
    </div>
  );
}
