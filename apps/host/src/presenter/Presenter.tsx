import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { deckAspectRatio, resolveRevealOrder, stringifyOpenRoomFile, type Outline, type PresentationPosition } from '@openroom/schema';
import { usePresentationKeys } from './usePresentationKeys';
import { LiveHost } from '../LiveHost';
import { Button } from '@openroom/ui/components/button';
import { desktopBridge, type DesktopDisplay } from '../desktop-bridge';
import { PresentStage, presentableSteps } from './PresentationStage';
import { advance, atEnd, atStart, openCursor, retreat, type PresentCursor } from './cursor';
import { saveLiveSession } from '../storage';
import type { StoredSession } from '../types';
import { ListeningControls, type ListeningSettings } from '../live/ListeningControls';
import { sessionStartMessage } from '../components/ContinuityLock';

export type { PresentationPosition } from '@openroom/schema';

/** One presenter for a document, optionally connected to a live session. */
export function Presenter({ outline, fromStep = 0, startImmediately = false, documentSource, onStart, onClose }: {
  outline: Outline;
  fromStep?: number;
  startImmediately?: boolean;
  documentSource?: string | null;
  onStart: (cursor: PresentationPosition) => Promise<StoredSession>;
  onClose: (stepId?: string) => void;
}) {
  const steps = useMemo(() => presentableSteps(outline), [outline]);
  const groups = useMemo(() => steps.map((step) => resolveRevealOrder(step, outline.interactions)), [steps, outline]);
  const counts = useMemo(() => groups.map((group) => group.length), [groups]);
  const [cursor, setCursor] = useState<PresentCursor>(() => openCursor(counts, fromStep));
  const step = steps[cursor.step];
  const audio = step && 'media' in step && step.media?.type === 'audio' ? step.media : undefined;
  const [listeningOverride, setListeningOverride] = useState<ListeningSettings | null>(null);
  useEffect(() => { setListeningOverride(null); }, [step?.id]);
  const listening = useMemo(() => step && audio?.listening ? listeningOverride?.stepId === step.id ? listeningOverride : {
    stepId: step.id, mode: audio.listening.mode, transcriptShown: false,
  } : undefined, [audio, listeningOverride, step]);
  const [live, setLive] = useState<StoredSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startPromise = useRef<Promise<StoredSession> | null>(null);
  const [displays, setDisplays] = useState<DesktopDisplay[]>([]);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const bridge = desktopBridge();
  const containerRef = useRef<HTMLDivElement>(null);
  const fileId = useRef(crypto.randomUUID());
  const source = useMemo(() => documentSource ?? stringifyOpenRoomFile({
    format: 'openroom-file', fileVersion: 1, fileId: fileId.current, localRevision: 0, outline,
  }), [documentSource, outline]);

  useEffect(() => {
    document.querySelectorAll('audio').forEach((audio) => audio.pause());
    const element = containerRef.current;
    const previousFocus = document.activeElement;
    const root = document.getElementById('app');
    const wasInert = root?.inert ?? false;
    if (root && !root.contains(element)) root.inert = true;
    element?.focus();
    return () => { if (root) root.inert = wasInert; if (previousFocus instanceof HTMLElement) previousFocus.focus(); };
  }, []);

  const start = useCallback(async () => {
    const step = steps[cursor.step];
    if (!step || startPromise.current || live) return;
    setStarting(true);
    setError(null);
    const promise = onStart({ stepId: step.id, shown: cursor.shown,
      ...(listening ? { listening: { mode: listening.mode, transcriptShown: listening.transcriptShown } } : {}),
    });
    startPromise.current = promise;
    try {
      const session = await promise;
      saveLiveSession(session);
      setLive(session);
    } catch (cause) {
      setError(sessionStartMessage(cause, 'Could not start the session.'));
      startPromise.current = null;
    } finally { setStarting(false); }
  }, [cursor, listening, live, onStart, steps]);
  const autoStarted = useRef(false);
  useEffect(() => {
    if (startImmediately && !autoStarted.current) { autoStarted.current = true; void start(); }
  }, [startImmediately, start]);

  const close = useCallback(() => {
    if (starting) return;
    void bridge?.closePresentation();
    onClose(steps[cursor.step]?.id);
  }, [bridge, cursor.step, onClose, starting, steps]);
  useEffect(() => {
    if (live) return;
    const command = (value: 'next' | 'previous' | 'close') => {
      if (starting) return;
      if (value === 'close') close();
      else setCursor((current) => value === 'next' ? advance(counts, current) : retreat(counts, current));
    };
    const unsubscribe = bridge?.onPresentationCommand(command);
    return () => unsubscribe?.();
  }, [bridge, close, counts, live, starting]);
  usePresentationKeys({ enabled: !live && !starting, close,
    next: () => setCursor((current) => advance(counts, current)),
    previous: () => setCursor((current) => retreat(counts, current)),
  });
  useEffect(() => { void bridge?.listDisplays().then(setDisplays); }, [bridge]);
  useEffect(() => {
    if (!audienceOpen) return;
    void bridge?.updatePresentation({ source, cursor, listening, ...(live ? { live: { sessionCode: live.sessionCode, stageToken: live.stageToken } } : {}) });
  }, [audienceOpen, bridge, cursor, live, source, listening]);
  useEffect(() => () => { void bridge?.closePresentation(); }, [bridge]);

  const presentOn = async (displayId?: string) => {
    if (!bridge) return;
    try {
      await bridge.startPresentation({ source, cursor, listening, ...(live ? { live: { sessionCode: live.sessionCode, stageToken: live.stageToken } } : {}) }, displayId);
      setAudienceOpen(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open the audience screen.'); }
  };
  return createPortal(<div ref={containerRef} tabIndex={-1} className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Presenter" data-deck-preview>
    {live ? <LiveHost live={live} onLeave={close} onReturnToDeck={close}
      onPosition={(position) => {
        const index = steps.findIndex((candidate) => candidate.id === position.stepId);
        if (index >= 0) setCursor((current) => current.step === index && current.shown === position.shown ? current : { step: index, shown: position.shown });
      }} /> : <>
      <header className="flex h-11 shrink-0 items-center gap-3 bg-chrome px-3">
        <Button variant="subtle" size="sm" disabled={starting} onClick={close}>Edit deck</Button>
        <span className="truncate text-title-bar">{outline.meta.title}</span>
        <span className="flex-1" />
        {bridge ? <Button size="sm" variant="outline" onClick={() => void presentOn()}>Audience screen</Button> : null}
        {displays.filter((display) => display.external).map((display) => <Button key={display.id} size="sm" variant="outline" onClick={() => void presentOn(display.id)}>{display.label}</Button>)}
        <Button size="sm" variant="live" disabled={starting || !step} onClick={() => void start()}>{starting ? 'Starting…' : 'Start session'}</Button>
      </header>
      {error ? <p role="alert" className="px-4 py-2 text-destructive">{error}</p> : null}
      <main className="flex min-h-0 flex-1 items-center justify-center gap-6 bg-desk px-6 py-5" style={{ containerType: 'size' }}>
        <div className="stage-mirror relative flex min-w-0 flex-col overflow-hidden rounded-lg bg-card shadow-[var(--shadow-page)]" style={{
          aspectRatio: deckAspectRatio(outline.design?.aspectRatio ?? '16:9'),
          width: `min(100%, 820px, calc(100cqh * ${deckAspectRatio(outline.design?.aspectRatio ?? '16:9')}))`,
        }}>
          {step ? <PresentStage outline={outline} step={step} groups={groups[cursor.step] ?? []} shown={cursor.shown} listening={listening} /> : <p>No slides yet.</p>}
        </div>
        {audio && listening ? <div className="max-h-full w-[340px] shrink-0 overflow-y-auto"><ListeningControls key={listening.stepId} media={audio} value={listening} onChange={async (change) => { setListeningOverride((current) => ({ ...(current?.stepId === change.stepId ? current : listening), ...change })); return true; }} /></div> : null}
      </main>
      <footer className="flex items-center justify-center gap-4 border-t border-border px-4 py-3">
        <Button variant="outline" disabled={starting || !step || atStart(counts, cursor)} onClick={() => setCursor((current) => retreat(counts, current))}>Previous</Button>
        <span className="text-caption" role="status">Slide {cursor.step + 1} of {steps.length}{(counts[cursor.step] ?? 0) > 1 ? ` · reveal ${cursor.shown}/${counts[cursor.step]}` : ''}</span>
        <Button disabled={starting || !step || atEnd(counts, cursor)} onClick={() => setCursor((current) => advance(counts, current))}>Next</Button>
      </footer>
    </>}
  </div>, document.body);
}
