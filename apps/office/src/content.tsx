import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StageView } from '../../stage/src/StageView';
import { bindingMatches, parseBinding, readSelection, readSessionReference, type ActivityBinding, type SessionReference } from './bindings';
import { displayChannelName, displayMatches, displayIsCurrent, type DisplayPublication } from './display-channel';
import type { SlidePreview } from './slide-preview';
import { useOfficeView } from './useOfficeView';
import { ScaledStage } from './ScaledStage';
import { deckAspectRatio } from '@openroom/schema';
import './display.css';

const CONTENT_SETTING = 'openroom.activity';
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Could not read the embedded slide.';
const sameBinding = (left: unknown, right: ActivityBinding) => JSON.stringify(left) === JSON.stringify(right);

function Content({ office }: { office: typeof Office | null }) {
  const [binding, setBinding] = useState(() => parseBinding(office?.context.document.settings.get(CONTENT_SETTING) as string | null));
  const [display, setDisplay] = useState<DisplayPublication | null>(null);
  const [preview, setPreview] = useState<SlidePreview | null>(null);
  const [error, setError] = useState(''), [choosing, setChoosing] = useState(false);
  const [sessionSaved, setSessionSaved] = useState(false);
  const knownSession = useRef<SessionReference | null>(null);
  const picker = useRef<HTMLIFrameElement>(null);
  const view = useOfficeView(office);
  const supported = office?.context.requirements.isSetSupported('PowerPointApi', '1.5') && typeof BroadcastChannel !== 'undefined';
  const saveBinding = useCallback(async (next: ActivityBinding) => {
    if (!office) return;
    office.context.document.settings.set(CONTENT_SETTING, JSON.stringify(next));
    await new Promise<void>((resolve, reject) => office.context.document.settings.saveAsync((result) => result.status === office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error('PowerPoint could not save this slide. Try again.'))));
    setBinding(next); setDisplay(null); setError('');
  }, [office]);

  // Inserting the content add-in after choosing in the pane needs no second connection.
  useEffect(() => {
    if (!office || !supported || binding) return;
    let stopped = false, pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      void readSelection().then(async (selection) => {
        const next = parseBinding(selection.rawBinding);
        if (!stopped && next && bindingMatches(selection, next)) await saveBinding(next);
      }).catch((cause: unknown) => { if (!stopped) setError(message(cause)); }).finally(() => { pending = false; });
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    office.context.document.addHandlerAsync(office.EventType.DocumentSelectionChanged, refresh);
    return () => {
      stopped = true; clearInterval(timer);
      office.context.document.removeHandlerAsync(office.EventType.DocumentSelectionChanged, { handler: refresh });
    };
  }, [office, supported, binding, saveBinding]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== picker.current?.contentWindow || event.data?.type !== 'openroom.slide.selected' || event.data.snapshot?.role !== 'stage') return;
      const next = parseBinding(JSON.stringify(event.data.binding));
      if (!next) return;
      void readSelection().then(async (selection) => {
        if (!bindingMatches(selection, next) || !sameBinding(parseBinding(selection.rawBinding), next)) throw new Error('The selected slide changed. Choose the slide again.');
        await saveBinding(next);
        setPreview({ type: 'openroom.slide.preview', binding: next, snapshot: event.data.snapshot });
        setChoosing(false);
      }).catch((cause: unknown) => setError(message(cause)));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [saveBinding]);

  useEffect(() => {
    if (!binding || !office || !supported) return;
    let stopped = false, lastReceived = 0, lastSessionId: string | null = null, activated = false;
    let pending: DisplayPublication | null = null, processing = false;
    const channel = new BroadcastChannel(displayChannelName(binding.presentationId));
    const clear = () => { setDisplay(null); lastReceived = 0; };
    // Slide Show has no slide selection: PowerPoint for Mac reuses this page in read view and
    // PowerPoint on the web loads it fresh, so read view trusts the stored binding. A copied
    // slide is caught while editing, and Start refuses a presentation with an unreconnected copy.
    // The session reference read while editing stays valid in Slide Show if PowerPoint
    // refuses document reads there; a page loaded fresh in Slide Show trusts the pane's
    // publication, which the signed-in pane sends only for this presentation's session.
    const session = async (publication?: DisplayPublication): Promise<SessionReference | null> => {
      try {
        const value = (await readSessionReference()).reference;
        knownSession.current = value;
        return value;
      } catch (cause) {
        if (view !== 'read') throw cause;
        return knownSession.current ?? (publication ? { version: 1, presentationId: binding.presentationId, sessionId: publication.sessionId } : null);
      }
    };
    const selectedHere = async () => {
      if (view === 'read') return true;
      const selection = await readSelection();
      if (stopped) return false;
      if (!bindingMatches(selection, binding)) {
        clear(); setPreview(null);
        // A copied slide carries the original's tag under a new slide ID.
        setError(selection.rawBinding === JSON.stringify(binding) ? 'This slide is a copy. Choose an OpenRoom slide for it.' : 'Select this PowerPoint slide to show its OpenRoom slide.');
        return false;
      }
      const next = parseBinding(selection.rawBinding);
      if (!sameBinding(next, binding)) {
        clear(); setPreview(null);
        if (next && bindingMatches(selection, next)) await saveBinding(next);
        else setError('Choose an OpenRoom slide for this display.');
        return false;
      }
      setError(''); return true;
    };
    // Publications arrive faster than Office answers while an audience is answering.
    // Check them one at a time and always keep the newest, instead of dropping each
    // check that a later publication overtakes.
    const process = async () => {
      if (processing) return;
      processing = true;
      try {
        while (pending && !stopped) {
          const publication = pending; pending = null;
          const [valid, reference] = await Promise.all([selectedHere(), session(publication)]);
          if (stopped || pending || !valid) continue;
          if (!displayMatches(publication, binding, reference)) { clear(); continue; }
          lastReceived = Date.now(); lastSessionId = publication.sessionId;
          setDisplay(displayIsCurrent(publication, binding) ? publication : null);
        }
      } catch (cause) { if (!stopped) { clear(); setError(message(cause)); } }
      finally { processing = false; }
    };
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'openroom.display.closed') { if (event.data.sessionId === lastSessionId) { pending = null; clear(); } return; }
      if (event.data?.type === 'openroom.slide.preview' && event.data.snapshot?.role === 'stage' && sameBinding(event.data.binding, binding)) {
        const value = event.data as SlidePreview;
        void selectedHere().then((valid) => { if (valid && !stopped) setPreview(value); }).catch(() => {});
        return;
      }
      if (event.data?.type !== 'openroom.display') return;
      pending = event.data as DisplayPublication;
      void process();
    };
    const request = async () => {
      if (document.visibilityState !== 'visible') activated = false;
      if (!await selectedHere() || stopped) return;
      channel.postMessage({ type: 'openroom.slide.request', binding });
      channel.postMessage({ type: 'openroom.display.request' });
      const reference = await session();
      if (stopped) return;
      setSessionSaved(Boolean(reference));
      // A visible slideshow asks once each time this slide comes on screen. Editing never
      // opens responses, and the heartbeat must not pull the session back to this slide
      // after the presenter moves on from the companion or the pane.
      const sessionId = reference?.sessionId ?? lastSessionId;
      if (view === 'read' && document.visibilityState === 'visible' && !activated && sessionId) {
        activated = true;
        channel.postMessage({ type: 'openroom.slide.activate', binding, sessionId });
      }
      if (lastReceived && Date.now() - lastReceived > 15_000) clear();
    };
    const refresh = () => { void request().catch((cause: unknown) => { if (!stopped) setError(message(cause)); }); };
    refresh(); const heartbeat = setInterval(refresh, 3000);
    office.context.document.addHandlerAsync(office.EventType.DocumentSelectionChanged, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      stopped = true; channel.close(); clearInterval(heartbeat);
      office.context.document.removeHandlerAsync(office.EventType.DocumentSelectionChanged, { handler: refresh });
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [binding, office, supported, view, saveBinding]);

  const snapshot = display?.snapshot ?? (preview && binding && sameBinding(preview.binding, binding) ? preview.snapshot : null);
  if (supported && view !== 'read' && (choosing || !binding)) return <div className="embedded-picker">
    {binding ? <button className="picker-back" onClick={() => setChoosing(false)}>Back to slide</button> : null}
    {error ? <p role="alert">{error}</p> : null}
    <iframe ref={picker} title="Choose an OpenRoom slide" src="/office/taskpane.html?embed=1" />
  </div>;
  return <div className="embedded-slide">
    {snapshot ? <ScaledStage aspect={deckAspectRatio(snapshot.outline?.design?.aspectRatio ?? '16:9')}><StageView snapshot={snapshot} status={display?.status ?? 'live'} embedded hideRail={!display} /></ScaledStage> : <div className="display-message"><h1>OpenRoom Slide</h1>
      <p>{!supported ? 'Open this add-in in PowerPoint to embed an OpenRoom slide.' : view === 'read' ? 'Start or resume the session in the OpenRoom pane to show this slide.' : 'Sign in to the OpenRoom pane to show this slide.'}</p>
    </div>}
    {view !== 'read' ? <div className="embedded-toolbar">
      {error ? <span role="alert">{error}</span> : <span>{display ? 'Live slide' : sessionSaved ? 'Preview · Resume the session in the OpenRoom pane' : 'Preview · Start a session in the OpenRoom pane'}</span>}
      {supported ? <button onClick={() => setChoosing(true)}>Choose slide</button> : null}
    </div> : null}
  </div>;
}

(window as { __openroomStarted?: boolean }).__openroomStarted = true;
document.getElementById('openroom-boot-stalled')?.remove();
const root = createRoot(document.getElementById('app')!);
root.render(<div className="display-message"><p role="status">Connecting to PowerPoint…</p></div>);
async function start() {
  if (typeof Office === 'undefined') { root.render(<Content office={null} />); return; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([Office.onReady(), new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 8000); })]);
    root.render(<Content office={info?.host === Office.HostType.PowerPoint ? Office : null} />);
  } catch { root.render(<Content office={null} />); }
  finally { clearTimeout(timer); }
}
void start();
