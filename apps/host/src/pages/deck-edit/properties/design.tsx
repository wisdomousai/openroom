import { useEffect, useRef, useState } from 'react';
import { type OutlineAside, type OutlineStep } from '@openroom/schema';

import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import { cn } from '../../../lib/utils';
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
import { writeAside } from '../AsideCanvas';
import { layoutChoicesFor, paneSections } from './applicability';

export function AsideDesign({
  aside,
  emptyHint,
  onChange,
}: {
  aside: OutlineAside | undefined;
  emptyHint: string;
  onChange: (aside: OutlineAside | undefined) => void;
}) {
  const title = aside?.title ?? '';
  const body = aside?.body ?? '';
  const items = (aside?.items ?? []).join('\n');
  const write = (next: OutlineAside) => {
    writeAside(aside, next, onChange);
  };
  return (
    <>
      <Section title="Title">
        <Input
          value={title}
          onChange={(event) => write({ ...aside, title: event.currentTarget.value, body: aside?.body, items: aside?.items })}
          placeholder="Optional title"
        />
      </Section>
      <Section title="Page">
        <Textarea
          rows={6}
          value={body}
          onChange={(event) => write({ ...aside, title: aside?.title, body: event.currentTarget.value, items: aside?.items })}
          placeholder={emptyHint}
        />
        <p className="text-caption text-muted-foreground">Or one thing per line below.</p>
        <Textarea
          rows={4}
          value={items}
          onChange={(event) => {
            const next = event.currentTarget.value.split('\n');
            write({
              ...aside,
              title: aside?.title,
              body: aside?.body,
              items: next,
            });
          }}
          placeholder={'One item\nAnother item'}
        />
      </Section>
    </>
  );
}

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
            Named arrangements. An agent fills the same ones.
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
