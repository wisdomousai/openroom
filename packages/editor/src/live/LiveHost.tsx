import { FacilitationControls } from './FacilitationControls';
import { usePresentationKeys } from '../presenter/usePresentationKeys';
import { canAdvanceOutline, canRetreatOutline } from './outline-navigation';
import { useCallback, useEffect, useState } from 'react';
import { useHotkeys } from '@tanstack/react-hotkeys';
import { getTheme, type ThemeId } from '@openroom/ui';
import { deckAspectRatio } from '@openroom/schema';
import {
  isMarkShape,
  type InkColor,
  type MarkShape,
} from '@openroom/sdk';

import { useEditorServices } from '../services';
import { defaultDisplay } from '../builder/displays';
import { ChartMenu, displayMenuLabel } from './ChartMenu';
import { formatClock, formatQuestionLeft, useClosesAt, useSessionClock } from './liveClock';
import { QuestionRailFooter } from './QuestionRailFooter';
import { sessionThemeCommand } from './sdk';
import { EndSessionDialog } from './EndSessionDialog';
import { ToastRegion } from '@openroom/ui/toasts';
import { useTheme } from '@openroom/ui/theme-provider';
import { ThemeStudio } from '@openroom/ui/theme-studio';
import { Alert, AlertDescription } from '@openroom/ui/components/alert';
import { Button } from '@openroom/ui/components/button';
import {
  aggregateOf,
  audienceSeesResults,
  counts as countsOf,
  notesOf,
  displayOf,
  sessionInteraction,
  resultsHiddenOf,
  statusOf,
} from './snapshot';
import {
  LiveInsertDialog,
  type LiveInsertDraft,
  type LiveInsertKind,
} from './LiveInsertDialog';
import { LiveRibbon } from './LiveRibbon';
import { MeaningBreakout } from './MeaningBreakout';
import { useHostSession } from './useHostSession';
import { useQuestionRail } from './useQuestionRail';
import { HostHeader } from './HostHeader';
import { PlateInkMenu } from './PlateInkMenu';
import { SessionAside } from './SessionAside';
import { GroupsPanel } from './GroupsPanel';
import { resolveEndedExit } from './session-exit';
import { useSessionExit } from './useSessionExit';
import { useMeaningLookup } from './useMeaningLookup';
import { ListeningControls } from './ListeningControls';
import { useStageMirror } from './useStageMirror';
import {
  answeredKey,
  entriesOf,
  hasCorrectAnswer,
  readAnswered,
  stepLabel,
} from './utils';
import type {
  InteractionStatus,
  StoredSession,
  TextEntry,
} from '../types';

