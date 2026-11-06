import { useEffect, useState } from 'react';
import { deckAspectRatio } from '@openroom/schema';
import {
  AudioPlayer,
  ClockPill,
  MeaningCard,
  StepLayout,
  type SlideStep,
} from '@openroom/slides';
import type {
  ParticipantSnapshot,
  SessionMarkView,
  SessionMeaningView,
} from '@openroom/sdk';
import { InkLayer, tappedWord } from './ink';

/** The learner's Slide or Reading choice; null until they pick one. */
export type ContentView = 'slide' | 'reading';

/**
 * List-heavy kinds whose projector type shrinks to 6-9 px on a phone. Below
 * 640 px they open in Reading until the learner picks a view (decision LD8).
 */
const DENSE_KINDS = new Set(['cards', 'steps', 'activity', 'debrief']);
const NARROW = '(max-width: 639px)';

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(NARROW).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(NARROW);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}

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
  view,
  onView,
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
  /** Kept by the live screen, so a question in between does not reset it. */
  view: ContentView | null;
  onView: (view: ContentView) => void;
  /** Absent in a session where the learner has no lookup (not identified). */
  onLookUp?: (word: string, token: Element) => void;
}) {
  const narrow = useNarrow();
  const reading = view === null ? narrow && DENSE_KINDS.has(step.kind) : view === 'reading';
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
  // The learner's own player sits under the plate, not in it: its controls and
  // error are phone-sized, and the scaled projector slide would clip them.
  const media = 'media' in step ? step.media : undefined;
  const player =
    media?.type === 'audio' &&
    media.listening?.mode === 'individual' &&
    media.url !== undefined &&
    media.url !== '' &&
    // A starter slide still waiting for its recording: the plate shows the placeholder.
    !media.url.includes('openroom-pending') &&
    hiddenParts?.includes('image') !== true
      ? media
      : undefined;

  return (
    <>
    <div className="learner-slide" data-reading={reading ? "true" : "false"} aria-live="polite" style={{ "--slide-aspect": deckAspectRatio(design?.aspectRatio ?? "16:9") } as React.CSSProperties}>
      <div className="learner-slide__view" role="group" aria-label="Content view">
        <button type="button" aria-pressed={!reading} onClick={() => onView('slide')}>Slide</button>
        <button type="button" aria-pressed={reading} onClick={() => onView('reading')}>Reading</button>
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
                const tapped = tappedWord(event);
                if (tapped !== null) onLookUp(tapped.word, tapped.token);
              }
        }
      >
        <StepLayout key={step.id} step={step as SlideStep} design={design} hiddenParts={hiddenParts ? new Set(hiddenParts) : undefined} tokens clock={clock} join={join} />
        <InkLayer marks={reading ? marks?.filter((mark) => mark.kind !== 'pen') : marks} />
        {showPill ? <ClockPill clock={clock} /> : null}
        <PushedMeaning meaning={meaning} dictionary={dictionary} />
      </div>
    </div>
    {/* Outside the slide box, so the letterboxed plate makes room for it. */}
    {player ? (
      <section className="learner-listening" aria-label="Your player">
        <AudioPlayer
          key={`${step.id}:${player.url}`}
          src={player.url!}
          label={player.alt}
          loadError="This audio could not be loaded. Check your connection, then tap Retry loading."
        />
      </section>
    ) : null}
    </>
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
