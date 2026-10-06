import { useMemo, type CSSProperties } from 'react';
import { StepLayout, type SlideStep } from '@openroom/slides';
import {
  fillTheGapsBankWords,
  deckAspectRatio,
  resolveSlideDesign,
  projectOutlineStep,
  type FillTheGapsInteraction,
  type Outline,
  type OutlineStep,
} from '@openroom/schema';

import { optionsFor, orderedBlocks, promptFontFor, promptFor, promptSpansFor } from '../pages/deck-edit/outline-edit';
import '@openroom/stage-src/styles.css';

/** Linear presentation order excludes on-demand breakout slides. */
export function presentableSteps(outline: Outline): OutlineStep[] {
  return orderedBlocks(outline).map((block) => block.step);
}

/**
 * One step on the stage, at the cursor's reveal position.
 *
 * Exported for tests: it is the whole picture minus the portal and the keymap,
 * and it renders without a DOM.
 */
export function PresentStage({
  outline,
  step,
  groups,
  shown,
  listening,
}: {
  outline: Outline;
  step: OutlineStep;
  /** Resolved reveal groups of `step`, in play order. */
  groups: string[][];
  /** How many of those groups are showing. */
  shown: number;
  listening?: { mode: 'room' | 'individual'; transcriptShown: boolean };
}) {
  const hiddenParts = useMemo(() => new Set(groups.slice(shown).flat()), [groups, shown]);
  const fillTheGapsIx =
    step.kind === 'interaction'
      ? outline.interactions.find(
          (item): item is FillTheGapsInteraction =>
            item.id === step.interactionId && item.type === 'fill-the-gaps',
        )
      : undefined;

  return (
    <div className="min-h-0 flex-1">
      {/* The projector's own chrome classes: no rail, never idle — this is a
          content step, which is the one case the stage draws without one. */}
      <div className="stage stage--embedded stage--no-rail" data-idle="false" data-rail="false"
        style={{ '--slide-aspect': deckAspectRatio(outline.design?.aspectRatio ?? '16:9') } as CSSProperties}>
        <div className="stage__grid">
          <div className="stage__main">
            <StepLayout
              fit
              design={resolveSlideDesign(outline.design, step.design)}
              step={projectOutlineStep(step, listening) as SlideStep}
              options={optionsFor(outline, step)}
              prompt={promptFor(outline, step)}
              promptSpans={promptSpansFor(outline, step)}
              promptFont={promptFontFor(outline, step)}
              gaps={fillTheGapsIx?.gaps}
              bankWords={
                fillTheGapsIx?.display === 'bank' ? fillTheGapsBankWords(fillTheGapsIx) : undefined
              }
              bankSeed={fillTheGapsIx?.id}
              renderInteraction
              runTimer
              hiddenParts={hiddenParts}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
