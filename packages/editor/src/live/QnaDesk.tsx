/**
 * Audience Q&A desk — the co-host moderation surface (#/sessions/:code/qna).
 *
 * A comms person or TA opens this with the shared host link while the presenter
 * runs the polls in LiveHost. Both connect as `host`; the DO fans out to every
 * host socket, so moderation here appears on the console (and stage) live.
 * Review questions as they arrive, hide the noise, and bring one up on the
 * projector (spotlight) or show the whole list.
 */
import { MonitorUp, MonitorX } from 'lucide-react';

import { useEditorServices } from '../services';
import { useSessionExit } from './useSessionExit';
import { Alert, AlertDescription } from '@openroom/ui/components/alert';
import { Button } from '@openroom/ui/components/button';
import { ToastRegion } from '@openroom/ui/toasts';
import { useHostSession } from './useHostSession';
import { cn } from '@openroom/ui/utils';
import type { ConnectionStatus, HostQnaView, StoredSession } from '../types';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  polling: 'Polling',
  offline: 'Offline',
};

export function QnaDesk({ live, onLeave }: { live: StoredSession; onLeave: () => void }) {
  const host = useHostSession(live);
  const { navigate } = useEditorServices().navigation;
  const { snapshot, status, fatal, toasts, ended, qna, toggleQnaHidden, setQnaStage } = host;
  const exit = useSessionExit(live, ended);

  if (fatal) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <Alert variant="destructive" role="alert">
          <AlertDescription>{fatal}</AlertDescription>
        </Alert>
        <div>
          <Button onClick={onLeave}>Back to library</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-svh flex-col bg-background">
      <header className="shrink-0 border-b border-border bg-card text-card-foreground">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
          <span className="font-mono text-lg font-semibold tracking-[0.18em]">
            {snapshot?.code ?? live.code}
          </span>
          <h1 className="text-sm font-semibold">Audience Q&A desk</h1>
          <span className="text-xs text-muted-foreground">{STATUS_LABEL[status]}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate({ kind: 'sessionConsole', sessionCode: live.sessionCode })}
            >
              Console
            </Button>
            <Button size="sm" variant="ghost" onClick={onLeave}>
              Leave
            </Button>
          </div>
        </div>
      </header>

      {ended ? (
        <div
          role="status"
          className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 px-6 py-3"
        >
          <p className="text-sm font-semibold">Session ended</p>
          <span className="flex-1" />
          {exit.sessionId !== null ? (
            <Button
              size="sm"
              onClick={() => navigate({ kind: 'sessionNotes', sessionId: exit.sessionId! }, { replace: true })}
            >
              Notes
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              navigate({ kind: 'library', place: exit.deckPlace }, { replace: true })
            }
          >
            Library
          </Button>
        </div>
      ) : null}

      <main className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col px-6 py-4">
        {!snapshot ? (
          <p className="text-sm text-muted-foreground">Loading session…</p>
        ) : !qna ? (
          <p className="text-sm text-muted-foreground">
            Audience Q&A is not enabled for this session. Turn on Audience Q&amp;A in the deck,
            then start a new session.
          </p>
        ) : (
          <QnaQuestionList
            qna={qna}
            handles={snapshot.handles}
            ended={ended}
            onToggleHidden={toggleQnaHidden}
            onSpotlight={host.canPresent ? (id) => setQnaStage('spotlight', id) : undefined}
            onUnspotlight={host.canPresent ? () => setQnaStage('list') : undefined}
            className="min-h-0 flex-1 overflow-y-auto"
          />
        )}
      </main>

      {qna ? (
        <footer className="shrink-0 border-t border-border bg-card py-3">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6">
            <span className="text-sm tabular-nums text-muted-foreground">
              <strong className="font-semibold text-foreground">
                {qna.questions.filter((q) => !q.hidden).length}
              </strong>{' '}
              visible questions
            </span>
            <Button
              variant="outline"
              disabled={ended || !host.canPresent}
              onClick={() => setQnaStage(qna.stage.mode === 'off' ? 'list' : 'off')}
            >
              {qna.stage.mode === 'off' ? (
                <>
                  <MonitorUp aria-hidden="true" /> Show Q&A on stage
                </>
              ) : (
                <>
                  <MonitorX aria-hidden="true" /> Take Q&A off stage
                </>
              )}
            </Button>
          </div>
        </footer>
      ) : null}

      <ToastRegion toasts={toasts} />
    </div>
  );
}

/**
 * The moderation list itself, shared between the Q&A desk (full height) and
 * the LiveHost console section (compact). SEG grammar: plain divided rows.
 */
