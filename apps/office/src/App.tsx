import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { disconnect, signIn, type Connection } from './auth';
import { ConnectionExpired, request, type Space, type Deck, type DeckDetail } from './api';
import { bindingMatches, parseBinding, readSelection, writeBinding, type SlideSelection, type ActivityBinding } from './bindings';
import { LivePanel } from './LivePanel';
import { parseSlideEmbedCode, type Outline } from '@openroom/schema';
import { slideTitle, useSlidePreview } from './slide-preview';
import './style.css';
const Rehearsal = lazy(() => import('./RehearsalPanel').then((module) => ({ default: module.Rehearsal })));

export function App({ office, onEmbed }: { office: typeof Office | null; onEmbed?: (binding: ActivityBinding, outline: Outline) => Promise<void> }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [embedCode, setEmbedCode] = useState('');
  const [spaces, setSpaces] = useState<Space[]>([]), [space, setSpace] = useState<Space | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]), [detail, setDetail] = useState<DeckDetail | null>(null);
  const [selection, setSelection] = useState<SlideSelection | null>(null);
  const [loading, setLoading] = useState(false), [reload, setReload] = useState(0);
  const [rehearsal, setRehearsal] = useState<{ outline: Outline; stepId: string } | null>(null);
  const canBind = Boolean(office?.context.requirements.isSetSupported('PowerPointApi', '1.5'));
  const failed = useCallback((cause: unknown) => {
    if (cause instanceof ConnectionExpired) { setConnection(null); setSpace(null); setDetail(null); setSpaces([]); setDecks([]); }
    setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
  }, []);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (cause) { failed(cause); } finally { setBusy(false); }
  }
  async function embed(detail: DeckDetail, stepId: string) {
    if (!selection) throw new Error('Select one PowerPoint slide first.');
    if (!detail.content?.steps.some((step) => step.id === stepId)) throw new Error('This slide no longer exists in the saved deck. Copy a new embed code in OpenRoom.');
    const selected = await writeBinding(selection, { spaceId: detail.deck.spaceId, deckId: detail.deck.id, stepId });
    setSelection(selected);
    if (onEmbed) await onEmbed(parseBinding(selected.rawBinding)!, detail.content);
    else setNotice('OpenRoom slide selected. Insert OpenRoom Slide from PowerPoint’s Add-ins menu to display it.');
  }
  useEffect(() => {
    if (!connection) return;
    const controller = new AbortController(); setLoading(true); setError('');
    void (space ? request<{ decks: Deck[] }>(connection, `/api/decks?spaceId=${encodeURIComponent(space.id)}`, controller.signal).then((value) => setDecks(value.decks)) : request<{ spaces: Space[] }>(connection, '/api/my/spaces', controller.signal).then((value) => setSpaces(value.spaces)))
      .catch((cause: unknown) => { if (!controller.signal.aborted) failed(cause); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [connection, space, reload, failed]);
  useEffect(() => {
    if (!office || !canBind) return;
    let stopped = false, generation = 0;
    const refresh = () => {
      const current = ++generation;
      void readSelection().then((value) => { if (!stopped && current === generation) setSelection(value); }).catch(() => { if (!stopped && current === generation) setSelection(null); });
    };
    refresh();
    office.context.document.addHandlerAsync(office.EventType.DocumentSelectionChanged, refresh);
    return () => { stopped = true; office.context.document.removeHandlerAsync(office.EventType.DocumentSelectionChanged, { handler: refresh }); };
  }, [office, canBind]);
  useSlidePreview(connection, selection);
  const binding = parseBinding(selection?.rawBinding ?? null);
  const copied = selection && binding && !bindingMatches(selection, binding);
  const boundHere = selection && binding && !copied;
  return <main>
    <header><span className="brand-mark" aria-hidden="true">O</span><div><strong>OpenRoom</strong><span className="eyebrow">FOR POWERPOINT</span></div></header>
    {error ? <div className="notice error" role="alert">{error}</div> : null}
    {notice ? <div className="notice" role="status">{notice}</div> : null}
    {!connection ? <section className="welcome">
      <span className="eyebrow">MAKE ROOM FOR EVERY VOICE</span><h1>Your slides.<br />A shared conversation.</h1>
      <p>Choose any slide from an OpenRoom deck to embed in your presentation.</p>
      {office ? <button className="primary" disabled={busy} onClick={() => void action(async () => { setConnection(await signIn(office)); })}>{busy ? 'Waiting for sign-in…' : 'Sign in to OpenRoom'}</button> : <div className="notice">Open this add-in from PowerPoint to embed slides. If it is already open there, check your connection and reopen the pane.</div>}
      <p className="quiet">Your PowerPoint file stays in PowerPoint. Sign-in credentials are never saved in the presentation.</p>
      <a href="/host/" target="_blank" rel="noopener noreferrer">Open OpenRoom in your browser ↗</a>
    </section> : rehearsal ? <Suspense fallback={<p role="status">Opening rehearsal…</p>}><Rehearsal {...rehearsal} onClose={() => setRehearsal(null)} /></Suspense> : <>
      <section className="embed-code" aria-label="Embed a slide by code">
        <h2>Paste an embed code</h2>
        <p>In the OpenRoom editor, select a slide and choose Copy embed code.</p>
        <form onSubmit={(event) => { event.preventDefault(); void action(async () => {
          const reference = parseSlideEmbedCode(embedCode);
          if (!reference) throw new Error('Paste a slide embed code copied from OpenRoom.');
          const fresh = await request<DeckDetail>(connection, `/api/decks/${encodeURIComponent(reference.deckId)}`);
          await embed(fresh, reference.stepId);
          setDetail(fresh);
          setSpace({ id: fresh.deck.spaceId, name: spaces.find((item) => item.id === fresh.deck.spaceId)?.name ?? 'Space', role: 'presenter' });
        }); }}>
          <input aria-label="Slide embed code" placeholder="openroom-slide:1:…" value={embedCode} onChange={(event) => setEmbedCode(event.currentTarget.value)} />
          <button className="primary" disabled={busy || !selection || !canBind || !parseSlideEmbedCode(embedCode)}>Embed slide</button>
        </form>
      </section>
      <nav aria-label="Choose content"><button className="text-button" disabled={busy} onClick={() => { setSpace(null); setDetail(null); setDecks([]); }}>Spaces</button>{space ? <><span aria-hidden="true">/</span><button className="text-button" disabled={busy} onClick={() => setDetail(null)}>{space.name}</button></> : null}</nav>
      <section className="selection" aria-label="Selected PowerPoint slide"><div className="section-title"><h2>Selected slide</h2><button className="text-button" disabled={busy || !canBind} onClick={() => void action(async () => { setSelection(await readSelection()); })}>Refresh</button></div>
        {!canBind ? <p>Update PowerPoint to connect a selected slide. Your OpenRoom decks are still available below.</p> : !selection ? <p>Select one slide in PowerPoint, then refresh.</p> : boundHere ? <><p>OpenRoom slide selected.</p><div className="inline-actions"><button disabled={busy} onClick={() => void action(async () => { const value = await request<DeckDetail>(connection, `/api/decks/${encodeURIComponent(binding.deckId)}`); setSpace({ id: value.deck.spaceId, name: spaces.find((item) => item.id === value.deck.spaceId)?.name ?? 'Space', role: 'presenter' }); setDetail(value); })}>View source deck</button><button className="text-button" disabled={busy} onClick={() => void action(async () => { setSelection(await writeBinding(selection, null)); setNotice('OpenRoom slide removed from this PowerPoint slide.'); })}>Remove OpenRoom slide</button></div></> : <p>{copied ? 'This slide was copied. Choose a slide below to embed in this copy.' : selection.rawBinding ? 'This slide has an unreadable reference. Choose a slide to replace it.' : 'Choose an OpenRoom slide below. To display it, insert OpenRoom Slide from PowerPoint’s Add-ins menu.'}</p>}
      </section>
      {canBind && !onEmbed ? <LivePanel connection={connection} selection={selection} failed={(cause) => { if (cause instanceof ConnectionExpired) failed(cause); }} onRehearse={() => void action(async () => {
        const selected = await readSelection(), activity = parseBinding(selected.rawBinding);
        if (!activity || !bindingMatches(selected, activity)) throw new Error('Choose an OpenRoom slide before rehearsing.');
        const value = await request<DeckDetail>(connection, `/api/decks/${encodeURIComponent(activity.deckId)}`);
        if (!value.content?.steps.some((step) => step.id === activity.stepId)) throw new Error('This slide changed. Choose a saved slide again.');
        setRehearsal({ outline: value.content, stepId: activity.stepId });
      })} /> : null}
      {loading ? <p role="status">Loading…</p> : detail ? <section><span className="eyebrow">DECK SLIDES</span><h1>{detail.deck.title}</h1><a href={`/host/#/decks/${encodeURIComponent(detail.deck.id)}/edit`} target="_blank" rel="noopener noreferrer">Edit deck in OpenRoom ↗</a>
        <p>Every slide can be embedded, including content, media, exercises, and questions.</p>
        <ul className="items activities">{detail.content?.steps.map((step, index) => {
          const connected = boundHere && binding.deckId === detail.deck.id && binding.stepId === step.id;
          return <li key={step.id}><span className="eyebrow">Slide {index + 1} · {step.kind === 'interaction' ? 'Question' : step.kind}{step.breakoutOf ? ' · Detail' : ''}</span><h2>{slideTitle(detail.content!, step)}</h2><button className={connected && !onEmbed ? '' : 'primary'} disabled={busy || !selection || !canBind || Boolean(connected && !onEmbed)} onClick={() => void action(async () => {
            const fresh = await request<DeckDetail>(connection, `/api/decks/${encodeURIComponent(detail.deck.id)}`);
            if (fresh.deck.spaceId !== detail.deck.spaceId || !fresh.content?.steps.some((item) => item.id === step.id)) throw new Error('This slide changed. Reopen the deck and choose it again.');
            await embed(fresh, step.id);
          })}>{onEmbed ? 'Embed slide' : connected ? 'Selected for this slide' : boundHere ? 'Replace OpenRoom slide' : 'Use on selected slide'}</button></li>;
        })}</ul>{!detail.content?.steps.length ? <p>This deck has no slides yet. Open it in OpenRoom to add one.</p> : null}
      </section> : space ? <section><h1>Choose a deck</h1><p>Open a deck to choose any of its slides.</p><ul className="items">{decks.map((deck) => <li key={deck.id}><button className="item-button" disabled={busy} onClick={() => void action(async () => { setDetail(await request<DeckDetail>(connection, `/api/decks/${encodeURIComponent(deck.id)}`)); })}>{deck.title}<span aria-hidden="true">→</span></button></li>)}</ul>{decks.length === 0 ? <p>No decks here yet. <a href={`/host/#/space/${encodeURIComponent(space.id)}`} target="_blank" rel="noopener noreferrer">Open this space ↗</a></p> : null}</section> : <section><h1>Choose a space</h1><p>Use your own decks or a space shared with you.</p><ul className="items">{spaces.map((item) => <li key={item.id}><button className="item-button" disabled={busy} onClick={() => { setSpace(item); setDetail(null); }}>{item.name}<span aria-hidden="true">→</span></button></li>)}</ul></section>}
      {error ? <button disabled={busy} onClick={() => setReload((value) => value + 1)}>Reload content</button> : null}
      <footer><a href="/host/#/settings" target="_blank" rel="noopener noreferrer">Manage connections ↗</a><button className="text-button" disabled={busy} onClick={() => void action(async () => { await disconnect(connection); setConnection(null); setSpace(null); setDetail(null); setSpaces([]); setDecks([]); })}>Sign out</button></footer>
    </>}
  </main>;
}
