/**
 * The projector surface as a React tree — shared by `/stage/` and LiveHost.
 * Pass a stage-role snapshot so aggregates blank exactly when the session blanks.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import type {
  ConnectionStatus,
  InkColor,
  LearnerOutlineStep,
  MarkShape,
  StageSnapshot,
} from '@openroom/sdk';
import { ClockPill, MeaningCard, QrCode, StepLayout, SlideSurface, type SlideSpanStyle } from '@openroom/slides';
import { useActivity, usePageVisible, useReducedMotion } from './hooks';
import { useAppliedTheme, useThemeMode } from './theme';
import { detectWebGL, shouldRenderAmbient } from './webgl';
import { EASE, SECONDS, dur, stagger } from './motion';
import { beatStateOf, beatTitle, detectBeat, shouldCelebrate, type Beat, type BeatState } from './choreography';
import { cornerClockVisible, formatCountdown, useCountdown } from './countdown';
import { AmbientLayer } from './layers/ambient';
import { MomentLayer } from './layers/moment';
import { AggregateChart } from '@openroom/charts';
import { AnimatedNumber } from './viz/common';
import { Visualization } from './viz';
import { deckAspectRatio, fillTheGapsPromptText, seededShuffle } from '@openroom/schema';
import { InkOverlay, TokenLine } from './ink';

/** True while the host has put session Q&A on the projector (list or spotlight). */
function qnaCovering(snapshot: StageSnapshot | null): boolean {
  return (
    snapshot !== null &&
    snapshot.status === 'live' &&
    snapshot.qna !== undefined &&
    snapshot.qna.stage.mode !== 'off'
  );
}

interface Moment {
  beat: Beat | null;
  token: number;
  title: string;
  celebrate: boolean;
}

const QUIET: Moment = { beat: null, token: 0, title: '', celebrate: false };

export function resolveJoinUrl(snapshot: StageSnapshot | null, code: string): string {
  const local = localJoinUrl(code);
  const server = snapshot?.joinUrl;
  if (server == null || server === '') return local;
  try {
    const absolute = new URL(server, location.origin);
    if (joinUrlMatchesEnvironment(absolute)) return absolute.toString();
    return local;
  } catch {
    return local;
  }
}

function localJoinUrl(code: string): string {
  const host = location.hostname;
  if (host === 'openroom.app' || host === 'www.openroom.app') {
    return `https://join.openroom.app/?code=${encodeURIComponent(code)}`;
  }
  if (host === 'join.openroom.app' || host.startsWith('join.')) {
    return `${location.origin}/?code=${encodeURIComponent(code)}`;
  }
  // Local wrangler / workers.dev: participant SPA is path-mounted at /join/.
  return `${location.origin}/join/?code=${encodeURIComponent(code)}`;
}

/** True when `url` is a join link for the host we are currently on. */
function joinUrlMatchesEnvironment(url: URL): boolean {
  if (url.origin === location.origin) return true;
  const page = location.hostname;
  const join = url.hostname;
  const pageMarketing = page === 'openroom.app' || page === 'www.openroom.app';
  const pageJoin = page === 'join.openroom.app' || page.startsWith('join.');
  const targetJoin = join === 'join.openroom.app' || join.startsWith('join.');
  if (pageMarketing && targetJoin) return true;
  if (pageJoin && targetJoin) return true;
  return false;
}

