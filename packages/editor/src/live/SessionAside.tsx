import { useState, type KeyboardEvent, type ReactNode } from 'react';

import { Button } from '@openroom/ui/components/button';
import { Textarea } from '@openroom/ui/components/textarea';
import { QnaQuestionList } from './QnaDesk';
import { slideLabel } from './slide-label';
import type { RailItem } from './snapshot';
import type { HostQnaView, HostSnapshot, QnaEntry, TextEntry } from '../types';

export interface SessionAsideProps {
  groupControls?: ReactNode;
  liveControls?: ReactNode;
  /** Outline mode when present; session-document mode when undefined. */
  outline: HostSnapshot['outline'];
  items: RailItem[];
  selectedId: string | null;
  onSelectStep: (stepId: string) => void;
  onSelectItem: (id: string) => void;
  /** Entries of the focused text/qna interaction; null for other types. */
  entries: (TextEntry | QnaEntry)[] | null;
  isWordCloud: boolean;
  handles: Record<string, string> | undefined;
  ended: boolean;
  canPresent: boolean;
  onToggleEntry: (entry: TextEntry) => void;
  /** The step's tutor note, else the interaction note, else the pedagogy note. */
  notesText: string | undefined;
  /** Absent without a scratchpad slot: the note field is not rendered. */
  scratchpad?: string;
  onScratchpadChange: (text: string) => void;
  qna: HostQnaView | null;
  answeredQna: Set<string>;
  onMarkAnswered: (questionId: string) => void;
  onToggleHidden: (questionId: string, hidden: boolean) => void;
  onSetStage: (mode: 'off' | 'list' | 'spotlight', questionId?: string) => void;
}

/**
 * The slide list is one tab stop: Tab lands on the slide on screen, the arrow
 * keys (and Home, End) move between rows, Enter or Space shows the row. Fifteen
 * rows are no longer fifteen stops between the slide and the notes.
 */
function onRailKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)')];
  if (rows.length === 0) return;
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? rows.length - 1
        : event.key === 'ArrowDown'
          ? Math.min(rows.length - 1, at + 1)
          : Math.max(0, at - 1);
  event.preventDefault();
  event.stopPropagation();
  rows[next]?.focus();
}

type Pane = 'session' | 'qna' | 'groups';

/**
 * The Session aside: outline/question list on top, moderation and private notes
 * under it, or the audience Q&A desk on the second tab.
 */