export function LiveHost({ live, onLeave, onReturnToDeck, onPosition }: {
  live: StoredSession; onLeave: () => void;
  onReturnToDeck?: () => void;
  onPosition?: (position: { stepId: string; shown: number }) => void;
}) {
  const services = useEditorServices();
  const { navigate } = services.navigation;
  const { StageView } = services.live;
  const { scratchpad: scratchpadSlot, languagePair: languagePairSlot, SavedResults } = services.slots;
  const host = useHostSession(live);
  const {
    snapshot,
    canPresent,
    status,
    fatal,
    toasts,
    push,
    run,
    session,
    items,
    activeId,
    ended,
    frozen,
    flow,
    confirmEnd,
    setConfirmEnd,
    toggleFreeze,
    endSession,
    openInteraction,
    hideResultsActive,
    revealActive,
    closeActive,
    canRevote,
    canUndoRevote,
    revoteActive,
    undoRevoteActive,
    qna,
    toggleQnaHidden,
    setQnaStage,
  } = host;

  const [pendingTheme, setPendingTheme] = useState<ThemeId | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [drawTool, setDrawTool] = useState<'none' | MarkShape | 'pen'>('none');
  /** The word a right-click landed on: the plate menu acts on exactly this. */
  const [markTarget, setMarkTarget] = useState<{
    partKey: string;
    token: number;
    word: string;
    endToken?: number;
  } | null>(null);
  const [inkColor, setInkColor] = useState<InkColor>('red');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [insertKind, setInsertKind] = useState<LiveInsertKind | null>(null);
  const [insertMode, setInsertMode] = useState<'insert' | 'edit'>('insert');
  const [insertInitial, setInsertInitial] = useState<LiveInsertDraft | null>(null);
  const [ribbonTab, setRibbonTab] = useState('home');
  const [chartMenu, setChartMenu] = useState<{ x: number; y: number } | null>(null);
  const [showPercent, setShowPercent] = useState(false);
  const [answeredQna, setAnsweredQna] = useState(() => readAnswered(live.sessionCode));
  const theme = useTheme();

  /*
   * The context probe, the deck's place in the Library, and the end-of-session
   * hand-off all live in one hook shared with the remote and the Q&A desk.
   * `context === undefined` while the probe is in flight: ending the session
   * before we know the durable id must not clear the notes as lost.
   */
  const exit = useSessionExit(live, ended);
  // Inside the desktop document window the live console must route back to the
  // deck, never into the web workspace shell (whose sign-in gate the local
  // origin cannot pass). A session started from the desktop workspace window
  // has no such document, and the file view there fails to open one, so that
  // window takes the same route back to the library as the browser does.
  // `null` until the shell answers, so the exit control never renders the wrong
  // destination for a frame.
  const bridge = services.desktop;
  const [documentWindow, setDocumentWindow] = useState<boolean | null>(bridge === null ? false : null);
  useEffect(() => {
    if (bridge === null) return;
    let cancelled = false;
    bridge.hasDocument()
      .then((bound) => {
        if (!cancelled) setDocumentWindow(bound);
      })
      .catch(() => {
        /* an older shell without the check is treated as the workspace window */
        if (!cancelled) setDocumentWindow(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);
  const backToDeck = useCallback(() => {
    /*
     * The desktop shell owns the document window's deck view, and that window
     * must route back to the deck rather than into the web workspace shell.
     */
    if (onReturnToDeck) onReturnToDeck();
    else navigate({ kind: 'deckDocument' });
  }, [navigate, onReturnToDeck]);
  const [pickupDismissed, setPickupDismissed] = useState(false);

  /**
   * Ending a session is not a state the console sits in: it forwards to the
   * session's Notes (or to the Library when there is nothing to write). The
   * navigation replaces, so no dead console URL is left in history.
   */
  const exitDecision = resolveEndedExit({ ended, documentWindow, probe: exit.probe });
  const exitKind = exitDecision.kind;
  const exitSessionId = exitDecision.kind === 'notes' ? exitDecision.sessionId : null;
  useEffect(() => {
    if (exitKind === 'notes' && exitSessionId !== null) {
      navigate({ kind: 'sessionNotes', sessionId: exitSessionId }, { replace: true });
      return;
    }
    if (exitKind === 'library') {
      navigate({ kind: 'library' }, { replace: true });
    }
  }, [exitKind, exitSessionId, navigate]);

  /** Exact projector feed — same role/snapshot the /stage/ app uses. */
  const { stageToken, stageSnapshot, stageStatus, retryStageToken } = useStageMirror(live);

  const sessionTheme = snapshot?.theme;
  const { setSessionThemeId } = theme;
  useEffect(() => {
    setSessionThemeId(sessionTheme ?? null);
  }, [sessionTheme, setSessionThemeId]);
  useEffect(() => () => setSessionThemeId(null), [setSessionThemeId]);
  useEffect(() => {
    if (pendingTheme && sessionTheme === pendingTheme) setPendingTheme(null);
  }, [pendingTheme, sessionTheme]);

  const {
    selectedId,
    setSelectedId,
    selected,
    selectedIndex,
    focusId,
    canOpenOnStage,
  } = useQuestionRail({ items, activeId, ended, snapshot });

  const outline = snapshot?.outline;
  const outlineIndex = outline?.currentStepIndex ?? 0;
  const outlineSteps = outline?.content.steps ?? [];
  const outlineStep = outlineSteps[outlineIndex];
  useEffect(() => {
    if (outlineStep) onPosition?.({ stepId: outlineStep.id, shown: outline?.shownGroups ?? 1 });
  }, [outlineStep?.id, outline?.shownGroups, onPosition]);
  useEffect(() => {
    if (!onReturnToDeck) return;
    return bridge?.onPresentationCommand((command) => {
      if (command === 'close') onReturnToDeck();
      else if (!ended && (command === 'next' ? canAdvanceOutline(outline) : canRetreatOutline(outline))) {
        void run({ command: command === 'next' ? 'outline.next' : 'outline.previous' });
      }
    });
  }, [bridge, ended, onReturnToDeck, outline, run]);


  /** Rail select puts the question on stage when the session is live. */
  const showQuestion = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (id !== activeId && canOpenOnStage(id)) {
        openInteraction(id);
      }
    },
    [activeId, canOpenOnStage, openInteraction, setSelectedId],
  );

  const prevQuestion = useCallback(() => {
    const item = items[selectedIndex - 1];
    if (item) showQuestion(item.id);
  }, [items, selectedIndex, showQuestion]);

  const nextQuestion = useCallback(() => {
    const item = items[selectedIndex + 1];
    if (item) showQuestion(item.id);
  }, [items, selectedIndex, showQuestion]);

  const previous = useCallback(() => {
    if (outline) {
      if (canRetreatOutline(outline)) void run({ command: 'outline.previous' });
      return;
    }
    prevQuestion();
  }, [outline, outlineIndex, prevQuestion, run]);

  const next = useCallback(() => {
    if (outline) {
      if (canAdvanceOutline(outline)) void run({ command: 'outline.next' });
      return;
    }
    nextQuestion();
  }, [outline, outlineIndex, outlineSteps.length, nextQuestion, run]);

  usePresentationKeys({ enabled: canPresent && Boolean(onReturnToDeck) && !ended, next, previous, close: () => onReturnToDeck?.() });

  // Outline-aware labels/actions live in deriveHostFlow (shared with PresenterRemote).
  // Reveal still wins over "Next step" when results are hidden.
  const primaryLabel = flow?.label ?? null;
  const primaryGo = useCallback(() => {
    flow?.go();
  }, [flow]);

  const focus = focusId ? items.find((i) => i.id === focusId) ?? selected : selected;
  const focusStatus: InteractionStatus = focusId ? statusOf(snapshot, focusId) : 'pending';
  const focusAggregate = focusId ? aggregateOf(snapshot, focusId) : undefined;
  const focusInteraction = sessionInteraction(session, focusId);
  const onStage = Boolean(activeId && focusId === activeId);
  const audienceSees = audienceSeesResults(snapshot, session, focusId);

  const hideResults = useCallback(() => {
    if (focusId && focusId === activeId) hideResultsActive();
    else if (focusId) void run({ command: 'interaction.hideResults', interactionId: focusId });
  }, [focusId, activeId, hideResultsActive, run]);

  const markQnaAnswered = useCallback(
    (questionId: string) => {
      setAnsweredQna((prev) => {
        const next = new Set(prev);
        next.add(questionId);
        try {
          sessionStorage.setItem(answeredKey(live.sessionCode), JSON.stringify([...next]));
        } catch {
          /* private to this device */
        }
        return next;
      });
      toggleQnaHidden(questionId, false);
    },
    [live.sessionCode, toggleQnaHidden],
  );

  const showResults = useCallback(() => {
    const resultsHidden = resultsHiddenOf(snapshot, focusId);
    if (focusId && focusId === activeId) revealActive();
    else if (focusId) {
      if (resultsHidden) {
        void run({ command: 'interaction.showResults', interactionId: focusId });
      } else {
        void run({ command: 'interaction.reveal', interactionId: focusId });
      }
    }
  }, [focusId, activeId, revealActive, snapshot, run]);

  const pickTheme = useCallback(
    (id: ThemeId) => {
      if (ended) return;
      setPendingTheme(id);
      void run(sessionThemeCommand(id)).then((ok) => {
        if (ok) push(`Theme: ${getTheme(id).name}`);
        else setPendingTheme(null);
      });
    },
    [ended, run, push],
  );

  const canHideResults =
    !ended && onStage && (focusStatus === 'open' || focusStatus === 'closed' || focusStatus === 'revealed') && audienceSees;
  const canShowResults =
    !ended &&
    onStage &&
    (focusStatus === 'open' || focusStatus === 'closed' || focusStatus === 'revealed') &&
    !audienceSees;

  // ---- keyboard shortcuts -------------------------------------------------
  useHotkeys([
    { hotkey: 'Space', callback: primaryGo, options: { enabled: canPresent && !onReturnToDeck && !ended && Boolean(primaryLabel) } },
    { hotkey: 'ArrowLeft', callback: previous, options: { enabled: canPresent && !onReturnToDeck } },
    { hotkey: 'ArrowRight', callback: next, options: { enabled: canPresent && !onReturnToDeck } },
    {
      hotkey: 'H',
      callback: () => { if (canHideResults) hideResults(); else showResults(); },
      options: { enabled: canPresent && (canHideResults || canShowResults) },
    },
    { hotkey: 'F', callback: toggleFreeze, options: { enabled: canPresent && !ended } },
  ], {
    ignoreInputs: true,
    preventDefault: true,
    stopPropagation: true,
    conflictBehavior: 'replace',
  });

  const code = snapshot?.code ?? live.code;
  const joinUrl = services.live.joinUrl(code, snapshot?.joinUrl ?? live.joinUrl);
  const { joined, answered } = countsOf(snapshot);

  const learner = exit.context?.context ?? null;
  const identified = snapshot?.outline?.content?.defaults?.identityMode === 'identified';

  /**
   * An identified session is entered with a personal access link, so a join
   * code on the tutor's screen buys nothing and invites bystanders. It is not
   * shown anywhere in this console for such a session — not in the header, not
   * in the rail, not in the menu.
   */
  const showCode = !identified;

  /** Put one shape over a word or a span, in the colour the ribbon is showing. */
  const applyShape = useCallback(
    (
      shape: MarkShape,
      target: { partKey: string; token: number; endToken?: number },
    ) => {
      void run({
        command: 'mark.set',
        mark: {
          kind: shape,
          partKey: target.partKey,
          token: target.token,
          ...(target.endToken === undefined ? {} : { endToken: target.endToken }),
          color: inkColor,
        },
      });
    },
    [run, inkColor],
  );

  const lookupFlow = useMeaningLookup({ sessionCode: live.sessionCode, snapshot, run });

  /*
   * Private scratchpad. Held in this browser, keyed by join code, never sent
   * anywhere; handed to the notes form as a prefill when the session ends. See
   * ./scratchpad.ts for why the live console composes no record.
   *
   * Named `scratchpad` deliberately — further down, `notes` is the interaction's
   * host-only pedagogy note from the session document, a different thing.
   */
  const [scratchpad, setScratchpad] = useState(() => scratchpadSlot?.read(live.sessionCode) ?? '');
  useEffect(() => {
    setScratchpad(scratchpadSlot?.read(live.sessionCode) ?? '');
  }, [scratchpadSlot, live.sessionCode]);
  const updateScratchpad = useCallback(
    (text: string) => {
      setScratchpad(text);
      scratchpadSlot?.write(live.sessionCode, text);
    },
    [scratchpadSlot, live.sessionCode],
  );
  const saveSession = services.live.sessions.save;
  useEffect(() => {
    if (snapshot?.code && snapshot.code !== live.code) {
      saveSession({ ...live, code: snapshot.code });
    }
  }, [saveSession, snapshot?.code, live]);

  const copyJoin = useCallback(() => {
    const write = navigator.clipboard?.writeText?.(joinUrl);
    if (write) {
      void write.then(
        () => push('Join link copied'),
        () => push(joinUrl, 'warn'),
      );
    } else {
      push(joinUrl, 'warn');
    }
  }, [joinUrl, push]);

  const { downloadExport } = services.live;
  const doExport = useCallback(
    (format: 'csv' | 'json' | 'ballots') => {
      downloadExport(live.sessionCode, live.hostToken, format).catch((err: unknown) => {
        push(err instanceof Error ? err.message : 'Export failed', 'error');
      });
    },
    [downloadExport, live.sessionCode, live.hostToken, push],
  );

  const toggleEntry = useCallback(
    (interactionId: string, entry: TextEntry) => {
      void run({
        command: entry.hidden ? 'text.unhide' : 'text.hide',
        interactionId,
        participantId: entry.participantId,
      });
    },
    [run],
  );

  const ticking = useSessionClock(snapshot?.clock);
  const questionLeft = useClosesAt(snapshot?.closesAt);

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

  /*
   * Ended, and on its way out. The console never shows its dead self: it says
   * what happened and opens the Notes. A probe that failed keeps the notes and
   * the credentials where they are and offers the two ways forward.
   */
  if (exitKind === 'wait' || exitKind === 'retry' || exitKind === 'notes' || exitKind === 'library') {
    return (
      <div className="flex h-svh flex-col items-center justify-center gap-4 bg-desk p-6 text-center">
        <p className="text-section">Session ended</p>
        {exitKind === 'retry' ? (
          <div className="flex gap-2">
            <Button onClick={exit.retryProbe}>Retry</Button>
            <Button
              variant="outline"
              onClick={() =>
                navigate({ kind: 'library', place: exit.deckPlace }, { replace: true })
              }
            >
              Library
            </Button>
          </div>
        ) : (
          <p className="text-secondary text-muted-foreground">Opening notes…</p>
        )}
        <ToastRegion toasts={toasts} />
      </div>
    );
  }

  const showEntries =
    focus && (focus.type === 'text' || focus.type === 'qna') ? entriesOf(focusAggregate) : null;
  const notes = focus ? (notesOf(session, focus.id) ?? focus.notes) : undefined;
  const pedagogy = focusInteraction?.pedagogy;
  const activeThemeName = getTheme(theme.activeThemeId).name;
  const isWordCloud = focusInteraction?.display === 'word-cloud';

  const timerStep = outlineStep?.kind === 'timer' ? outlineStep : null;
  const clockLabel = ticking.label ?? (timerStep ? formatClock(timerStep.seconds) : null);
  const clockRunning = ticking.running;
  const currentDisplay =
    displayOf(snapshot, focusId) ??
    focusInteraction?.display ??
    (focus ? defaultDisplay(focus.type) : undefined);
  const onQuestionSlide =
    outlineStep?.kind === 'interaction' || (!outline && Boolean(focus));
  const chartMenuEnabled = canPresent && onQuestionSlide && onStage && Boolean(focus) && !ended;
  const sessionTitle = [learner?.displayName, outline?.content.meta.title ?? session?.meta?.title]
    .filter(Boolean)
    .join(' / ');

  const footerItems = outline
    ? outlineSteps.map((step, index) => ({
        id: step.id,
        label: stepLabel(step),
        visited: index < outlineIndex,
      }))
    : items.map((item, index) => ({
        id: item.id,
        label: item.prompt,
        visited: index < selectedIndex,
      }));
  const footerSelectedId = outline ? (outlineStep?.id ?? null) : selectedId;
  const footerSelectedIndex = outline ? outlineIndex : selectedIndex;
  const footerActiveId = outline ? (outlineStep?.id ?? null) : activeId;

  const footerStatus = [
    outline
      ? `Slide ${outlineIndex + 1} of ${outlineSteps.length}`
      : items.length > 0
        ? `Slide ${selectedIndex + 1} of ${items.length}`
        : null,
    onQuestionSlide && focusStatus === 'open'
      ? 'question open'
      : onQuestionSlide && focusStatus === 'closed'
        ? 'question closed'
        : onQuestionSlide && focusStatus === 'revealed'
          ? 'results up'
          : timerStep
            ? ticking.running
              ? 'clock running'
              : 'timer'
            : null,
    questionLeft !== null ? `${formatQuestionLeft(questionLeft)} left` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const goFooterSelect = (id: string) => {
    if (outline) {
      void run({ command: 'outline.goto', stepId: id });
      return;
    }
    showQuestion(id);
  };

  const pickup = learner?.nextNote?.trim() ?? '';

  return (
    <div className="flex h-svh flex-col bg-desk">
      <HostHeader
        canPresent={canPresent}
        onReturnToDeck={onReturnToDeck}
        status={status}
        code={code}
        showCode={showCode}
        learnerName={learner?.displayName}
        sessionTitle={sessionTitle}
        joined={joined}
        participantLimit={snapshot?.participantLimit}
        canManagePlan={exit.canEdit}
        answered={answered}
        groupAnswers={snapshot?.interaction?.responseMode === 'group'}
        frozen={frozen}
        ended={ended}
        onToggleFreeze={toggleFreeze}
        onEndSession={() => setConfirmEnd(true)}
        joinUrl={joinUrl}
        onCopyJoin={copyJoin}
        sessionCode={live.sessionCode}
        hostToken={live.hostToken}
        stageToken={stageToken}
        onStageRetry={() => {
          retryStageToken();
          push('Stage link unavailable — retrying');
        }}
        hasQna={qna !== null}
        activeThemeName={activeThemeName}
        onOpenTheme={() => setThemeOpen(true)}
        onExport={doExport}
        documentWindow={documentWindow}
        libraryPlace={exit.deckPlace}
        onBackToDeck={backToDeck}
        push={push}
      />
      {pickup !== '' && !pickupDismissed && !ended ? (
        <div className="flex items-start justify-between gap-3 border-b border-hairline bg-card px-4 py-2">
          <p className="text-secondary">
            <span className="text-caption text-muted-foreground">Next session · </span>
            {pickup}
          </p>
          <button
            type="button"
            className="text-caption text-muted-foreground hover:text-foreground"
            onClick={() => setPickupDismissed(true)}
          >
            Hide
          </button>
        </div>
      ) : null}

      {frozen && !ended ? (
        <Alert variant="destructive" role="status" className="shrink-0 rounded-none">
          <AlertDescription>
            Frozen. Submissions are blocked and participant text is hidden on stage.
          </AlertDescription>
        </Alert>
      ) : null}
      {/*
        The desktop document window is the one surface that stays put after the
        hour: an outline session has no durable row, so there is no Notes page
        to open, and Export must stay reachable.
      */}
      {exitKind === 'desktop-ended' || (ended && onReturnToDeck) ? (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline bg-card px-4 py-3"
        >
          <p className="text-sm font-semibold">Session ended</p>
          <span className="flex-1" />
          {SavedResults ? <SavedResults sessionCode={live.sessionCode} /> : null}
          <Button size="sm" variant="outline" onClick={() => doExport('csv')}>
            Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={backToDeck}>
            Back to deck
          </Button>
        </div>
      ) : null}

      <FacilitationControls snapshot={snapshot} run={run} />
      {!ended ? (
        <fieldset disabled={!canPresent} className="min-w-0 border-0 p-0 disabled:opacity-60"><LiveRibbon
          tab={ribbonTab}
          onTabChange={setRibbonTab}
          canBack={outline ? canRetreatOutline(outline) : selectedIndex > 0}
          canNext={outline ? canAdvanceOutline(outline) : selectedIndex < items.length - 1}
          onBack={previous}
          onNext={next}
          canClose={Boolean(activeId) && focusStatus === 'open'}
          onClose={() => closeActive()}
          resultsUp={audienceSees && (focusStatus === 'open' || focusStatus === 'closed' || focusStatus === 'revealed')}
          canRevote={canRevote}
          onRevote={revoteActive}
          canUndoRevote={canUndoRevote}
          onUndoRevote={undoRevoteActive}
          currentDisplayLabel={
            chartMenuEnabled && currentDisplay ? displayMenuLabel(currentDisplay) : null
          }
          onOpenChartMenu={(anchor) => {
            const box = anchor.getBoundingClientRect();
            setChartMenu({ x: box.left, y: box.bottom + 4 });
          }}
          correctShown={focusStatus === 'revealed'}
          hasCorrect={hasCorrectAnswer(focusInteraction)}
          canReveal={Boolean(activeId) && (focusStatus === 'open' || focusStatus === 'closed')}
          onReveal={showResults}
          canBlank={canHideResults || canShowResults}
          blanked={!audienceSees && (focusStatus === 'open' || focusStatus === 'closed' || focusStatus === 'revealed')}
          onBlank={() => {
            if (canHideResults) hideResults();
            else if (canShowResults) showResults();
          }}
          canInsert={Boolean(outline) && !ended}
          onInsert={(kind) => {
            if (kind === 'library') {
              setLibraryOpen(true);
              return;
            }
            setInsertMode('insert');
            setInsertInitial(null);
            setInsertKind(kind);
          }}
          canChangeSlide={
            outlineStep !== undefined &&
            (outlineStep.kind === 'term' || outlineStep.kind === 'statement')
          }
          onChangeSlide={() => {
            if (outlineStep === undefined) return;
            if (outlineStep.kind === 'term') {
              setInsertMode('edit');
              setInsertInitial({
                kind: 'term',
                term: outlineStep.term,
                meaning: outlineStep.meaning,
              });
              setInsertKind('term');
              return;
            }
            if (outlineStep.kind === 'statement') {
              setInsertMode('edit');
              setInsertInitial({
                kind: 'statement',
                title: outlineStep.title ?? '',
                body: outlineStep.body ?? '',
              });
              setInsertKind('statement');
            }
          }}
          drawTool={drawTool}
          onDrawTool={setDrawTool}
          inkColor={inkColor}
          onInkColor={setInkColor}
          onClearMarks={() => void run({ command: 'mark.clear' })}
          lookUpArmed={lookupFlow.lookUpArmed}
          onLookUp={lookupFlow.toggleArmed}
          canReopenCard={lookupFlow.lookup !== null && !lookupFlow.cardOpen}
          onReopenCard={lookupFlow.openCard}
          clock={
            timerStep && clockLabel
              ? { label: clockLabel, running: clockRunning }
              : null
          }
          onClockStart={() => void run({ command: 'timer.start' })}
          onClockPause={() => void run({ command: 'timer.pause' })}
          onClockReset={() => void run({ command: 'timer.reset' })}
          onClockAdjust={(seconds) => void run({ command: 'timer.adjust', seconds })}
          onPresenterView={() => {
            navigate({ kind: 'sessionRemote', sessionCode: live.sessionCode });
          }}
        /></fieldset>
      ) : null}

      <LiveInsertDialog
        open={insertKind !== null}
        kind={insertKind}
        mode={insertMode}
        initial={insertInitial}
        onOpenChange={(open) => {
          if (!open) {
            setInsertKind(null);
            setInsertInitial(null);
          }
        }}
        onConfirm={(draft) => {
          const parent = outlineStep;
          const breakoutOf =
            insertMode === 'insert' && parent && parent.breakoutOf === undefined
              ? { stepId: parent.id, afterKey: 'header' as const }
              : undefined;
          const id =
            insertMode === 'edit' && outlineStep
              ? outlineStep.id
              : `${draft.kind}-${Date.now().toString(36)}`;

          if (draft.kind === 'term') {
            const step = {
              id,
              kind: 'term' as const,
              term: draft.term.trim(),
              meaning: draft.meaning.trim(),
              ...(breakoutOf === undefined ? {} : { breakoutOf }),
            };
            if (insertMode === 'edit') {
              void run({ command: 'outline.replace', stepId: id, step });
            } else {
              void run({ command: 'outline.insert', step, show: true });
            }
            return;
          }

          if (draft.kind === 'statement') {
            const step = {
              id,
              kind: 'statement' as const,
              title: draft.title.trim(),
              body: draft.body.trim(),
              ...(breakoutOf === undefined ? {} : { breakoutOf }),
            };
            if (insertMode === 'edit') {
              void run({ command: 'outline.replace', stepId: id, step });
            } else {
              void run({ command: 'outline.insert', step, show: true });
            }
            return;
          }

          // Question: new choice poll + interaction step (insert only).
          const filled = draft.options
            .map((label) => label.trim())
            .filter((label) => label !== '');
          const interactionId = `live-q-${Date.now().toString(36)}`;
          const interaction = {
            id: interactionId,
            type: 'choice' as const,
            prompt: draft.prompt.trim(),
            options: filled.map((label, index) => ({
              id: `o${index + 1}`,
              label,
            })),
          };
          const step = {
            id: `step-${interactionId}`,
            kind: 'interaction' as const,
            interactionId,
            title: draft.prompt.trim(),
            ...(breakoutOf === undefined ? {} : { breakoutOf }),
          };
          void run({ command: 'outline.insert', step, interaction, show: true });
        }}
      />

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-desk">
          {!snapshot ? (
            <p className="p-6 text-sm text-muted-foreground">Loading session…</p>
          ) : !stageToken ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-5" style={{ containerType: 'size' }}>
              <div
                className="stage-mirror relative overflow-hidden rounded-lg bg-card shadow-[var(--shadow-page)] cursor-context-menu"
                style={{
                  aspectRatio: deckAspectRatio(stageSnapshot?.outline?.design?.aspectRatio ?? '16:9'),
                  width: `min(100%, 820px, calc(100cqh * ${deckAspectRatio(stageSnapshot?.outline?.design?.aspectRatio ?? '16:9')}))`,
                }}
                onContextMenu={
                  chartMenuEnabled
                    ? (event) => {
                        event.preventDefault();
                        setChartMenu({ x: event.clientX, y: event.clientY });
                      }
                    : undefined
                }
              >
                <PlateInkMenu
                  active={canPresent && !chartMenuEnabled && Boolean(outlineStep) && !ended}
                  tool={drawTool}
                  onTool={setDrawTool}
                  color={inkColor}
                  onColor={setInkColor}
                  onClear={() => void run({ command: 'mark.clear' })}
                  target={markTarget}
                  onShape={applyShape}
                  onLookUp={lookupFlow.lookUpWord}
                >
                  <StageView
                    snapshot={stageSnapshot}
                    status={stageStatus}
                    embedded
                    hideRail
                    hideMeaning={lookupFlow.lookUpArmed}
                    drawTool={canPresent ? (lookupFlow.lookUpArmed ? 'circle' : drawTool) : 'none'}
                    inkColor={inkColor}
                    track={canPresent && Boolean(outlineStep) && !ended}
                    onTarget={setMarkTarget}
                    onErase={
                      canPresent && Boolean(outlineStep) && !ended ? (id) => void run({ command: 'mark.remove', id }) : undefined
                    }
                    onCircle={(partKey, token, word, endToken) => {
                      const shape: MarkShape = isMarkShape(drawTool) ? drawTool : 'circle';
                      applyShape(shape, { partKey, token, endToken });
                      if (lookupFlow.lookUpArmed) lookupFlow.lookUpWord({ partKey, token, word });
                    }}
                    onStroke={(points) =>
                      void run({ command: 'mark.set', mark: { kind: 'pen', points, color: inkColor } })
                    }
                  />
                </PlateInkMenu>
                {lookupFlow.lookUpArmed && (snapshot.meaning || snapshot.dictionary) ? (
                  <p role="status" className="pointer-events-none absolute inset-x-4 bottom-3 z-10 rounded-md bg-card/95 px-3 py-2 text-center text-sm shadow-sm">
                    Choose a word. The current card stays on the audience’s screen.
                  </p>
                ) : null}
                {(() => {
                  const activeLookup = lookupFlow.lookup;
                  if (!(lookupFlow.cardOpen && activeLookup !== null && !ended)) {
                    return null;
                  }
                  return (
                  <MeaningBreakout
                    lookup={activeLookup}
                    chosen={lookupFlow.chosen}
                    onChosen={lookupFlow.setChosen}
                    screenLabel={
                      learner?.displayName ? `${learner.displayName}’s screen` : 'their screen'
                    }
                    pushed={lookupFlow.pushedHere}
                    hasPublished={lookupFlow.hasPublishedHere}
                    canPublish={lookupFlow.canPublish}
                    publishing={lookupFlow.publishing}
                    publishError={lookupFlow.publishError}
                    selectedSections={lookupFlow.sections}
                    onSections={lookupFlow.setSections}
                    onPush={lookupFlow.pushCard}
                    onTakeDown={lookupFlow.takeDownCard}
                    canAddSlide={Boolean(outline) && lookupFlow.chosen.trim() !== ''}
                    onAddSlide={() => {
                      const target = lookupFlow.lookUpTarget;
                      const text = lookupFlow.chosen.trim();
                      if (target === null || text === '') return;
                      const parent = outlineStep;
                      const breakoutOf =
                        parent && parent.breakoutOf === undefined
                          ? { stepId: parent.id, afterKey: 'header' as const }
                          : undefined;
                      void run({
                        command: 'outline.insert',
                        step: {
                          id: `term-${Date.now().toString(36)}`,
                          kind: 'term',
                          term:
                            activeLookup.kind === 'entry'
                              ? activeLookup.entry.lemma
                              : target.word,
                          meaning: text,
                          ...(breakoutOf === undefined ? {} : { breakoutOf }),
                        },
                      });
                    }}
                    onClose={lookupFlow.closeCard}
                    pairFields={
                      languagePairSlot ? (
                        <languagePairSlot.Fields
                          pair={lookupFlow.languagePair}
                          disabled={lookupFlow.pairSaving}
                          idPrefix="live-pair"
                          className="flex flex-wrap gap-4"
                          triggerClassName="w-[14rem]"
                        />
                      ) : null
                    }
                    pairComplete={lookupFlow.languagePair.complete}
                    pairSaving={lookupFlow.pairSaving}
                    onSavePair={lookupFlow.savePair}
                    onTypeInstead={() => lookupFlow.typeInstead(activeLookup.word)}
                  />
                  );
                })()}
              </div>
            </div>
          )}
        </main>

        <SessionAside
          canPresent={canPresent}
          groupControls={snapshot && (outline?.content.interactions.some((item) => item.responseMode === 'group') || snapshot.groups?.length) ?
            <GroupsPanel snapshot={snapshot} run={run} ended={ended} /> : null}
          liveControls={snapshot?.listening && outlineStep && 'media' in outlineStep && outlineStep.media?.type === 'audio' ? (
            <ListeningControls disabled={!canPresent} key={outlineStep.id} media={outlineStep.media} value={snapshot.listening}
              onChange={(next) => run({ command: 'listening.set', ...next })} />
          ) : null}
          outline={outline}
          items={items}
          selectedId={selectedId}
          onSelectStep={(stepId) => void run({ command: 'outline.goto', stepId })}
          onSelectItem={showQuestion}
          entries={showEntries}
          isWordCloud={isWordCloud}
          handles={{ ...snapshot?.handles, ...snapshot?.responseNames }}
          ended={ended}
          onToggleEntry={(entry) => {
            if (focus) toggleEntry(focus.id, entry);
          }}
          notesText={
            (outlineStep && 'tutorNotes' in outlineStep && outlineStep.tutorNotes
              ? outlineStep.tutorNotes
              : undefined) ??
            notes ??
            pedagogy?.explanation
          }
          scratchpad={scratchpadSlot ? scratchpad : undefined}
          onScratchpadChange={updateScratchpad}
          qna={qna}
          answeredQna={answeredQna}
          onMarkAnswered={markQnaAnswered}
          onToggleHidden={toggleQnaHidden}
          onSetStage={setQnaStage}
        />
      </div>

      <fieldset disabled={!canPresent} className="min-w-0 border-0 p-0 disabled:opacity-60"><QuestionRailFooter
        canPrev={outline ? canRetreatOutline(outline) : undefined}
        canNext={outline ? canAdvanceOutline(outline) : undefined}
        items={footerItems}
        activeId={footerActiveId}
        selectedId={footerSelectedId}
        selectedIndex={footerSelectedIndex}
        onPrev={previous}
        onNext={next}
        onSelect={goFooterSelect}
        status={
          <>
            {footerStatus}
            {(snapshot?.clock || timerStep) && clockLabel ? (
              <span className="ml-2 inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-live" />
                {clockLabel} on stage
              </span>
            ) : null}
          </>
        }
        actions={
          primaryLabel ? (
            <Button type="button" variant="live" size="sm" className="h-[34px] px-[18px]" onClick={primaryGo}>
              {primaryLabel}
            </Button>
          ) : null
        }
      /></fieldset>

      {canPresent && chartMenu && chartMenuEnabled && focus ? (
        <ChartMenu
          type={focus.type}
          current={currentDisplay}
          correctShown={focusStatus === 'revealed'}
          showPercent={showPercent || focusInteraction?.displayOptions?.showPercent === true}
          hasCorrect={hasCorrectAnswer(focusInteraction)}
          x={chartMenu.x}
          y={chartMenu.y}
          onPick={(display) => {
            void run({ command: 'session.display', display });
            setChartMenu(null);
          }}
          onCallOut={() => {
            showResults();
            setChartMenu(null);
          }}
          onTogglePercent={() => setShowPercent((value) => !value)}
          onClose={() => setChartMenu(null)}
        />
      ) : null}

      <ThemeStudio
        sessionThemeId={theme.sessionThemeId}
        onPickSessionTheme={ended || !canPresent ? undefined : pickTheme}
        pendingThemeId={pendingTheme}
        open={themeOpen}
        onOpenChange={setThemeOpen}
      />

      <EndSessionDialog open={confirmEnd} onOpenChange={setConfirmEnd} onConfirm={endSession} />

      <ToastRegion toasts={toasts} />
    </div>
  );
}