export function StageView({
  snapshot,
  status,
  embedded = false,
  /** LiveHost already shows code/counts — skip the join rail so the viz can fill. */
  hideRail = false,
  hideMeaning = false,
  className,
  drawTool = 'none',
  inkColor = 'red',
  track = false,
  onCircle,
  onStroke,
  onErase,
  onTarget,
}: {
  snapshot: StageSnapshot | null;
  status: ConnectionStatus;
  /** When true, fill the parent instead of 100dvh and theme the stage root node. */
  embedded?: boolean;
  hideRail?: boolean;
  /** Tutor-only word selection on the original slide; audience projection is unchanged. */
  hideMeaning?: boolean;
  className?: string;
  drawTool?: 'none' | MarkShape | 'pen';
  /** Colour the tutor draws in; committed marks carry their own. */
  inkColor?: InkColor;
  /** Follow words under the pointer with no tool active (console only). */
  track?: boolean;
  onCircle?: (partKey: string, token: number, word: string, endToken?: number) => void;
  onStroke?: (points: { x: number; y: number }[]) => void;
  onErase?: (id: string) => void;
  onTarget?: (
    target: { partKey: string; token: number; word: string; endToken?: number } | null,
  ) => void;
}) {
  const reduced = useReducedMotion();
  const mode = useThemeMode();
  const visible = usePageVisible();
  const rootRef = useRef<HTMLDivElement>(null);
  const [themeEl, setThemeEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!embedded) return;
    setThemeEl(rootRef.current);
  }, [embedded, snapshot?.revision]);

  const themeId = useAppliedTheme(snapshot?.theme, mode, embedded ? themeEl : undefined);
  const activity = useActivity(snapshot?.answeredCount ?? 0);
  const webgl = useMemo(() => detectWebGL(), []);
  // Skip WebGL atmosphere in the host stage-mirror; it only belongs on the
  // projector surface and otherwise dumps Three.js console noise into LiveHost.
  const ambient = !embedded && shouldRenderAmbient({ themeId, reduced, webgl });

  const previous = useRef<BeatState | null>(null);
  const counter = useRef(0);
  const [moment, setMoment] = useState<Moment>(QUIET);

  useEffect(() => {
    if (!snapshot) return;
    const next = beatStateOf(snapshot);
    const beat = detectBeat(previous.current, next);
    previous.current = next;
    // While session Q&A covers the stage, interaction beats would announce a
    // question nobody can see — stay quiet until the host takes Q&A off.
    if (beat === null || qnaCovering(snapshot)) return;
    counter.current += 1;
    setMoment({
      beat,
      token: counter.current,
      title: beatTitle(beat, next.round),
      celebrate: shouldCelebrate(beat, snapshot.interaction),
    });
  }, [snapshot]);

  const code = snapshot?.code ?? '······';
  const joinUrl = resolveJoinUrl(snapshot, code);
  const interaction = snapshot?.interaction ?? null;
  // Require an actual outline. Without this, `snapshot.outline?.… !== 'interaction'`
  // is true when outline is missing, so outlineContent becomes `undefined` and the
  // idle check (`=== null`) never fires for ordinary sessions without an outline.
  const outlineContent =
    snapshot?.status === 'live' &&
    snapshot.outline != null &&
    snapshot.outline.currentStep.kind !== 'interaction'
      ? snapshot.outline
      : null;
  const idle =
    !snapshot ||
    snapshot.status !== 'live' ||
    (interaction === null && outlineContent === null && !qnaCovering(snapshot));
  const showRail = !idle && outlineContent === null && !hideRail;

  return (
    <div
      ref={rootRef}
      className={[
        'stage',
        embedded ? 'stage--embedded' : '',
        hideRail ? 'stage--no-rail' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--slide-aspect': deckAspectRatio(snapshot?.outline?.design?.aspectRatio ?? '16:9') } as React.CSSProperties}
      data-idle={idle ? 'true' : 'false'}
      data-rail={showRail ? 'true' : 'false'}
    >
      <AmbientLayer active={ambient && idle} activity={activity} visible={visible} />

      <div className="stage__grid">
        {showRail ? (
          <Rail
            code={code}
            joinUrl={joinUrl}
            joined={snapshot?.participantCount ?? 0}
            answered={snapshot?.answeredCount ?? 0}
            expected={snapshot?.expectedAnswerCount ?? snapshot?.participantCount ?? 0}
            groupAnswers={snapshot?.interaction?.responseMode === 'group'}
            closesAt={snapshot?.closesAt}
            offline={status === 'offline'}
            connecting={status === 'connecting' && snapshot !== null}
            compact
          />
        ) : null}
        {/* Standalone stage owns the page landmark; embedded LiveHost already has <main>. */}
        {embedded ? (
          <div className="stage__main" style={{ position: 'relative' }}>
            <Body snapshot={snapshot} reduced={reduced} code={code} joinUrl={joinUrl} overlay={<InkOverlay
              marks={snapshot?.marks}
              capture={drawTool}
              color={inkColor}
              track={track}
              onCircle={onCircle}
              onStroke={onStroke}
              onErase={onErase}
              onTarget={onTarget}
            />} />
            {!hideMeaning && <StageMeaning meaning={snapshot?.meaning} dictionary={snapshot?.dictionary} />}
            <StageClock snapshot={snapshot} />
          </div>
        ) : (
          <main className="stage__main" style={{ position: 'relative' }}>
            <Body snapshot={snapshot} reduced={reduced} code={code} joinUrl={joinUrl} overlay={<InkOverlay marks={snapshot?.marks} />} />
            <StageMeaning meaning={snapshot?.meaning} dictionary={snapshot?.dictionary} />
            <StageClock snapshot={snapshot} />
          </main>
        )}
      </div>

      <MomentLayer
        beat={moment.beat}
        token={moment.token}
        title={moment.title}
        celebrate={moment.celebrate}
      />
    </div>
  );
}

function Rail({
  code,
  joinUrl,
  joined,
  answered,
  expected,
  groupAnswers,
  closesAt,
  offline,
  connecting,
  compact,
}: {
  code: string;
  joinUrl: string;
  joined: number;
  answered: number;
  expected: number;
  groupAnswers: boolean;
  closesAt?: number;
  offline: boolean;
  connecting: boolean;
  compact: boolean;
}) {
  const answeredPct = expected > 0 ? Math.min(100, Math.round((answered / expected) * 100)) : 0;
  const meter = useRef<HTMLSpanElement>(null);
  const remaining = useCountdown(closesAt);

  useEffect(() => {
    const el = meter.current;
    if (!el) return;
    const tween = gsap.to(el, {
      width: `${answeredPct}%`,
      duration: dur(SECONDS.base),
      ease: EASE.out,
    });
    return () => {
      tween.kill();
    };
  }, [answeredPct]);

  return (
    <aside className="rail">
      <div className="rail__brand">
        <span className="rail__dot" data-state={offline ? 'offline' : connecting ? 'wait' : 'live'} />
        <span className="rail__brandname">OpenRoom</span>
      </div>

      <div className="rail__join">
        <p className="rail__code">{code}</p>
      </div>

      <div className={`rail__qr${compact ? ' rail__qr--compact' : ''}`}>
        <QrCode text={joinUrl} title={`QR code to join session ${code}`} />
      </div>

      <p className="rail__counts">
        <AnimatedNumber value={joined} className="rail__num" /> joined ·{' '}
        <AnimatedNumber value={answered} className="rail__num" /> {groupAnswers ? 'group answers' : 'answered'}
      </p>
      {remaining !== null ? (
        <p className="rail__timer" aria-hidden="true">
          {formatCountdown(remaining)}
        </p>
      ) : null}
      <span className="meter" aria-hidden="true">
        <span className="meter__fill" ref={meter} style={{ width: 0 }} />
      </span>

      {offline ? <p className="rail__notice">Reconnecting…</p> : null}

      <p className="sr-only" role="status" aria-live="polite">
        {joined} joined, {answered} {groupAnswers ? 'group answers' : 'answered'}
        {remaining !== null ? `, ${formatCountdown(remaining)} remaining` : ''}.
      </p>
    </aside>
  );
}

function Body({
  snapshot,
  reduced,
  code,
  joinUrl,
  overlay,
}: {
  snapshot: StageSnapshot | null;
  reduced: boolean;
  code: string;
  joinUrl: string;
  overlay?: React.ReactNode;
}) {
  if (!snapshot) {
    return (
      <div className="center">
        <span className="center__spinner" aria-hidden="true" />
        <p className="center__sub">Connecting…</p>
      </div>
    );
  }

  if (snapshot.status === 'ended') {
    return (
      <div className="center">
        <p className="center__big">Session ended</p>
      </div>
    );
  }

  // Session Q&A on the projector: an explicit host toggle, so it wins over the
  // active interaction until the host takes it off again.
  const qna = snapshot.qna;
  if (snapshot.status === 'live' && qna && qna.stage.mode !== 'off') {
    const spotlightId = qna.stage.mode === 'spotlight' ? qna.stage.questionId : null;
    const source = spotlightId
      ? qna.questions.filter((question) => question.id === spotlightId)
      : qna.questions;
    const entries = source.map((question) => ({
      participantId: question.id,
      text: question.text,
      hidden: false,
      votes: question.votes,
      ...(question.handle === undefined ? {} : { handle: question.handle }),
    }));
    return (
      <Question
        design={snapshot.outline?.design}
        key={spotlightId ? `session-qna-${spotlightId}` : 'session-qna'}
        prompt="Audience Q&A"
        state={snapshot.frozen ? 'Paused' : 'Open'}
        tone={snapshot.frozen ? 'frozen' : 'open'}
      >
        <AggregateChart
          interaction={{ id: 'session-qna', type: 'qna', prompt: 'Audience Q&A' }}
          aggregate={{ kind: 'qna', entries, total: entries.length }}
          revealed={false}
          frozen={snapshot.frozen}
          reduced={reduced}
          size="stage"
        />
      </Question>
    );
  }

  const interaction = snapshot.interaction;

  const outline = snapshot.outline;
  if (snapshot.status === 'live' && outline && outline.currentStep.kind !== 'interaction') {
    return (
      <OutlineStepView
        key={outline.currentStep.id}
        step={outline.currentStep}
        design={outline.design}
        hiddenParts={outline.hiddenParts}
        overlay={overlay}
        clock={snapshot.clock}
        join={{ url: joinUrl, code }}
      />
    );
  }

  if (snapshot.status === 'lobby' || !interaction) {
    return (
      <IdleScreen
        lobby={snapshot.status === 'lobby'}
        code={code}
        joinUrl={joinUrl}
        joined={snapshot.participantCount}
      />
    );
  }

  const revealed = snapshot.interactionStatus === 'revealed';

  return (
    <Question
      design={outline?.design}
      overlay={overlay}
      key={interaction.id}
      // A fill-the-gaps prompt is drawn with its blanks, filled in once the reveal has
      // sent the gaps' answers. The `{{id}}` source is never on the wall.
      prompt={
        interaction.type === 'fill-the-gaps'
          ? fillTheGapsPromptText(interaction.prompt, interaction.gaps)
          : interaction.prompt
      }
      // A fill-the-gaps prompt is drawn expanded, so no span list describes it.
      // Its styling is one family over the whole drawn sentence and word bank.
      promptSpans={interaction.type === 'fill-the-gaps' ? undefined : interaction.promptSpans}
      promptFont={interaction.type === 'fill-the-gaps' ? interaction.promptFont : undefined}
      bankWords={
        interaction.type === 'fill-the-gaps' && interaction.display === 'bank'
          ? seededShuffle(interaction.bankWords ?? [], interaction.id)
          : undefined
      }
      closesAt={snapshot.interactionStatus === 'open' ? snapshot.closesAt : undefined}
      state={
        snapshot.frozen
          ? 'Paused'
          : snapshot.interactionStatus === 'open'
            ? snapshot.round === 2
              ? 'Second vote'
              : 'Open'
            : revealed
              ? 'Results'
              : snapshot.round === 1 &&
                  interaction.type === 'choice' &&
                  (interaction as { peerInstruction?: boolean }).peerInstruction
                ? 'Discussion'
                : 'Closed'
      }
      tone={
        snapshot.frozen
          ? 'frozen'
          : snapshot.interactionStatus === 'open'
            ? 'open'
            : revealed
              ? 'revealed'
              : 'closed'
      }
    >
      <Visualization
        interaction={interaction}
        aggregate={snapshot.aggregate}
        revealed={revealed}
        frozen={snapshot.frozen}
        reduced={reduced}
        answeredCount={snapshot.answeredCount}
        round1Aggregate={snapshot.round1Aggregate ?? null}
        interactionStatus={snapshot.interactionStatus}
        round={snapshot.round ?? null}
      />
    </Question>
  );
}

/**
 * One typed content step on the projector.
 *
 * The structure lives in `@openroom/slides`, which the deck editor canvas renders too:
 * one skeleton, two skins, so what the tutor authors is what the audience sees. The
 * class names below still belong to `stage-ui.css`. Interaction steps return
 * `null` here on purpose — a live question is drawn by the aggregate surface.
 */
export function OutlineStepView({
  step,
  design,
  hiddenParts,
  clock,
  join,
  overlay,
}: {
  step: LearnerOutlineStep;
  design?: NonNullable<StageSnapshot['outline']>['design'];
  hiddenParts?: string[];
  clock?: StageSnapshot['clock'];
  join?: { url: string; code: string };
  overlay?: React.ReactNode;
}) {
  // Called, not mounted: `StepLayout` returns null for an interaction step, and
  // callers here rely on that null rather than on an element that draws nothing.
  // Timer countdown lives in a child component (`LiveTimer`) so hooks still run
  // when React mounts the returned tree.
  // `tokens` puts a `data-token` span round every word of the step's own text:
  // it is what the circle tool clicks and what the ink then draws round.
  return StepLayout({ step, design, fit: true, overlay, tokens: true, clock, join, hiddenParts: new Set(hiddenParts ?? []) });
}

/**
 * The pushed meaning card, over the slide on a scrim.
 *
 * One card instead of a floating gloss plus an edge panel: while the tutor has
 * a word up, that word is what the wall is about. The clicked form stays
 * marked wherever it appears in the tables.
 */
function StageMeaning({
  meaning,
  dictionary,
}: {
  meaning: StageSnapshot['meaning'];
  dictionary: StageSnapshot['dictionary'];
}) {
  const text = meaning?.shown === true ? meaning.text : undefined;
  if (dictionary === undefined && text === undefined) return null;
  return (
    <div className="meaning-layer">
      <div className="meaning-layer__scrim" aria-hidden="true" />
      <MeaningCard
        entry={dictionary?.entry}
        meaning={text}
        word={meaning?.word}
        footer={dictionary === undefined ? null : dictionary.entry.source.name}
      />
    </div>
  );
}

/** Corner furniture when the clock is not the slide itself. */
function StageClock({ snapshot }: { snapshot: StageSnapshot | null }) {
  const clock = snapshot?.clock;
  if (!cornerClockVisible(clock, snapshot?.outline?.currentStep)) return null;
  return <ClockPill clock={clock} />;
}

function Question({
  design,
  overlay,
  prompt,
  promptSpans,
  promptFont,
  bankWords,
  state,
  tone,
  closesAt,
  children,
}: {
  design?: NonNullable<StageSnapshot['outline']>['design'];
  overlay?: React.ReactNode;
  prompt: string;
  promptSpans?: readonly SlideSpanStyle[];
  promptFont?: 'default' | 'display' | 'serif' | 'mono';
  bankWords?: string[];
  state: string;
  tone: string;
  closesAt?: number;
  children: React.ReactNode;
}) {
  const head = useRef<HTMLDivElement>(null);
  const remaining = useCountdown(closesAt);
  const initial = useRef<number | null>(null);
  if (remaining !== null && initial.current === null) initial.current = Math.max(remaining, 1);
  if (closesAt === undefined) initial.current = null;
  const windowPct =
    remaining === null || initial.current === null
      ? 0
      : Math.max(0, Math.min(100, (remaining / initial.current) * 100));

  useLayoutEffect(() => {
    const el = head.current;
    if (!el) return;
    const tween = gsap.fromTo(
      el.children,
      { autoAlpha: 0, y: 26 },
      {
        autoAlpha: 1,
        y: 0,
        duration: dur(SECONDS.slow),
        ease: EASE.out,
        stagger: stagger(0.07),
        clearProps: 'transform',
      },
    );
    return () => {
      tween.kill();
    };
  }, []);

  const promptFontStyle =
    promptFont !== undefined && promptFont !== 'default'
      ? { fontFamily: `var(--font-${promptFont})` }
      : undefined;

  return (
    <SlideSurface design={design} fit overlay={overlay}><section className="plate">
      <div className="head" ref={head}>
        {tone === 'frozen' ? <span className="chip chip--frozen">{state}</span> : null}
        <div className="head__row">
          <h1 className="prompt" style={promptFontStyle}>
            <TokenLine text={prompt} partKey="header" spans={promptSpans} />
          </h1>
          {remaining !== null ? (
            <p className="countdown" aria-live="polite">
              <span className="sr-only">Time remaining </span>
              {formatCountdown(remaining)}
            </p>
          ) : null}
        </div>
        {bankWords !== undefined && bankWords.length > 0 ? (
          <ul className="word-bank" aria-label="Word bank" style={promptFontStyle}>
            {bankWords.map((word) => (
              <li key={word}>{word}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="plate__body">{children}</div>
      {remaining !== null ? (
        <span className="window-meter" aria-hidden="true">
          <span className="window-meter__fill" style={{ width: `${String(windowPct)}%` }} />
        </span>
      ) : null}
    </section></SlideSurface>
  );
}

function IdleScreen({
  lobby,
  code,
  joinUrl,
  joined,
}: {
  lobby: boolean;
  code: string;
  joinUrl: string;
  joined: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const tween = gsap.fromTo(
      el.querySelectorAll('.idle__plate > *'),
      { autoAlpha: 0, y: 30 },
      {
        autoAlpha: 1,
        y: 0,
        duration: dur(SECONDS.slow),
        ease: EASE.out,
        stagger: stagger(0.08),
        clearProps: 'transform',
      },
    );
    return () => {
      tween.kill();
    };
  }, []);

  const host = new URL(joinUrl).host;
  return (
    <div className="idle" ref={root}>
      <div className="idle__plate">
        <p className="idle__brand">OpenRoom</p>
        <p className="idle__code">{code}</p>
        <p className="idle__url">{host}</p>
        <div className="idle__qr">
          <QrCode text={joinUrl} title={`QR code to join session ${code}`} />
        </div>
        <p className="idle__sub">
          <span className="idle__state">{lobby ? 'Waiting to start' : 'Next'}</span> ·{' '}
          <AnimatedNumber value={joined} className="idle__count" /> joined
        </p>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {lobby ? 'Waiting to start.' : 'Waiting for the next question.'} Join code {code}.{' '}
        {joined} joined.
      </p>
    </div>
  );
}
