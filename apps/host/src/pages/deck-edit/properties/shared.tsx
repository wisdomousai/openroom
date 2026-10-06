import { useState } from 'react';
import {
  type Interaction,
  type DeckDesign,
  type SlideDesign,
  type Outline,
  type OutlineAside,
  type OutlineLayout,
  type OutlineMediaFocal,
  type OutlineMedia,
  type OpenRoomFileResourceV1,
  type OutlineMediaPlace,
  type OutlineStep,
  type OutlineTimerPlacement,
  type OutlineTimerStyle,
} from '@openroom/schema';

import { Textarea } from '../../../components/ui/textarea';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/utils';
import type { ListTarget, PictureTarget } from '../outline-edit';
import type { SlideOverflowIssue } from '../slide-overflow';

export type PaneTab = 'design' | 'deck' | 'notes' | 'history';

export function Section({
  title,
  children,
  ref,
  flash,
  target,
}: {
  title: string;
  children: React.ReactNode;
  ref?: React.Ref<HTMLElement>;
  flash?: boolean;
  target?: string;
}) {
  return (
    <section
      ref={ref}
      data-editor-target={target}
      className={cn(
        'flex min-w-0 flex-col gap-2.5 border-t border-hairline px-[18px] py-3.5 [overflow-wrap:anywhere]',
        flash && 'outline outline-2 -outline-offset-2 outline-ring',
      )}
    >
      <h3 className="text-row-title">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Part text commits on blur, same as the canvas caret. Live `onChange` would
 * re-parse the outline on every keystroke — a half-typed fill-the-gaps `{{g1}}` is
 * `E_FILL_THE_GAPS_GAPS`, and that replaces the editor with the repair screen.
 */
export function CommitTextarea({
  value,
  onCommit,
  ariaLabel,
  onSelectRange,
}: {
  value: string;
  onCommit: (text: string) => void;
  ariaLabel: string;
  onSelectRange?: (start: number, end: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Textarea
      aria-label={ariaLabel}
      placeholder={ariaLabel}
      value={draft ?? value}
      rows={3}
      onFocus={() => setDraft(value)}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onSelect={(event) =>
        onSelectRange?.(event.currentTarget.selectionStart ?? 0, event.currentTarget.selectionEnd ?? 0)
      }
      onBlur={() => {
        const next = draft;
        setDraft(null);
        if (next !== null && next !== value) onCommit(next);
      }}
    />
  );
}

export function listTargetFor(step: OutlineStep, key: string): ListTarget | null {
  if (key.startsWith('option-')) return 'option';
  if (key.startsWith('gap-')) return 'gap';
  if (key === 'materials') return 'material';
  if (key.startsWith('cell-')) {
    if (step.kind === 'cards' || step.kind === 'steps') return 'card';
    if (step.kind === 'activity') return 'instruction';
    if (step.kind === 'debrief') return 'prompt';
  }
  return null;
}

export function indexOfKey(key: string): number | undefined {
  const digits = key.slice(key.lastIndexOf('-') + 1);
  const index = Number(digits);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

export interface PropertiesPanelProps {
  overflowIssues?: SlideOverflowIssue[];
  overflowFocus?: { target: string; sequence: number };
  onOverflowSelect?: (issue: SlideOverflowIssue) => void;
  onOverflowLayout?: () => void;
  learnerFeedback?: React.ReactNode;
  onResetTemplate?: () => void;
  onApplyBrandKit: (design: DeckDesign) => void;
  onDeckDesign: (design: DeckDesign) => void;
  onSlideDesign: (design: SlideDesign) => void;
  outline: Outline;
  step: OutlineStep | null;
  aside: 'homework' | 'recap' | null;
  partKey: string | null;
  groups: string[][];
  spaceId?: string | null;
  deckId: string;
  currentVersion: number;
  versionRefresh: number;
  revealFocus: number;
  paneTab: PaneTab;
  onPaneTab: (tab: PaneTab) => void;
  onClose: () => void;
  onSelectPart: (key: string | null) => void;
  onLayout: (layout: OutlineLayout | undefined) => void;
  onMinutes: (delta: number) => void;
  onReveal: (groups: string[][]) => void;
  onPartText: (key: string, text: string) => void;
  onAddBreakout: (key: string) => void;
  onSelectStep: (stepId: string) => void;
  onRemoveStep: (stepId: string) => void;
  onAddListItem: (target: ListTarget, index?: number) => void;
  onRemoveListItem: (target: ListTarget, index: number) => void;
  onOptionCorrect: (index: number) => void;
  onGapAnswers: (index: number, answers: string[]) => void;
  onGapDistractors: (index: number, distractors: string[]) => void;
  onFillTheGapsBank: (bank: string[]) => void;
  onInsertGapAtRange: (start: number, end: number) => void;
  /** Open the picture dialog for a named target — never for "whatever is selected". */
  onOpenPicture: (target: PictureTarget) => void;
  onRemovePicture: () => void;
  onMediaFocal: (focal: OutlineMediaFocal | undefined) => void;
  onMediaPlace: (place: OutlineMediaPlace) => void;
  onMediaSize: (size: number) => void;
  onMediaChange?: (media: OutlineMedia) => void;
  onEmbeddedResource?: (id: string, resource: OpenRoomFileResourceV1) => void;
  onRemoveElement: (elementId: string) => void;
  /** A word being looked up. A read: nothing here writes to the outline. */
  lookUpWord?: string | null;
  onCloseLookUp?: () => void;
  onEditHtml: (elementId: string) => void;
  onEditMarkdown: (elementId: string) => void;
  onEditIframe: (elementId: string) => void;
  onEditPdf: (elementId: string) => void;
  onDurationSeconds?: (seconds: number) => void;
  onTimerStyle?: (style: OutlineTimerStyle) => void;
  onTimerPlacement?: (placement: OutlineTimerPlacement) => void;
  onTimerPersist?: (persist: boolean) => void;
  onInteraction?: (interaction: Interaction) => void;
  onNotes: (stepId: string, text: string) => void;
  onHomework: (aside: OutlineAside | undefined) => void;
  onRecap: (aside: OutlineAside | undefined) => void;
  onLoadVersion: (source: string, version: number) => void;
}

export function ChipsEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  function add(): void {
    const word = draft.trim();
    if (word === '') return;
    onChange([...values, word]);
    setDraft('');
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {values.map((word, index) => (
          <button
            key={`${word}-${String(index)}`}
            type="button"
            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-input px-2 py-0.5 text-caption [overflow-wrap:anywhere]"
            onClick={() => onChange(values.filter((_, at) => at !== index))}
          >
            {word}
            <span aria-hidden="true">×</span>
          </button>
        ))}
        <Input
          value={draft}
          placeholder="Add"
          className="h-7 w-28"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      </div>
    </div>
  );
}