export function SessionAside({
  groupControls,
  liveControls,
  outline,
  items,
  selectedId,
  onSelectStep,
  onSelectItem,
  entries,
  isWordCloud,
  handles,
  ended,
  canPresent,
  onToggleEntry,
  notesText,
  scratchpad,
  onScratchpadChange,
  qna,
  answeredQna,
  onMarkAnswered,
  onToggleHidden,
  onSetStage,
}: SessionAsideProps) {
  const [pane, setPane] = useState<Pane>('session');
  const outlineSteps = outline?.content.steps ?? [];
  const outlineIndex = outline?.currentStepIndex ?? 0;
  const qnaCount = qna ? qna.questions.filter((q) => !q.hidden).length : 0;
  const panes: { id: Pane; label: string }[] = [
    { id: 'session', label: 'Session' },
    { id: 'qna', label: `Q&A${qna ? ` (${qnaCount})` : ''}` },
    ...(groupControls ? [{ id: 'groups' as const, label: 'Groups' }] : []),
  ];
  /* Arrow keys, Home and End move between the tabs and show the one reached. */
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const at = panes.findIndex((entry) => entry.id === pane);
    const to =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? panes.length - 1
          : (at + (event.key === 'ArrowRight' ? 1 : -1) + panes.length) % panes.length;
    const target = panes[to];
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    setPane(target.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`#session-aside-tab-${target.id}`)?.focus();
  };

  return (
    <aside
      aria-label="Session"
      className="flex w-[340px] shrink-0 flex-col border-l border-border bg-card text-card-foreground"
    >
      <div
        role="tablist"
        aria-label="Session aside"
        className="flex gap-0.5 px-3.5 pb-2.5 pt-3"
        onKeyDown={onTabsKeyDown}
      >
        {panes.map((entry) => {
          const selected = pane === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`session-aside-tab-${entry.id}`}
              aria-selected={selected}
              aria-controls="session-aside-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setPane(entry.id)}
              className={
                selected
                  ? 'inline-flex h-[30px] items-center rounded-md bg-accent px-3 text-row-title text-accent-foreground'
                  : 'inline-flex h-[30px] items-center rounded-md px-3 text-secondary text-foreground hover:bg-chrome'
              }
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {/*
        One scroll area under the tabs. The listening block scrolls with the
        slide list instead of pushing it off screen, and the private notes stay
        pinned under it on every tab.
      */}
      <div
        role="tabpanel"
        id="session-aside-panel"
        aria-labelledby={`session-aside-tab-${pane}`}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {liveControls}
        {pane === 'session' ? (
          <>
            <div className="flex flex-col gap-px px-2 pb-3" aria-label="Slides" role="group" onKeyDown={onRailKeyDown}>
              {outline
                ? outlineSteps.map((step, index) => {
                    const current = index === outlineIndex;
                    const nested = step.breakoutOf !== undefined;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        disabled={!canPresent}
                        tabIndex={current ? 0 : -1}
                        aria-current={current ? 'step' : undefined}
                        onClick={() => onSelectStep(step.id)}
                        className={
                          current
                            ? 'flex items-center gap-2 rounded-lg bg-live-tint px-1.5 py-1.5 text-left outline outline-1 -outline-offset-1 outline-live'
                            : nested
                              ? 'flex items-center gap-2 rounded-lg py-1.5 pl-6 pr-1.5 text-left hover:bg-chrome'
                              : 'flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-chrome'
                        }
                      >
                        {nested ? (
                          <span aria-hidden="true" className="text-caption text-muted-foreground">
                            ↳
                          </span>
                        ) : (
                          <span
                            className={
                              current
                                ? 'w-3.5 text-right text-caption font-semibold tabular-nums text-live-tint-foreground'
                                : 'w-3.5 text-right text-caption tabular-nums text-muted-foreground'
                            }
                          >
                            {index + 1}
                          </span>
                        )}
                        <span
                          aria-hidden="true"
                          className={
                            current
                              ? 'relative block h-[33px] w-[52px] shrink-0 rounded-md border border-[color-mix(in_oklab,var(--live)_40%,var(--border))] bg-card'
                              : 'relative block h-[33px] w-[52px] shrink-0 rounded-md border border-border bg-card'
                          }
                        >
                          <span className="absolute left-[8%] top-[14%] h-[10%] w-[48%] bg-muted-foreground" />
                          <span className="absolute left-[8%] top-[36%] h-[12%] w-[74%] bg-live-tint" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-px">
                          <span className="truncate text-row-title">{slideLabel(step, outline?.content.interactions)}</span>
                          {current ? (
                            <span className="text-caption text-live-tint-foreground">On screen now</span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })
                : items.map((item, index) => {
                    const current = item.id === selectedId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!canPresent}
                        tabIndex={current || (selectedId === null && index === 0) ? 0 : -1}
                        aria-current={current ? 'step' : undefined}
                        onClick={() => onSelectItem(item.id)}
                        className={
                          current
                            ? 'flex items-center gap-2 rounded-lg bg-live-tint px-1.5 py-1.5 text-left outline outline-1 -outline-offset-1 outline-live'
                            : 'flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-chrome'
                        }
                      >
                        <span className="w-3.5 text-right text-caption tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-secondary">{item.prompt}</span>
                      </button>
                    );
                  })}
            </div>

            {entries !== null && entries.length > 0 ? (
              <section aria-label={isWordCloud ? 'Word cloud control' : 'Entries'} className="border-t border-hairline px-4 py-3">
                <h2 className="mb-2 text-row-title">
                  {isWordCloud ? 'Word cloud control' : 'Moderate responses'}
                </h2>
                <ul className="flex flex-col divide-y divide-hairline">
                  {entries.map((entry) => (
                    <li
                      key={entry.participantId}
                      className={
                        entry.hidden
                          ? 'flex items-start justify-between gap-2 py-1.5 text-secondary text-muted-foreground line-through'
                          : 'flex items-start justify-between gap-2 py-1.5 text-secondary'
                      }
                    >
                      <span>
                        {handles?.[entry.participantId] ? (
                          <span className="text-caption font-semibold text-muted-foreground">
                            {handles[entry.participantId]}:{' '}
                          </span>
                        ) : null}
                        {entry.text}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => onToggleEntry(entry)} disabled={ended}>
                        {entry.hidden ? 'Unhide' : 'Hide'}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

          </>
        ) : pane === 'groups' ? groupControls : (
          <>
            {qna ? (
              <>
                <div className="flex items-center gap-2 px-3.5 pb-3">
                  <Button
                    type="button"
                    size="sm"
                    variant={qna.stage.mode === 'off' ? 'outline' : 'live'}
                    disabled={ended || !canPresent}
                    onClick={() => onSetStage(qna.stage.mode === 'off' ? 'list' : 'off')}
                  >
                    Stage Q&A
                  </Button>
                  <span className="text-caption text-muted-foreground">
                    {qna.stage.mode === 'off' ? 'Off' : 'On'}
                  </span>
                </div>
                <QnaQuestionList
                  qna={qna}
                  handles={handles}
                  ended={ended}
                  variant="cards"
                  answeredIds={answeredQna}
                  onAnswered={onMarkAnswered}
                  onToggleHidden={onToggleHidden}
                  onSpotlight={canPresent ? (id) => onSetStage('spotlight', id) : undefined}
                  onUnspotlight={canPresent ? () => onSetStage('list') : undefined}
                  className="px-3.5 pb-4"
                />
              </>
            ) : (
              <p className="px-3.5 text-secondary text-muted-foreground">
                Audience Q&A is not on for this session.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-hairline px-[18px] py-3.5">
        <span className="text-row-title">Private notes</span>
        {notesText ? (
          <p className="text-secondary leading-snug text-foreground">{notesText}</p>
        ) : null}
        {scratchpad === undefined ? null : (
          <>
            <Textarea
              value={scratchpad}
              onChange={(event) => onScratchpadChange(event.currentTarget.value)}
              placeholder="Notes"
              className="min-h-20"
              disabled={ended}
              aria-label="Private notes"
            />
            <p className="text-caption text-muted-foreground">
              Saved on this device.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
