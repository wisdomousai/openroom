import type { PresentationActivity, PresentationComposition } from '@openroom/schema';
import { useEffect, useRef, useState } from 'react';
import { createSessionClient, type Command, type ConnectionStatus, type HostSnapshot, type SessionClient } from '@openroom/sdk';
import { request, RequestError } from './api';
import type { Connection } from './auth';
import { bindingMatches, composedStep, parseBinding, readPresentationActivities, readSelection, readSessionReference, writeSessionReference, type SavedSession, type SessionReference, type SlideSelection } from './bindings';
import { useEmbeddedDisplay } from './useEmbeddedDisplay';
import { displayChannelName } from './display-channel';

interface LiveGrant { sessionId: string; sessionCode: string; hostToken: string; stageToken: string; presentation: PresentationComposition }
const empty: SavedSession = { raw: null, reference: null };

export function LivePanel({ connection, selection, failed, onRehearse }: { connection: Connection; selection: SlideSelection | null; failed: (error: unknown) => void; onRehearse: () => void }) {
  const [saved, setSaved] = useState<SavedSession>(empty), [loaded, setLoaded] = useState(false);
  const [grant, setGrant] = useState<LiveGrant | null>(null), [snapshot, setSnapshot] = useState<HostSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [ending, setEnding] = useState(false);
  const running = useRef(false), client = useRef<SessionClient<HostSnapshot> | null>(null);
  const binding = parseBinding(selection?.rawBinding ?? null);
  const bound = selection && binding && bindingMatches(selection, binding) ? binding : null;
  useEmbeddedDisplay(grant, saved.reference);

  useEffect(() => {
    let stopped = false; setLoaded(false);
    void readSessionReference().then((value) => { if (!stopped) { setSaved(value); setLoaded(true); } }).catch((cause: unknown) => { if (!stopped) { setError(cause instanceof Error ? cause.message : 'Could not read the presentation.'); setLoaded(true); } });
    return () => { stopped = true; };
  }, [selection?.presentationId]);

  useEffect(() => {
    if (!grant) return;
    let stopped = false;
    setSnapshot(null); setStatus('connecting');
    const live = createSessionClient<HostSnapshot>({
      sessionCode: grant.sessionCode, token: grant.hostToken, role: 'host',
      onChange: (value) => { if (!stopped) setSnapshot(value); },
      onStatus: (value) => { if (!stopped) setStatus(value); },
      fetch: async (url, init) => {
        const body = init?.body instanceof Uint8Array ? Uint8Array.from(init.body).buffer : init?.body;
        const response = await fetch(url, { ...init, body, credentials: 'omit' });
        if (!stopped && (response.status === 401 || response.status === 403 || response.status === 404)) {
          setGrant(null); setSnapshot(null); setError('Session access changed. Resume to check your access again.');
        }
        return response;
      },
    });
    client.current = live;
    return () => { stopped = true; live.close(); client.current = null; };
  }, [grant]);

  async function action(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete this action.'); failed(cause); }
    finally { running.current = false; setBusy(false); }
  }
  async function start(reference: SessionReference, activities?: PresentationActivity[]) {
    const value = await request<LiveGrant>(connection, '/api/presentations/start', undefined, { requestId: reference.sessionId, presentationId: reference.presentationId, ...(activities ? { activities } : {}), ...(bound ? { slideId: bound.slideId } : {}) });
    setGrant(value); setEnding(false);
  }
  async function startNew() {
    const fresh = await readSelection(), activity = parseBinding(fresh.rawBinding);
    if (!activity || !bindingMatches(fresh, activity) || fresh.rawBinding !== selection?.rawBinding || fresh.slideId !== selection?.slideId) throw new Error('The selected activity changed. Refresh the selection before starting.');
    const activities = await readPresentationActivities(activity.presentationId);
    const value = await writeSessionReference(fresh, saved, crypto.randomUUID(), activities);
    setSaved(value); setGrant(null); setSnapshot(null);
    await start(value.reference!, activities);
  }
  async function resume() {
    const value = await readSessionReference();
    if (value.raw !== saved.raw || !value.reference) throw new Error('The session reference changed. Reopen the pane before resuming.');
    try {
      const recovered = await request<LiveGrant>(connection, `/api/sessions/${encodeURIComponent(value.reference.sessionId)}/resume`, undefined, {});
      if (recovered.presentation?.id !== value.reference.presentationId) throw new Error('This session belongs to a different presentation. Start a new session.');
      setGrant(recovered);
    }
    catch (cause) {
      // The pane can close after saving its retry identity but before Start reaches the server.
      if (!(cause instanceof RequestError) || !['session-not-found', 'session-not-started'].includes(cause.code)) throw cause;
      await start(value.reference, cause.code === 'session-not-found' ? await readPresentationActivities(value.reference.presentationId) : undefined);
    }
    setEnding(false);
  }
  async function send(command: Command) {
    const live = client.current;
    if (!live) throw new Error('Resume this session before using its controls.');
    const result = await live.submit(command);
    if (!result.ok) throw new Error(result.error?.message || 'The session changed. Refresh and try again.');
    await live.refresh();
  }
  async function activate(expected = selection) {
    const fresh = await readSelection(), activity = parseBinding(fresh.rawBinding);
    if (!activity || !bindingMatches(fresh, activity) || fresh.slideId !== expected?.slideId || fresh.rawBinding !== expected?.rawBinding) throw new Error('The selected slide changed. Refresh the selection before showing it.');
    if ((await readSessionReference()).reference?.sessionId !== grant?.sessionId) throw new Error('The presentation session changed. Resume its current session.');
    const stepId = composedStep(grant?.presentation, activity);
    const latest = client.current?.getSnapshot();
    if (!latest?.outline?.content.steps.some((step) => step.id === stepId)) throw new Error('This slide is not in the running session. Start a new session to use the updated deck.');
    if (latest.outline.content.steps[latest.outline.currentStepIndex]?.id === stepId) return;
    await send({ command: 'outline.goto', stepId: stepId! });
  }

  // Content runtimes request activation; this signed-in controller retains authority.
  useEffect(() => {
    if (!grant || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(displayChannelName(grant.presentation.id));
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type !== 'openroom.slide.activate' || event.data.sessionId !== grant.sessionId) return;
      const requested = parseBinding(JSON.stringify(event.data.binding));
      const latest = client.current?.getSnapshot();
      if (!requested || !composedStep(grant.presentation, requested) || latest?.status !== 'live' || !latest.facilitation.canPresent) return;
      void action(() => activate({ slideId: requested.slideId, presentationId: requested.presentationId, rawBinding: JSON.stringify(requested) }));
    };
    return () => channel.close();
  }, [grant]);

  const live = snapshot?.status === 'live', ended = snapshot?.status === 'ended';
  const currentStep = snapshot?.outline?.content.steps[snapshot.outline.currentStepIndex];
  const selectedStepId = composedStep(grant?.presentation, bound);
  const selectedInSession = !!selectedStepId && snapshot?.outline?.content.steps.some((step) => step.id === selectedStepId);
  const selectedIsCurrent = selectedInSession && currentStep?.id === selectedStepId;
  const connected = status === 'live' || status === 'polling';
  const controlsDisabled = busy || !connected || !live || !snapshot?.facilitation.canPresent;
  const interactionId = snapshot?.activeInteractionId;
  const currentInteraction = snapshot?.interactions.find((item) => item.id === interactionId);
  const remote = grant ? `/host/#/sessions/${encodeURIComponent(grant.sessionCode)}/remote?token=${encodeURIComponent(grant.hostToken)}` : '';

  return <section className="live-panel" aria-label="Session controls">
    <div className="section-title"><h2>{grant ? ended ? 'Session ended' : snapshot?.status === 'lobby' ? 'Session ready' : 'Live session' : 'Teach from PowerPoint'}</h2>{grant && !ended ? <span className={`connection ${connected ? 'connected' : ''}`} role="status">{status === 'offline' ? 'Offline' : connected ? 'Connected' : 'Connecting…'}</span> : null}</div>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    {!loaded ? <p role="status">Reading presentation…</p> : !grant ? <>
      {saved.reference ? <><p>This presentation has a session reference. Resume to recover its controls and answers.</p><button className="primary" disabled={busy} onClick={() => void action(resume)}>Resume session</button><p className="quiet">For a new audience or a copied presentation, start a new session with a new join code.</p></> : <p>Start the embedded OpenRoom slides in this presentation, beginning with the selected slide. Everyone joins with one code.</p>}
      {saved.raw && !saved.reference ? <p>The saved session reference cannot be read. Start a new session from an embedded slide.</p> : null}
      <button className={saved.reference ? '' : 'primary'} disabled={busy || !bound} onClick={() => void action(startNew)}>{saved.reference ? 'Start a new session' : 'Start session'}</button>
      <button disabled={busy || !bound} onClick={onRehearse}>Rehearse selected slide</button>
      {!bound ? <p className="quiet">Choose an OpenRoom slide first.</p> : null}
    </> : <>
      {!ended ? <><div className="join-code"><span className="eyebrow">JOIN CODE</span><strong>{grant.sessionCode}</strong><a href={snapshot?.joinUrl ?? `/join/?code=${encodeURIComponent(grant.sessionCode)}`} target="_blank" rel="noopener noreferrer">Open participant link ↗</a></div>
        {snapshot ? <><p className="live-counts">{snapshot.participantCount} joined · {snapshot.answeredCount} answered</p><h3>{snapshot.interaction?.prompt ?? (currentStep && 'title' in currentStep ? currentStep.title : snapshot.outline?.content.meta.title)}</h3></> : <p role="status">Loading session…</p>}
        {status === 'offline' ? <p>Connection lost. Controls will return when the session reconnects.</p> : null}
        {snapshot?.status === 'lobby' ? <button className="primary" disabled={busy || !connected || !snapshot.facilitation.canPresent} onClick={() => void action(() => send({ command: 'session.start' }))}>Start participation</button> : null}
        {snapshot && !snapshot.facilitation.canPresent ? <><p>Another facilitator is presenting.</p>{snapshot.facilitation.canRecover ? <button disabled={busy || !connected} onClick={() => void action(() => send({ command: 'presentation.recover' }))}>Take presentation control</button> : null}</> : null}
        <div className="live-actions"><button className="primary" disabled={controlsDisabled || !selectedInSession || selectedIsCurrent} onClick={() => void action(() => activate())}>{selectedIsCurrent ? 'Selected slide is live' : 'Show selected slide'}</button>
          {bound && !selectedInSession && snapshot ? <p className="quiet">This slide was embedded or changed after the session started. Start a new session to include it.</p> : null}
          {interactionId ? <div className="control-grid"><button disabled={controlsDisabled || snapshot?.interactionStatus !== 'open'} onClick={() => void action(() => send({ command: 'interaction.close', interactionId }))}>Close answers</button><button disabled={controlsDisabled || snapshot?.interactionStatus === 'revealed'} onClick={() => void action(() => send({ command: 'interaction.reveal', interactionId }))}>Reveal results</button><button disabled={controlsDisabled || snapshot?.interactionStatus === 'open'} onClick={() => void action(() => send({ command: 'interaction.open', interactionId }))}>Reopen answers</button><button disabled={controlsDisabled || snapshot?.interactionStatus !== 'revealed'} onClick={() => void action(() => send({ command: currentInteraction?.resultsHidden ? 'interaction.showResults' : 'interaction.hideResults', interactionId }))}>{currentInteraction?.resultsHidden ? 'Show results' : 'Hide results'}</button></div> : null}
        </div>
        <div className="session-links"><a href={remote} target="_blank" rel="noopener noreferrer">Open companion controls ↗</a><a href={`/stage/?session=${encodeURIComponent(grant.sessionCode)}&token=${encodeURIComponent(grant.stageToken)}`} target="_blank" rel="noopener noreferrer">Open audience display ↗</a></div>
        <p className="quiet">Reopening a question keeps its answers. The companion also controls this session.</p>
        {ending ? <div className="end-confirmation"><p>End participation for everyone in this session?</p><div className="inline-actions"><button disabled={controlsDisabled} onClick={() => void action(async () => { await send({ command: 'session.end' }); setEnding(false); })}>End for everyone</button><button className="text-button" disabled={busy} onClick={() => setEnding(false)}>Keep session open</button></div></div> : <button className="text-button" disabled={controlsDisabled} onClick={() => setEnding(true)}>End session</button>}
      </> : <><p>Answers remain with this session. Start a new session for your next audience.</p><button className="primary" disabled={busy || !bound} onClick={() => void action(startNew)}>Start a new session</button></>}
    </>}
  </section>;
}
