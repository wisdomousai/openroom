import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StageView } from '../../stage/src/StageView';
import { bindingMatches, parseBinding, readSelection, readSessionReference, type ActivityBinding } from './bindings';
import { displayChannelName, displayMatches, displayIsCurrent, type DisplayPublication } from './display-channel';
import type { SlidePreview } from './slide-preview';
import { useOfficeView } from './useOfficeView';
import './display.css';

const CONTENT_SETTING = 'openroom.activity';
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Could not read the embedded slide.';
const sameBinding = (left: unknown, right: ActivityBinding) => JSON.stringify(left) === JSON.stringify(right);

function Content({ office }: { office: typeof Office | null }) {
  const [binding, setBinding] = useState(() => parseBinding(office?.context.document.settings.get(CONTENT_SETTING) as string | null));
  const [display, setDisplay] = useState<DisplayPublication | null>(null);
  const [preview, setPreview] = useState<SlidePreview | null>(null);
  const [error, setError] = useState(''), [choosing, setChoosing] = useState(false);
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
    let stopped = false, generation = 0, lastReceived = 0, lastSessionId: string | null = null;
    const channel = new BroadcastChannel(displayChannelName(binding.presentationId));
    const clear = () => { setDisplay(null); lastReceived = 0; };
    const selectedHere = async () => {
      const selection = await readSelection();
      if (stopped) return false;
      if (!bindingMatches(selection, binding)) {
        clear(); setPreview(null); setError('Select this PowerPoint slide. Copied slides need their own embedded slide selection.');
        return false;
      }
      const next = parseBinding(selection.rawBinding);
      if (!sameBinding(next, binding)) {
        clear(); setPreview(null);
        if (next && bindingMatches(selection, next) && view !== 'read') await saveBinding(next);
        else setError('Choose an OpenRoom slide for this display.');
        return false;
      }
      setError(''); return true;
    };
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'openroom.display.closed') { if (event.data.sessionId === lastSessionId) { generation++; clear(); } return; }
      if (event.data?.type === 'openroom.slide.preview' && event.data.snapshot?.role === 'stage' && sameBinding(event.data.binding, binding)) {
        const value = event.data as SlidePreview;
        void selectedHere().then((valid) => { if (valid && !stopped) setPreview(value); }).catch(() => {});
        return;
      }
      if (event.data?.type !== 'openroom.display') return;
      const publication = event.data as DisplayPublication, current = ++generation;
      void Promise.all([selectedHere(), readSessionReference()]).then(([valid, session]) => {
        if (stopped || current !== generation || !valid) return;
        if (!displayMatches(publication, binding, session.reference)) { clear(); return; }
        lastReceived = Date.now(); lastSessionId = publication.sessionId;
        setDisplay(displayIsCurrent(publication, binding) ? publication : null);
      }).catch((cause: unknown) => { if (!stopped && current === generation) { clear(); setError(message(cause)); } });
    };
    const request = async () => {
      if (!await selectedHere() || stopped) return;
      channel.postMessage({ type: 'openroom.slide.request', binding });
      channel.postMessage({ type: 'openroom.display.request' });
      // Only a visible slideshow requests activation. Editing never opens responses.
      if (view === 'read' && document.visibilityState === 'visible') {
        const session = await readSessionReference();
        if (!stopped && session.reference) channel.postMessage({ type: 'openroom.slide.activate', binding, sessionId: session.reference.sessionId });
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
    {snapshot ? <StageView snapshot={snapshot} status={display?.status ?? 'live'} embedded hideRail={!display} /> : <div className="display-message"><h1>OpenRoom Slide</h1>
      <p>{supported ? 'Open the OpenRoom pane to load this slide and start participation.' : 'Open this add-in in PowerPoint to embed an OpenRoom slide.'}</p>
    </div>}
    {view !== 'read' ? <div className="embedded-toolbar">
      {error ? <span role="alert">{error}</span> : <span>{display ? 'Live slide' : 'Preview · Start participation in the OpenRoom pane'}</span>}
      {supported ? <button onClick={() => setChoosing(true)}>Choose slide</button> : null}
    </div> : null}
  </div>;
}

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
