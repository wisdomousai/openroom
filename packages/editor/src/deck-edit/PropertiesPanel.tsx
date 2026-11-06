import { useLayoutEffect, useRef } from 'react';
import { BrandKitPicker } from './properties/brand-kit';
import { X } from 'lucide-react';
import { Button } from '@openroom/ui/components/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@openroom/ui/components/tabs';

import { useEditorServices } from '../services';
import { DesignState } from './properties/design';
import { DictionarySection, NotesSection } from './properties/notes-dictionary';
import { DeckDesignPanel } from './properties/deck-design';
import type { PaneTab, PropertiesPanelProps } from './properties/shared';
import type { Outline, OutlineStep } from '@openroom/schema';
import { SPLITTABLE_KINDS, partLabel, splitStepAt } from './outline-edit';
import type { SlideOverflowIssue } from './slide-overflow';
import { layoutChoicesFor } from './properties/applicability';

export type { PaneTab, PropertiesPanelProps } from './properties/shared';

/**
 * Where a list slide that does not fit can be split: its first item that is
 * outside the visible area, when that is not the first item and both halves
 * are still a valid slide. An item whose own text is cut keeps its place:
 * moving the items after it does not give it more room.
 */
function overflowSplitIndex(outline: Outline, step: OutlineStep | null, issues: SlideOverflowIssue[]): number | null {
  if (step === null || !(SPLITTABLE_KINDS as readonly string[]).includes(step.kind)) return null;
  const cells = issues.flatMap((issue) => {
    const match = issue.reason === 'bounds' ? /^cell-(\d+)$/.exec(issue.partKey) : null;
    const index = match === null ? 0 : Number(match[1]);
    return index >= 1 ? [index] : [];
  });
  if (cells.length === 0) return null;
  const at = Math.min(...cells);
  return splitStepAt(outline, step.id, at).stepId === '' ? null : at;
}

/**
 * What the author can do, by what does not fit: a slide part has no box to
 * resize, a freeform object does.
 */
function overflowAdvice(issues: SlideOverflowIssue[], canSplit: boolean): string {
  const objects = issues.some((issue) => issue.partKey.startsWith('el-'));
  const parts = issues.some((issue) => !issue.partKey.startsWith('el-'));
  const advice: string[] = [];
  if (parts) {
    advice.push(
      canSplit
        ? 'Shorten or remove items, or move the items that do not fit to a new slide.'
        : 'Shorten the text or choose another layout. To split the content, duplicate the slide or add one.',
    );
  }
  if (objects) advice.push('Edit the text box or make it larger.');
  return advice.join(' ');
}

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
  const splitAt = overflowSplitIndex(outline, step, props.overflowIssues ?? []);
  const title =
    aside === 'homework' ? 'Homework' : aside === 'recap' ? 'Recap' : 'Slide';

  return (
    <div ref={rootRef} className="deck-editor-properties flex h-full min-h-0 min-w-0 w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pl-[18px] pt-3.5">
        <span className="text-section">{title}</span>
        <button
          type="button"
          aria-label="Close task pane"
          title="Close task pane"
          onClick={props.onClose}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-chrome focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <Tabs
        value={props.paneTab}
        onValueChange={(next) => props.onPaneTab(next as PaneTab)}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <TabsList
          aria-label="Task pane"
          className="flex h-auto justify-start gap-0.5 bg-transparent px-3 pb-2.5 pl-3.5 pt-0"
        >
          {(
            [
              { id: 'design', label: 'Design' },
              { id: 'deck', label: 'Theme' },
              { id: 'notes', label: 'Notes' },
              { id: 'history', label: 'History' },
            ] as const
          ).filter((tab) => tab.id !== 'history' || VersionHistory !== undefined).map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="h-[30px] px-3 py-0 hover:bg-chrome data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={props.paneTab} className="mt-0 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
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
              {step && splitAt !== null && props.onOverflowSplit ? (
                <Button size="sm" variant="outline" onClick={() => props.onOverflowSplit?.(splitAt)}>
                  Move {partLabel(step, `cell-${String(splitAt)}`)} and the rest to a new slide
                </Button>
              ) : null}
              {step && layoutChoicesFor(step.kind).length > 1 ? <Button size="sm" variant="outline" onClick={props.onOverflowLayout}>Change layout</Button> : null}
              <p className="text-caption text-muted-foreground">{overflowAdvice(props.overflowIssues ?? [], splitAt !== null)}</p>
            </section>
          ) : null}
          {props.paneTab === 'design' && step?.design?.templateId && props.onResetTemplate ? <div className="px-[18px] pb-3"><Button size="sm" variant="outline" onClick={props.onResetTemplate}>Reset template formatting</Button></div> : null}
          {props.paneTab === 'design' && props.lookUpWord != null && props.onCloseLookUp !== undefined ? (
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
                loadedVersion={props.loadedVersion}
                unsavedDraft={props.unsavedDraft}
                onLoadVersion={props.onLoadVersion}
              />
            </div>
          ) : props.paneTab === 'notes' ? (
            <><NotesSection {...props} />{props.learnerFeedback}</>
          ) : aside !== null ? (
            // The page is edited where the student reads it: on the desk.
            <p className="border-t border-hairline px-[18px] py-3.5 text-caption text-muted-foreground">
              {aside === 'homework' ? 'Write the homework on the page.' : 'Write the recap on the page.'}
            </p>
          ) : step === null ? (
            <p className="border-t border-hairline px-[18px] py-3.5 text-caption text-muted-foreground">
              Select a slide.
            </p>
          ) : (
            <DesignState {...props} step={step} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
