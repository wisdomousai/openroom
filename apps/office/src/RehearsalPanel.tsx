import { useEffect, useRef, useState } from 'react';
import type { Command } from '@openroom/domain';
import type { Outline } from '@openroom/schema';
import { addRehearsalAnswers, rehearse, rehearsalCommand, rehearsalSnapshot } from './rehearsal';

export function Rehearsal({ outline, stepId, onClose }: { outline: Outline; stepId: string; onClose: () => void }) {
  const [state, setState] = useState(() => rehearse(outline, stepId)), [error, setError] = useState('');
  const [ready, setReady] = useState(false), frame = useRef<HTMLIFrameElement>(null);
  const snapshot = rehearsalSnapshot(state), interactionId = state.activeInteractionId;
  const runtime = interactionId ? state.interactions[interactionId] : undefined;
  useEffect(() => {
    if (!interactionId || runtime?.status !== 'open' || runtime.closesAt === undefined) return;
    const timer = setTimeout(() => setState((current) => current.interactions[interactionId]?.status === 'open' ? rehearsalCommand(current, { command: 'interaction.close', interactionId }) : current), Math.max(0, runtime.closesAt - Date.now()));
    return () => clearTimeout(timer);
  }, [runtime?.closesAt, runtime?.status, interactionId]);
  useEffect(() => {
    const receive = (event: MessageEvent) => { if (event.origin === location.origin && event.source === frame.current?.contentWindow && event.data?.type === 'openroom.preview.ready') setReady(true); };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => { if (ready) frame.current?.contentWindow?.postMessage({ type: 'openroom.preview', snapshot: rehearsalSnapshot(state) }, location.origin); }, [ready, state]);
  function run(command: Command) {
    try { setState(rehearsalCommand(state, command)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not preview this action.'); }
  }
  return <section className="rehearsal" aria-label="Slide rehearsal">
    <button className="text-button" onClick={onClose}>← Back to presentation</button>
    <span className="eyebrow">REHEARSAL</span><h1>{snapshot.interaction?.prompt ?? outline.meta.title}</h1>
    <p>Preview this slide and its behavior. This rehearsal stays on your computer.</p>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    <iframe ref={frame} title="Audience preview" src="/office/display.html" onLoad={() => setReady(false)} />
    {runtime && interactionId ? <>
    <p className="quiet" role="status">{snapshot.answeredCount} sample responses · {runtime.status === 'revealed' ? 'Results revealed' : runtime.status === 'closed' ? 'Answers closed' : 'Answers open'}</p>
    <button className="primary" disabled={runtime.status !== 'open' || snapshot.answeredCount > 0} onClick={() => { try { setState(addRehearsalAnswers(state)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add sample responses.'); } }}>Add sample responses</button>
    <div className="control-grid"><button disabled={runtime.status !== 'open'} onClick={() => run({ command: 'interaction.close', interactionId })}>Close answers</button><button disabled={runtime.status === 'revealed'} onClick={() => run({ command: 'interaction.reveal', interactionId })}>Reveal results</button><button disabled={runtime.status === 'open'} onClick={() => run({ command: 'interaction.open', interactionId })}>Reopen answers</button></div></> : null}
    <button onClick={() => { setState(rehearse(outline, stepId)); setError(''); }}>Reset rehearsal</button>
  </section>;
}