export function QnaQuestionList({
  qna,
  handles,
  ended,
  onToggleHidden,
  onSpotlight,
  onUnspotlight,
  className,
  variant = 'rows',
  answeredIds,
  onAnswered,
}: {
  qna: HostQnaView;
  handles?: Record<string, string>;
  ended: boolean;
  onToggleHidden: (questionId: string, hidden: boolean) => void;
  onSpotlight?: (questionId: string) => void;
  onUnspotlight?: () => void;
  className?: string;
  variant?: 'rows' | 'cards';
  /** Device-local "I've addressed this" marks — no snapshot field exists. */
  answeredIds?: ReadonlySet<string>;
  onAnswered?: (questionId: string) => void;
}) {
  const spotlightId = qna.stage.mode === 'spotlight' ? qna.stage.questionId : null;

  if (qna.questions.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        No questions yet. Participants ask from the Q&A tab on their phones.
      </p>
    );
  }

  if (variant === 'cards') {
    return (
      <ul className={cn('flex flex-col gap-2', className)}>
        {qna.questions.map((question) => {
          const spotlighted = question.id === spotlightId;
          const answered = answeredIds?.has(question.id) === true;
          const quiet = question.hidden || answered;
          return (
            <li
              key={question.id}
              className={cn(
                'flex flex-col gap-2 rounded-lg border border-border p-3',
                quiet && 'bg-background',
              )}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={cn(
                    'min-w-0 flex-1 text-sm leading-snug',
                    quiet && 'text-muted-foreground',
                  )}
                >
                  {handles?.[question.participantId] ? (
                    <span className="text-caption font-semibold text-muted-foreground">
                      {handles[question.participantId]}:{' '}
                    </span>
                  ) : null}
                  {question.text}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-sm font-semibold tabular-nums',
                    quiet ? 'text-muted-foreground' : 'text-muted-foreground',
                  )}
                >
                  ▲ {question.votes}
                </span>
              </div>
              {quiet ? (
                <span className="text-caption text-muted-foreground">
                  {answered ? 'Answered · hidden from stage' : 'Hidden from stage'}
                </span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={spotlighted ? 'secondary' : 'subtle'}
                    disabled={ended || !onSpotlight}
                    className={cn(
                      'h-7 px-2.5 text-caption',
                      !spotlighted && 'bg-live-tint font-semibold text-live-tint-foreground hover:bg-live-tint',
                    )}
                    onClick={() => (spotlighted ? onUnspotlight?.() : onSpotlight?.(question.id))}
                  >
                    {spotlighted ? 'On stage' : 'Show on stage'}
                  </Button>
                  {onAnswered ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="subtle"
                      disabled={ended}
                      className="h-7 px-2.5 text-caption"
                      onClick={() => onAnswered(question.id)}
                    >
                      Answered
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="subtle"
                    disabled={ended}
                    className="h-7 px-2.5 text-caption"
                    onClick={() => onToggleHidden(question.id, question.hidden)}
                  >
                    Hide
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className={cn('flex flex-col divide-y divide-border', className)}>
      {qna.questions.map((question) => {
        const spotlighted = question.id === spotlightId;
        return (
          <li
            key={question.id}
            className={cn(
              'flex items-start justify-between gap-3 py-2 text-sm',
              question.hidden && 'text-muted-foreground line-through',
            )}
          >
            <span className="min-w-0">
              {handles?.[question.participantId] ? (
                <span className="text-xs font-medium text-muted-foreground no-underline">
                  {handles[question.participantId]}:{' '}
                </span>
              ) : null}
              {question.text}
              <span className="text-xs text-muted-foreground"> · {question.votes} votes</span>
              {spotlighted ? (
                <span className="ml-2 rounded-full bg-chart-2/15 px-2 py-0.5 text-xs font-medium text-foreground no-underline">
                  On stage
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {!question.hidden ? (
                <Button
                  size="sm"
                  variant={spotlighted ? 'secondary' : 'ghost'}
                  disabled={ended || !onSpotlight}
                  onClick={() => (spotlighted ? onUnspotlight?.() : onSpotlight?.(question.id))}
                  aria-label={`${spotlighted ? 'Remove from stage' : 'Spotlight on stage'}: ${question.text}`}
                >
                  {spotlighted ? 'Unspotlight' : 'Spotlight'}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={ended}
                onClick={() => onToggleHidden(question.id, question.hidden)}
                aria-label={`${question.hidden ? 'Unhide' : 'Hide'} question: ${question.text}`}
              >
                {question.hidden ? 'Unhide' : 'Hide'}
              </Button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
