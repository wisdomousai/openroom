import { useEffect, useRef, useState } from 'react';
import { type MatchInteraction, type OutlineStep } from '@openroom/schema';

import { Input } from '@openroom/ui/components/input';
import { cn } from '@openroom/ui/utils';
import { LAYOUT_WORDS, LayoutThumb } from '../LayoutThumb';
import { stepMedia } from '../outline-edit';
import type { PropertiesPanelProps } from './shared';
import { Section } from './shared';
import { TimingSection, TimerAuthoring } from './timing';
import { PictureSection } from './picture';
import { AudioSection } from './audio';
import { ElementSection } from './elements';
import { PartExtras } from './part-extras';
import { RevealControls } from './reveal';
import { layoutChoicesFor, paneSections } from './applicability';

export function DesignState(props: PropertiesPanelProps & { step: OutlineStep }) {
  const { step, groups, partKey } = props;
  const interaction = step.kind === 'interaction' ? props.outline.interactions.find((item) => item.id === step.interactionId) : undefined;
  const sections = paneSections({ step, partKey, groups });
  const allowed = layoutChoicesFor(step.kind);
  const media = stepMedia(step);
  const revealRef = useRef<HTMLElement>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (props.revealFocus === 0) return;
    revealRef.current?.scrollIntoView({ block: 'nearest' });
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(timer);
  }, [props.revealFocus]);

  if (sections.join) {
    return (
      <Section title="Join the session">
        <p className="text-secondary text-muted-foreground">
          QR code appears when the session starts.
        </p>
      </Section>
    );
  }

  return (
    <>
      {interaction && interaction.type !== 'qna' && props.onInteraction ? (
        <Section title="Responses">
          <div className="flex gap-2" role="group" aria-label="Response mode">
            {(['individual', 'group'] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={(interaction.responseMode ?? 'individual') === mode}
                className="rounded-md border border-input px-3 py-2 text-sm aria-pressed:bg-accent"
                onClick={() => props.onInteraction?.({ ...interaction, responseMode: mode })}>
                {mode === 'group' ? 'One per group' : 'Individual'}
              </button>
            ))}
          </div>
          <p className="text-caption text-muted-foreground">{interaction.responseMode === 'group'
            ? 'Assign groups and a spokesperson during the live session.'
            : 'Each participant sends their own answer.'}</p>
        </Section>
      ) : null}
      {interaction?.type === 'match' && props.onMatchAnswer ? (
        <MatchPairs interaction={interaction} onMatchAnswer={props.onMatchAnswer} />
      ) : null}
      {sections.layout ? (
        <Section title="Layout" target="layout">
          <div className="grid grid-cols-3 gap-2">
            {allowed.map((layout) => {
              const active = (step.layout ?? allowed[0]) === layout;
              return (
                <button
                  key={layout}
                  type="button"
                  title={LAYOUT_WORDS[layout]}
                  aria-label={LAYOUT_WORDS[layout]}
                  aria-pressed={active}
                  onClick={() => props.onLayout(layout)}
                  className={cn(
                    'relative aspect-video overflow-hidden rounded-md bg-card',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    active
                      ? 'border-2 border-primary'
                      : 'border border-border hover:border-primary',
                  )}
                >
                  <LayoutThumb layout={layout} className="h-full" />
                </button>
              );
            })}
          </div>
          <p className="text-caption text-muted-foreground">
            Choose how the slide is arranged.
          </p>
        </Section>
      ) : null}

      {sections.timing ? (
        <TimingSection
          step={step}
          onMinutes={props.onMinutes}
          onDurationSeconds={props.onDurationSeconds}
        />
      ) : null}

      {sections.timerAuthoring && step.kind === 'timer' ? (
        <TimerAuthoring
          step={step}
          onTimerStyle={props.onTimerStyle}
          onTimerPlacement={props.onTimerPlacement}
          onTimerPersist={props.onTimerPersist}
          onPartText={props.onPartText}
        />
      ) : null}

      {media?.type === 'audio' && props.onMediaChange ? (
        <AudioSection key={`${step.id}:${media.url}`} media={media} spaceId={props.spaceId} onChange={props.onMediaChange} onEmbedded={props.onEmbeddedResource} />
      ) : sections.picture && media !== undefined ? (
        <PictureSection
          step={step}
          media={media}
          onOpenPicture={() => props.onOpenPicture({ kind: 'media' })}
          onRemovePicture={props.onRemovePicture}
          onMediaFocal={props.onMediaFocal}
          onMediaPlace={props.onMediaPlace}
          onMediaSize={props.onMediaSize}
          onPartText={props.onPartText}
          onMediaChange={props.onMediaChange}
        />
      ) : null}

      {sections.element && partKey !== null ? (
        <ElementSection
          step={step}
          partKey={partKey}
          onPartText={props.onPartText}
          onRemoveElement={props.onRemoveElement}
          onEditHtml={props.onEditHtml}
          onEditMarkdown={props.onEditMarkdown}
          onEditIframe={props.onEditIframe}
          onEditPdf={props.onEditPdf}
          onOpenPicture={(elementId) => props.onOpenPicture({ kind: 'element', elementId })}
          onElementPicture={props.onElementPicture}
        />
      ) : null}

      {sections.part && partKey !== null ? (
        <PartExtras {...props} step={step} partKey={partKey} />
      ) : null}

      {sections.reveal ? (
        <Section title="Reveal" ref={revealRef} flash={flash}>
          <RevealControls {...props} step={step} />
        </Section>
      ) : null}
    </>
  );
}

/**
 * A match's pairs: each left item (edited on the slide) with the answer it is
 * paired with. The slide draws the left column only, as the stage does, so
 * this is where the right column a student matches against is read and fixed.
 */
function MatchPairs({
  interaction,
  onMatchAnswer,
}: {
  interaction: MatchInteraction;
  onMatchAnswer: (index: number, text: string) => void;
}) {
  return (
    <Section title="Pairs">
      <ul className="grid gap-3">
        {interaction.left.map((left, index) => {
          const answer = interaction.right.find((right) => right.id === interaction.correct[left.id]);
          return (
            <li key={left.id} className="grid gap-1">
              <span className="text-caption text-muted-foreground [overflow-wrap:anywhere]">
                {left.label === '' ? `Item ${String(index + 1)}` : left.label}
              </span>
              <CommitInput
                ariaLabel={`Answer paired with ${left.label === '' ? `item ${String(index + 1)}` : left.label}`}
                value={answer?.label ?? ''}
                onCommit={(text) => onMatchAnswer(index, text)}
              />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function CommitInput({ ariaLabel, value, onCommit }: { ariaLabel: string; value: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      aria-label={ariaLabel}
      value={draft ?? value}
      placeholder="Answer"
      onFocus={() => setDraft(value)}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}
