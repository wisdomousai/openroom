import { useState, type ReactNode } from 'react';

import { Button } from '@openroom/ui/components/button';
import { Textarea } from '@openroom/ui/components/textarea';
import { QnaQuestionList } from './QnaDesk';
import { stepLabel } from './utils';
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
  const [pane, setPane] = useState<'session' | 'qna' | 'groups'>('session');
  const outlineSteps = outline?.content.steps ?? [];
  const outlineIndex = outline?.currentStepIndex ?? 0;
  const qnaCount = qna ? qna.questions.filter((q) => !q.hidden).length : 0;

  return (
    <aside
      aria-label="Session"
      className="flex w-[340px] shrink-0 flex-col border-l border-border bg-card text-card-foreground"
    >
      <div className="flex gap-0.5 px-3.5 pb-2.5 pt-3">
        <button
          type="button"
          onClick={() => setPane('session')}
          className={
            pane === 'session'
              ? 'inline-flex h-[30px] items-center rounded-md bg-accent px-3 text-sm font-semibold text-accent-foreground'
              : 'inline-flex h-[30px] items-center rounded-md px-3 text-sm text-foreground hover:bg-chrome'
          }
        >
          Session
        </button>
        <button
          type="button"
          onClick={() => setPane('qna')}
          className={
            pane === 'qna'
              ? 'inline-flex h-[30px] items-center rounded-md bg-live-tint px-3 text-sm font-semibold text-live-tint-foreground'
              : 'inline-flex h-[30px] items-center rounded-md px-3 text-sm text-foreground hover:bg-chrome'
          }
        >
          Q&A{qna ? ` (${qnaCount})` : ''}
        </button>
        {groupControls ? <button type="button" onClick={() => setPane('groups')}
          className={`inline-flex h-[30px] items-center rounded-md px-3 text-sm ${pane === 'groups' ? 'bg-accent font-semibold' : 'hover:bg-chrome'}`}>
          Groups
        </button> : null}
      </div>

      {liveControls}
      {pane === 'session' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col gap-px px-2 pb-3">
            {outline
              ? outlineSteps.map((step, index) => {
                  const current = index === outlineIndex;
                  const nested = step.breakoutOf !== undefined;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      disabled={!canPresent}
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
                        <span className="truncate text-sm font-semibold">{stepLabel(step)}</span>
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
                      <span className="min-w-0 flex-1 truncate text-sm">{item.prompt}</span>
                    </button>
                  );
                })}
          </div>

          {entries !== null && entries.length > 0 ? (
            <section aria-label={isWordCloud ? 'Word cloud control' : 'Entries'} className="border-t border-hairline px-4 py-3">
              <h2 className="mb-2 text-sm font-semibold">
                {isWordCloud ? 'Word cloud control' : 'Moderate responses'}
              </h2>
              <ul className="flex flex-col divide-y divide-hairline">
                {entries.map((entry) => (
                  <li
                    key={entry.participantId}
                    className={
                      entry.hidden
                        ? 'flex items-start justify-between gap-2 py-1.5 text-sm text-muted-foreground line-through'
                        : 'flex items-start justify-between gap-2 py-1.5 text-sm'
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

          <div className="mt-auto flex flex-col gap-2 border-t border-hairline px-[18px] py-3.5">
            <span className="text-sm font-semibold">Private notes</span>
            {notesText ? (
              <p className="text-sm leading-snug text-foreground">{notesText}</p>
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
        </div>
      ) : pane === 'groups' ? <div className="min-h-0 flex-1 overflow-y-auto">{groupControls}</div> : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
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
            <p className="px-3.5 text-sm text-muted-foreground">
              Audience Q&A is not on for this session.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
