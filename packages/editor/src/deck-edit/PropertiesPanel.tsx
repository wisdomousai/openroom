import { useLayoutEffect, useRef } from 'react';
import { BrandKitPicker } from './properties/brand-kit';
import { Button } from '@openroom/ui/components/button';
import { cn } from '@openroom/ui/utils';

import { useEditorServices } from '../services';
import { AsideDesign, DesignState } from './properties/design';
import { DictionarySection, NotesSection } from './properties/notes-dictionary';
import { DeckDesignPanel } from './properties/deck-design';
import type { PaneTab, PropertiesPanelProps } from './properties/shared';
import { layoutChoicesFor } from './properties/applicability';

export type { PaneTab, PropertiesPanelProps } from './properties/shared';

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { outline, step, aside } = props;
  const { VersionHistory, brandKits } = useEditorServices().slots;
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!props.overflowFocus?.sequence) return;
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-editor-target="${CSS.escape(props.overflowFocus.target)}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'nearest' });
    const field = target.querySelector<HTMLElement>('textarea, input, button');
    (field ?? target).focus({ preventScroll: true });
  }, [props.overflowFocus]);
  const title =
    aside === 'homework' ? 'Homework' : aside === 'recap' ? 'Recap' : 'Slide';

  return (
    <div ref={rootRef} className="deck-editor-properties flex h-full min-h-0 min-w-0 w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pl-[18px] pt-3.5">
        <span className="text-section">{title}</span>
        <button
          type="button"
          title="Close"
          onClick={props.onClose}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-chrome focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          ✕
        </button>
      </div>
      <div className="flex gap-0.5 px-3 pb-2.5 pl-3.5">
        {(
          [
            { id: 'design', label: 'Design' },
            { id: 'deck', label: 'Theme' },
            { id: 'notes', label: 'Notes' },
            { id: 'history', label: 'History' },
          ] as const
        ).filter((tab) => tab.id !== 'history' || VersionHistory !== undefined).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => props.onPaneTab(tab.id)}
            className={cn(
              'inline-flex h-[30px] items-center rounded-md px-3 text-secondary',
              props.paneTab === tab.id
                ? 'bg-accent font-semibold text-accent-foreground'
                : 'hover:bg-chrome',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {props.paneTab === 'design' && (props.overflowIssues?.length ?? 0) > 0 ? (
          <section data-editor-target="overflow" aria-label="Slide overflow" tabIndex={-1} className="grid min-w-0 gap-2 border-t border-hairline px-[18px] py-3.5">
            <h3 className="text-row-title">Content that does not fit</h3>
            <ul className="grid max-h-40 gap-1 overflow-y-auto overscroll-contain">
              {props.overflowIssues?.map((issue) => <li key={issue.target}>
                <button type="button" className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-chrome focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]" onClick={() => props.onOverflowSelect?.(issue)}>
                  <span className="font-medium">{issue.label}</span>
                  <span className="block text-xs text-muted-foreground">{issue.reason === 'bounds' ? 'Outside its visible area' : 'Content exceeds its box'}</span>
                </button>
              </li>)}
            </ul>
            {step && layoutChoicesFor(step.kind).length > 1 ? <Button size="sm" variant="outline" onClick={props.onOverflowLayout}>Change layout</Button> : null}
            <p className="text-caption text-muted-foreground">Edit the content or resize its box. To split content, duplicate or add a slide.</p>
          </section>
        ) : null}
        {props.paneTab === 'design' && step?.design?.templateId && props.onResetTemplate ? <div className="px-[18px] pb-3"><Button size="sm" variant="outline" onClick={props.onResetTemplate}>Reset template formatting</Button></div> : null}
        {props.lookUpWord != null && props.onCloseLookUp !== undefined ? (
          <DictionarySection
            word={props.lookUpWord}
            deckId={props.deckId}
            onClose={props.onCloseLookUp}
          />
        ) : null}
        {props.paneTab === 'deck' ? <>{props.spaceId && brandKits ? <BrandKitPicker brandKits={brandKits} spaceId={props.spaceId} onApply={props.onApplyBrandKit} /> : null}<DeckDesignPanel {...props} /></> : props.paneTab === 'history' ? (
          VersionHistory === undefined ? null : <div className="border-t border-hairline px-[18px] py-3.5">
            <VersionHistory
              deckId={props.deckId}
              refreshKey={props.versionRefresh}
              currentVersion={props.currentVersion}
              onLoadVersion={props.onLoadVersion}
            />
          </div>
        ) : props.paneTab === 'notes' ? (
          <><NotesSection {...props} />{props.learnerFeedback}</>
        ) : aside !== null ? (
          <AsideDesign
            aside={aside === 'homework' ? outline.homework : outline.recap}
            emptyHint={aside === 'homework' ? 'Homework' : 'Recap'}
            onChange={aside === 'homework' ? props.onHomework : props.onRecap}
          />
        ) : step === null ? (
          <p className="border-t border-hairline px-[18px] py-3.5 text-caption text-muted-foreground">
            Select a slide.
          </p>
        ) : (
          <DesignState {...props} step={step} />
        )}
      </div>
    </div>
  );
}
