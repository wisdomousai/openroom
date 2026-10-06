import { FacilitationControls } from './live/FacilitationControls';
import { canAdvanceOutline, canRetreatOutline } from './live/outline-navigation';
/**
 * Phone-first presenter remote — a companion, not a second console.
 * Per-slide controls only; Back / Next own a fixed 62px bottom row.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { to } from './destinations';
import { useSessionExit } from './live/useSessionExit';
import { ListeningControls } from './live/ListeningControls';
import { Alert, AlertDescription, AlertTitle } from '@openroom/ui/components/alert';
import { Button } from '@openroom/ui/components/button';
import { formatClock, formatQuestionLeft, useClosesAt, useSessionClock } from './liveClock';
import { ToastRegion } from '@openroom/ui/toasts';
import { useHostSession } from './useHostSession';
import { useQuestionRail } from './useQuestionRail';
import { cn } from '@openroom/ui/utils';
import { EndSessionDialog } from './EndSessionDialog';
import type { ConnectionStatus, StoredSession } from './types';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  polling: 'Polling',
  offline: 'Offline',
};

function stepKindWord(kind: string | undefined, isQuestion: boolean): string {
  if (kind === 'timer') return 'timer';
  if (kind === 'join') return 'join the session';
  if (kind === 'blank') return 'slide';
  if (kind === 'interaction' || isQuestion) return 'question';
  return kind ?? 'slide';
}

export function PresenterRemote({
  live,
  onLeave,
  onOpenLiveHost,
}: {
  live: StoredSession;
  onLeave: () => void;
  onOpenLiveHost: () => void;
}) {
  const host = useHostSession(live);
  const navigate = useNavigate();
  const exit = useSessionExit(live, host.ended);
  const [copied, setCopied] = useState(false);
  const remaining = useClosesAt(host.closesAt);

  const {
    selectedId,
    setSelectedId,
    selected,
    selectedIndex,
    focusId,
    canOpenOnStage,
  } = useQuestionRail({
    items: host.items,
    activeId: host.activeId,
    ended: host.ended,
    snapshot: host.snapshot,
  });

  const showQuestion = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (id !== host.activeId && canOpenOnStage(id)) {
        host.openInteraction(id);
      }
    },
    [canOpenOnStage, host, setSelectedId],
  );

  const outline = host.snapshot?.outline;
  const outlineIndex = outline?.currentStepIndex ?? 0;
  const outlineSteps = outline?.content.steps ?? [];
  const outlineStep = outlineSteps[outlineIndex];
  const outlineStepCount = outlineSteps.length;

  const ticking = useSessionClock(host.snapshot?.clock);

  const prev = useCallback(() => {
    if (outline) {
      if (canRetreatOutline(outline)) void host.run({ command: 'outline.previous' });
      return;
    }
    const item = host.items[selectedIndex - 1];
    if (item) showQuestion(item.id);
  }, [host, outline, outlineIndex, selectedIndex, showQuestion]);

  const next = useCallback(() => {
    if (outline) {
      if (canAdvanceOutline(outline)) void host.run({ command: 'outline.next' });
      return;
    }
    const item = host.items[selectedIndex + 1];
    if (item) showQuestion(item.id);
  }, [host, outline, outlineIndex, outlineStepCount, selectedIndex, showQuestion]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(host.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      host.push('Could not copy code', 'error');
    }
  };

  if (host.fatal) {
    return (
      <div className="flex min-h-dvh flex-col gap-4 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <Alert variant="destructive">
          <AlertTitle>Could not connect</AlertTitle>
          <AlertDescription>{host.fatal}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={onLeave}>
          Leave
        </Button>
      </div>
    );
  }

  /*
   * The phone gets an exit too. Until this existed, End on the remote left the
   * presenter on a dead screen with no way out.
   */
  if (host.ended) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[402px] flex-col items-center justify-center gap-5 px-5 text-center">
        <p className="text-lg font-semibold">Session ended</p>
        <div className="flex w-full flex-col gap-2">
          {exit.sessionId !== null ? (
            <Button
              className="h-12 rounded-xl text-option font-semibold"
              onClick={() =>
                void navigate({ ...to.sessionNotes(exit.sessionId!), replace: true })
              }
            >
              Notes
            </Button>
          ) : null}
          <Button
            variant="outline"
            className="h-12 rounded-xl text-option font-normal"
            onClick={() =>
              void navigate({ ...to.library(exit.deckPlace ?? undefined), replace: true })
            }
          >
            Library
          </Button>
        </div>
        <ToastRegion toasts={host.toasts} />
      </div>
    );
  }

  const focus = focusId
    ? host.items.find((i) => i.id === focusId) ?? selected
    : selected;
  const isQuestion = outlineStep?.kind === 'interaction' || (!outline && Boolean(focus));
  const timerStep = outlineStep?.kind === 'timer' ? outlineStep : null;
  const isTimer = timerStep !== null;
  const clockLabel = ticking.label ?? (timerStep ? formatClock(timerStep.seconds) : null);
  const outlinePrompt =
    outlineStep === undefined
      ? null
      : 'title' in outlineStep && typeof outlineStep.title === 'string' && outlineStep.title.trim() !== ''
        ? outlineStep.title
        : outlineStep.kind === 'interaction'
          ? null
          : outlineStep.kind === 'timer'
            ? (outlineStep.title ?? `${formatClock(outlineStep.seconds)}`)
            : `Step ${outlineIndex + 1}: ${outlineStep.kind}`;
  const focusPrompt =
    focus?.prompt?.trim() ||
    host.activePrompt?.trim() ||
    outlinePrompt ||
    (host.ended ? 'Session ended' : 'Waiting…');

  const slideCount = outline ? outlineStepCount : host.items.length;
  const slideIndex = outline ? outlineIndex : selectedIndex;
  const canBack = outline ? canRetreatOutline(outline) : slideIndex > 0;
  const canNext = outline ? canAdvanceOutline(outline) : slideCount > 0 && slideIndex < slideCount - 1;
  const qnaCount = host.qna ? host.qna.questions.filter((q) => !q.hidden).length : 0;

  const canReveal =
    !host.ended &&
    Boolean(host.activeId) &&
    (host.activeStatus === 'open' || host.activeStatus === 'closed') &&
    !host.audienceSeesResults;
  const canClose = !host.ended && Boolean(host.activeId) && host.activeStatus === 'open';
  const canBlank =
    !host.ended &&
    Boolean(host.activeId) &&
    host.activeStatus !== null &&
    host.activeStatus !== 'pending';

  const stateLine = isTimer
    ? ticking.running
      ? `${clockLabel} running`
      : !host.snapshot?.clock
        ? 'Not started'
        : ticking.overtime
          ? `${clockLabel} over`
          : clockLabel
            ? `Paused · ${clockLabel}`
            : 'Not started'
    : host.activeStatus === 'open'
      ? remaining !== null
        ? `Open · ${formatQuestionLeft(remaining)} left`
        : 'Open'
      : host.activeStatus === 'closed'
        ? 'Closed'
        : host.activeStatus === 'revealed'
          ? 'Results shown'
          : host.ended
            ? 'Session ended'
            : null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[402px] flex-col bg-card px-5 pb-[max(2.75rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <ToastRegion toasts={host.toasts} />

      <header className="flex items-start justify-between gap-2.5 pb-4 pt-1.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <button
            type="button"
            onClick={() => void copyCode()}
            className="text-left text-2xl font-semibold tracking-[0.14em] text-foreground tabular-nums"
            aria-label={`Join code ${host.code}, tap to copy`}
          >
            {host.code}
          </button>
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                'size-2 rounded-full',
                host.status === 'offline' ? 'bg-destructive' : 'bg-live',
              )}
            />
            {copied ? 'Copied' : STATUS_LABEL[host.status]}
            {' · '}
            <span className="tabular-nums">
              {host.counts.joined} joined
              {host.answered > 0 ? ` · ${host.answered} answered` : ''}
            </span>
          </span>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 rounded-full px-2.5"
          disabled={!host.canPresent || host.ended}
          onClick={() => host.setConfirmEnd(true)}
        >
          End
        </Button>
      </header>
      <FacilitationControls snapshot={host.snapshot} run={host.run} />

      <div className="mb-4 flex flex-col gap-1.5 rounded-xl bg-background px-4 py-3.5">
        <span className="text-caption text-muted-foreground">
          Slide {slideCount === 0 ? 0 : slideIndex + 1} of {slideCount} · {stepKindWord(outlineStep?.kind, isQuestion)}
        </span>
        <span className="text-lg font-semibold leading-snug text-pretty">{focusPrompt}</span>
        {stateLine ? (
          <span
            className={cn(
              'text-sm tabular-nums',
              isQuestion && host.activeStatus === 'open'
                ? 'text-live-tint-foreground'
                : 'text-muted-foreground',
            )}
          >
            {stateLine}
          </span>
        ) : null}
        {host.frozen ? <span className="text-sm font-semibold text-destructive">Frozen</span> : null}
      </div>

      <p className="mb-2.5 text-caption text-muted-foreground">For this slide</p>
      {host.snapshot?.listening && outlineStep && 'media' in outlineStep && outlineStep.media?.type === 'audio' ? (
        <ListeningControls disabled={!host.canPresent} key={outlineStep.id} media={outlineStep.media} value={host.snapshot.listening}
          onChange={(next) => host.run({ command: 'listening.set', ...next })} />
      ) : null}
      <div className="flex flex-col gap-2">
        {host.snapshot?.status === 'lobby' && host.flow ? (
          <Button type="button" variant="live" className="h-[52px] rounded-xl text-option font-semibold" onClick={host.flow.go}>
            {host.flow.label}
          </Button>
        ) : isTimer ? (
          <>
            <Button
              type="button"
              variant="live"
              className="h-[52px] rounded-xl text-option font-semibold"
              disabled={!host.canPresent || host.ended || ticking.running}
              onClick={() => void host.run({ command: 'timer.start' })}
            >
              Start the clock
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-xl text-title-bar font-normal"
                disabled={!host.canPresent || host.ended || !ticking.running}
                onClick={() => void host.run({ command: 'timer.pause' })}
              >
                Pause
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-xl text-title-bar font-normal"
                disabled={!host.canPresent || host.ended}
                onClick={() => void host.run({ command: 'timer.adjust', seconds: 60 })}
              >
                +1 min
              </Button>
            </div>
          </>
        ) : isQuestion ? (
          <>
            {canReveal ? (
              <Button
                type="button"
                variant="live"
                className="h-[52px] rounded-xl text-option font-semibold"
                onClick={host.revealActive}
              >
                Reveal the results
              </Button>
            ) : host.flow && host.flow.kind !== 'advance' && host.flow.kind !== 'end' ? (
              <Button
                type="button"
                variant="live"
                className="h-[52px] rounded-xl text-option font-semibold"
                onClick={host.flow.go}
                disabled={!host.canPresent || host.ended}
              >
                {host.flow.label}
              </Button>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-xl text-title-bar font-normal"
                disabled={!host.canPresent || !canClose}
                onClick={host.closeActive}
              >
                Close answers
              </Button>
              {host.canUndoRevote ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 rounded-xl text-title-bar font-normal"
                  onClick={host.undoRevoteActive}
                >
                  First vote
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 rounded-xl text-title-bar font-normal"
                  disabled={!host.canPresent || !host.canRevote}
                  onClick={host.revoteActive}
                >
                  Second vote
                </Button>
              )}
            </div>
          </>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="h-12 rounded-xl text-title-bar font-normal"
          disabled={!host.canPresent || !canBlank}
          onClick={() => {
            if (host.audienceSeesResults) host.hideResultsActive();
            else host.showResultsActive();
          }}
        >
          Blank the screen
        </Button>

        {host.qna ? (
          <Button
            type="button"
            variant="outline"
            className="flex h-12 items-center justify-between rounded-xl px-4 text-title-bar font-normal"
            disabled={!host.canPresent || host.ended}
            onClick={() => host.setQnaStage(host.qna?.stage.mode === 'off' ? 'list' : 'off')}
          >
            <span>Questions</span>
            <span className="inline-flex h-6 items-center rounded-full bg-live-tint px-2.5 text-sm font-semibold text-live-tint-foreground tabular-nums">
              {qnaCount}
            </span>
          </Button>
        ) : null}
      </div>

      <span className="min-h-4 flex-1" />

      <div className="grid grid-cols-2 gap-2.5 border-t border-hairline pt-3.5">
        <Button
          type="button"
          variant="outline"
          className="h-[62px] rounded-xl text-option font-semibold"
          disabled={!host.canPresent || !canBack}
          onClick={prev}
        >
          ← Back
        </Button>
        <Button
          type="button"
          className="h-[62px] rounded-xl bg-foreground text-option font-semibold text-background hover:bg-foreground"
          disabled={!host.canPresent || !canNext}
          onClick={next}
        >
          Next →
        </Button>
      </div>

      <button
        type="button"
        onClick={onOpenLiveHost}
        className="mt-2 text-center text-caption text-muted-foreground hover:text-foreground"
      >
        Open the console
      </button>
      {host.qna ? (
        <button
          type="button"
          onClick={() => void navigate(to.sessionQna(live.sessionCode))}
          className="mt-1 text-center text-caption text-muted-foreground hover:text-foreground"
        >
          Open the Q&A desk
        </button>
      ) : null}

      <EndSessionDialog open={host.confirmEnd} onOpenChange={host.setConfirmEnd} onConfirm={host.endSession} />
    </div>
  );
}
