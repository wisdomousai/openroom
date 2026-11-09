import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { disconnect, forgetConnection, signIn, storedConnection, type Connection } from './auth';
import { ConnectionExpired, request, RequestError, type Space, type Deck, type DeckDetail } from './api';
import { bindingMatches, parseBinding, readSelection, writeBinding, type SlideSelection, type ActivityBinding } from './bindings';
import { LivePanel } from './LivePanel';
import { parseSlideEmbedCode, type Outline } from '@openroom/schema';
import { slideTitle, useSlidePreview } from './slide-preview';
import { QuestionForm } from './QuestionForm';
import { draftFromInteraction, questionForStep } from './question';
import { createQuestion, DeckUnavailable, readPresentationDeck, updateQuestion, type DeckReference } from './presentation-deck';
import './style.css';
const Rehearsal = lazy(() => import('./RehearsalPanel').then((module) => ({ default: module.Rehearsal })));

const canEdit = (space: Space) => space.role === 'owner' || space.role === 'editor';

export function App({ office, onEmbed }: { office: typeof Office | null; onEmbed?: (binding: ActivityBinding, outline: Outline) => Promise<void> }) {
  const [connection, setConnection] = useState<Connection | null>(() => (office ? storedConnection(office) : null));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [embedCode, setEmbedCode] = useState('');
  const [spaces, setSpaces] = useState<Space[]>([]), [space, setSpace] = useState<Space | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]), [detail, setDetail] = useState<DeckDetail | null>(null);
  const [selection, setSelection] = useState<SlideSelection | null>(null);
  const [loading, setLoading] = useState(false), [reload, setReload] = useState(0);
  const [rehearsal, setRehearsal] = useState<{ outline: Outline; stepId: string } | null>(null);
  // Questions created here live in one OpenRoom deck for this presentation.
  const [presentationDeck, setPresentationDeck] = useState<DeckReference | null>(null);
  const [storageSpace, setStorageSpace] = useState('');
  const [bound, setBound] = useState<DeckDetail | null>(null), [revision, setRevision] = useState(0);
  const [adding, setAdding] = useState(false);
  const [boundError, setBoundError] = useState('');
  // The deck named in this presentation cannot be used any more, so questions go to a new deck.
  const [deckLost, setDeckLost] = useState(false);
  // An edit with changes that are not saved keeps its slide open when another slide is selected.
  const [held, setHeld] = useState<SlideSelection | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false), activeRef = useRef<SlideSelection | null>(null);
  dirtyRef.current = dirty;
  const alert = useRef<HTMLDivElement>(null);
  // Errors render above the form; bring them into view from a button further down.
  useEffect(() => { if (error) { alert.current?.scrollIntoView({ block: 'nearest' }); alert.current?.focus({ preventScroll: true }); } }, [error]);
  const canBind = Boolean(office?.context.requirements.isSetSupported('PowerPointApi', '1.5'));
  const failed = useCallback((cause: unknown) => {
    if (cause instanceof ConnectionExpired) { forgetConnection(office); setConnection(null); setSpace(null); setDetail(null); setSpaces([]); setDecks([]); setBound(null); }
    setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
  }, [office]);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (cause) { failed(cause); } finally { setBusy(false); }
  }
  async function shown(next: SlideSelection, outline: Outline, message: string) {
    setSelection(next);
    if (onEmbed) await onEmbed(parseBinding(next.rawBinding)!, outline);
    else setNotice(message);
  }
  async function embed(detail: DeckDetail, stepId: string) {
    if (!selection) throw new Error('Select one PowerPoint slide first.');
    if (!detail.content?.steps.some((step) => step.id === stepId)) throw new Error('This slide no longer exists in the saved deck. Copy a new embed code in OpenRoom.');
    const selected = await writeBinding(selection, { spaceId: detail.deck.spaceId, deckId: detail.deck.id, stepId });
    await shown(selected, detail.content, 'OpenRoom slide selected. To show it, insert OpenRoom Slide from Home → Add-ins.');
  }
  useEffect(() => {
    if (!connection) return;
    const controller = new AbortController(); setLoading(true); setError('');
    void request<{ spaces: Space[] }>(connection, '/api/my/spaces', controller.signal).then((value) => setSpaces(value.spaces))
      .catch((cause: unknown) => { if (!controller.signal.aborted) failed(cause); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [connection, reload, failed]);
  useEffect(() => {
    if (!connection || !space) { setDecks([]); return; }
    const controller = new AbortController(); setLoading(true);
    void request<{ decks: Deck[] }>(connection, `/api/decks?spaceId=${encodeURIComponent(space.id)}`, controller.signal).then((value) => setDecks(value.decks))
      .catch((cause: unknown) => { if (!controller.signal.aborted) failed(cause); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [connection, space, reload, failed]);
  useEffect(() => {
    if (!office || !canBind) return;
    let stopped = false, generation = 0;
    const refresh = () => {
      const current = ++generation;
      const moved = (next: SlideSelection | null) => { if (dirtyRef.current && activeRef.current && next?.slideId !== activeRef.current.slideId) setHeld(activeRef.current); setSelection(next); };
      void readSelection().then((value) => { if (!stopped && current === generation) moved(value); }).catch(() => { if (!stopped && current === generation) moved(null); });
    };
    refresh();
    office.context.document.addHandlerAsync(office.EventType.DocumentSelectionChanged, refresh);
    return () => { stopped = true; office.context.document.removeHandlerAsync(office.EventType.DocumentSelectionChanged, { handler: refresh }); };
  }, [office, canBind]);
  useEffect(() => {
    if (!office || !canBind) return;
    let stopped = false;
    void readPresentationDeck().then((value) => { if (!stopped) setPresentationDeck(value.reference); }).catch(() => { if (!stopped) setPresentationDeck(null); });
    return () => { stopped = true; };
  }, [office, canBind, selection?.presentationId, revision]);
  useEffect(() => {
    if (!storageSpace) setStorageSpace(spaces.find((item) => item.role === 'owner')?.id ?? spaces.find(canEdit)?.id ?? '');
  }, [spaces, storageSpace]);
  useSlidePreview(connection, selection, revision);
  // The slide the form is for: the selected slide, or the one held open for unsaved changes.
  const active = held ?? selection;
  activeRef.current = active;
  useEffect(() => { if (held && selection?.slideId === held.slideId) setHeld(null); }, [held, selection?.slideId]);
  const binding = parseBinding(active?.rawBinding ?? null);
  const copied = active && binding && !bindingMatches(active, binding);
  const boundHere = active && binding && !copied ? binding : null;
  // The deck behind the selected slide: its title, and the question when it can be edited here.
  useEffect(() => {
    setAdding(false);
    setBoundError('');
    if (!connection || !boundHere) { setBound(null); return; }
    const controller = new AbortController();
    void request<DeckDetail>(connection, `/api/decks/${encodeURIComponent(boundHere.deckId)}`, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setBound(value); })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setBound(null);
        if (cause instanceof ConnectionExpired) failed(cause);
        else setBoundError(cause instanceof RequestError ? cause.message : 'Could not reach OpenRoom. Check your connection and try again.');
      });
    return () => controller.abort();
  }, [connection, boundHere?.deckId, boundHere?.stepId, boundHere?.slideId, revision, failed]);
  const boundQuestion = boundHere && bound?.deck.id === boundHere.deckId ? questionForStep(bound.content, boundHere.stepId) : null;
  const boundStep = boundHere && bound?.deck.id === boundHere.deckId ? bound.content?.steps.find((step) => step.id === boundHere.stepId) ?? null : null;
  const boundSpace = boundHere && bound?.deck.id === boundHere.deckId ? spaces.find((item) => item.id === bound.deck.spaceId) : undefined;
  const editable = boundHere && presentationDeck?.deckId === boundHere.deckId && boundQuestion && boundSpace && canEdit(boundSpace) ? draftFromInteraction(boundQuestion) : null;
  const editableSpaces = spaces.filter(canEdit);
  const deckLink = (deckId: string) => `/host/#/decks/${encodeURIComponent(deckId)}/edit`;

  const create = (draft: Parameters<typeof createQuestion>[3]) => void action(async () => {
    const newDeck = !presentationDeck || deckLost;
    let result: Awaited<ReturnType<typeof createQuestion>>;
    try { result = await createQuestion(connection!, office, active!, draft, newDeck ? storageSpace || null : null, deckLost); }
    catch (cause) { if (cause instanceof DeckUnavailable) setDeckLost(true); throw cause; }
    setPresentationDeck(result.reference); setDeckLost(false); setRevision((value) => value + 1); setAdding(false);
    // The host may have moved to another slide while the question was saved.
    setSelection(await readSelection().catch(() => null));
    if (onEmbed) await onEmbed(parseBinding(result.selection.rawBinding)!, result.detail.content!);
    else setNotice('Question added to this slide. To show it, insert OpenRoom Slide from Home → Add-ins.');
  });
  const save = (draft: Parameters<typeof updateQuestion>[3]) => void action(async () => {
    const detail = await updateQuestion(connection!, boundHere!.deckId, boundHere!.stepId, draft, boundQuestion!);
    setBound(detail); setRevision((value) => value + 1); setHeld(null);
    if (onEmbed) await onEmbed(boundHere!, detail.content!);
    else setNotice('Question saved.');
  });

  function questionSection() {
    if (!canBind) return <p>Update PowerPoint to add questions to slides. Your OpenRoom decks are still available below.</p>;
    if (!active) return <p>Select one slide in PowerPoint to add a question to it.</p>;
    if (boundHere && !adding) {
      if (boundError) return <>
        <h1>OpenRoom slide</h1>
        <p role="status">{boundError}</p>
        <div className="inline-actions">
          <button disabled={busy} onClick={() => setRevision((value) => value + 1)}>Try again</button>
          <button disabled={busy} onClick={() => setAdding(true)}>Replace with a new question</button>
        </div>
      </>;
      if (!bound) return <p role="status">Loading this slide…</p>;
      if (editable) return <>
        <h1>Edit question</h1>
        {held && selection?.slideId !== held.slideId ? <div className="notice" role="status">You selected another slide, but this question has changes that are not saved. <button className="text-button" disabled={busy} onClick={() => setHeld(null)}>Discard changes</button></div> : null}
        <QuestionForm key={`${boundHere.deckId}:${boundHere.stepId}:${revision}`} initial={editable} busy={busy} submitLabel="Save changes" onSubmit={save} onDirtyChange={setDirty}>
          <p className="hint">A session that is already running keeps the version it started with.</p>
        </QuestionForm>
        <a href={deckLink(boundHere.deckId)} target="_blank" rel="noopener noreferrer">More settings in OpenRoom ↗</a>
      </>;
      return <>
        <h1>{boundStep && bound.content ? slideTitle(bound.content, boundStep) : 'OpenRoom slide'}</h1>
        <p>This slide shows a slide from the OpenRoom deck “{bound.deck.title}”. Edit it there, or replace it with a new question.</p>
        <div className="inline-actions">
          <a href={deckLink(boundHere.deckId)} target="_blank" rel="noopener noreferrer">Edit deck</a>
          <button disabled={busy} onClick={() => setAdding(true)}>Replace with a new question</button>
        </div>
      </>;
    }
    return <>
      <h1>{copied ? 'Add a question to this copy' : boundHere ? 'Replace with a new question' : 'Add a question'}</h1>
      <QuestionForm key={active.slideId} busy={busy} submitLabel={onEmbed ? 'Add to this slide' : 'Add to selected slide'} onSubmit={create} onCancel={adding ? () => setAdding(false) : undefined}>
        {deckLost ? <p className="hint">Slides already connected to the earlier deck stay connected to it.</p> : null}
        {presentationDeck && !deckLost ? null : editableSpaces.length ? <label className="field">Save questions in
          <select value={storageSpace} disabled={busy} onChange={(event) => setStorageSpace(event.currentTarget.value)}>
            {editableSpaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label> : spaces.length ? <p className="form-problem">You can present from these spaces but not add decks to them. Ask a space owner for editor access.</p> : null}
      </QuestionForm>
    </>;
  }

  return <main className={onEmbed ? 'embedded' : undefined}>
    <header><span className="brand-mark" aria-hidden="true">O</span><div><strong>OpenRoom</strong><span className="eyebrow">FOR POWERPOINT</span></div></header>
    {error ? <div ref={alert} tabIndex={-1} className="notice error" role="alert">{error}</div> : null}
    {notice ? <div className="notice" role="status">{notice}</div> : null}
    {!connection ? <section className="welcome">
      <h1>Add questions to slides</h1>
      <p>Add polls, word clouds, open questions and Q&A to your PowerPoint slides. Participants answer on their phones or laptops.</p>
      {office ? <button className="primary" disabled={busy} onClick={() => void action(async () => { setConnection(await signIn(office)); })}>{busy ? 'Waiting for sign-in…' : 'Sign in to OpenRoom'}</button> : <div className="notice">Open this add-in from PowerPoint to add questions. If it is already open there, check your connection and reopen the pane.</div>}
      <p className="quiet">Your PowerPoint file stays in PowerPoint. Questions are saved in an OpenRoom deck. Sign-in credentials are never saved in the presentation.</p>
      <a href="/host/" target="_blank" rel="noopener noreferrer">Open OpenRoom in your browser ↗</a>
    </section> : rehearsal ? <Suspense fallback={<p role="status">Opening rehearsal…</p>}><Rehearsal {...rehearsal} onClose={() => setRehearsal(null)} /></Suspense> : <>
      <section className="question" aria-label="Question on the selected slide">{questionSection()}</section>
      {boundHere && !adding && !held ? <section className="selection" aria-label="Selected PowerPoint slide"><div className="inline-actions">
        <button className="text-button" disabled={busy} onClick={() => void action(async () => { setSelection(await writeBinding(selection!, null)); setNotice('OpenRoom slide removed from this PowerPoint slide.'); })}>Remove OpenRoom slide</button>
      </div></section> : null}
      {canBind && !onEmbed ? <LivePanel connection={connection} selection={selection} failed={(cause) => { if (cause instanceof ConnectionExpired) failed(cause); }} onRehearse={() => void action(async () => {
        const selected = await readSelection(), activity = parseBinding(selected.rawBinding);
        if (!activity || !bindingMatches(selected, activity)) throw new Error('Choose an OpenRoom slide before rehearsing.');
        const value = await request<DeckDetail>(connection, `/api/decks/${encodeURIComponent(activity.deckId)}`);
        if (!value.content?.steps.some((step) => step.id === activity.stepId)) throw new Error('This slide changed. Choose a saved slide again.');
        setRehearsal({ outline: value.content, stepId: activity.stepId });
      })} /> : null}
      <details className="library">
        <summary>Use a slide from an OpenRoom deck</summary>
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
        <nav aria-label="Choose content"><button className="text-button" disabled={busy} onClick={() => { setSpace(null); setDetail(null); setDecks([]); setReload((value) => value + 1); }}>Spaces</button>{space ? <><span aria-hidden="true">/</span><button className="text-button" disabled={busy} onClick={() => setDetail(null)}>{space.name}</button></> : null}</nav>
        {copied ? <p className="hint">This slide was copied. Choose a slide below to embed in this copy, or add a new question above.</p> : null}
        {loading ? <p role="status">Loading…</p> : detail ? <section><h2 className="deck-title">{detail.deck.title}</h2><a href={deckLink(detail.deck.id)} target="_blank" rel="noopener noreferrer">Edit deck in OpenRoom ↗</a>
          <p>Every slide can be embedded, including content, media, exercises, and questions.</p>
          <ul className="items activities">{detail.content?.steps.map((step, index) => {
            const connected = boundHere && boundHere.deckId === detail.deck.id && boundHere.stepId === step.id;
            return <li key={step.id}><span className="eyebrow">Slide {index + 1} · {step.kind === 'interaction' ? 'Question' : step.kind}{step.breakoutOf ? ' · Detail' : ''}</span><h2>{slideTitle(detail.content!, step)}</h2><button className={connected && !onEmbed ? '' : 'primary'} disabled={busy || !selection || !canBind || Boolean(connected && !onEmbed)} onClick={() => void action(async () => {
              const fresh = await request<DeckDetail>(connection, `/api/decks/${encodeURIComponent(detail.deck.id)}`);
              if (fresh.deck.spaceId !== detail.deck.spaceId || !fresh.content?.steps.some((item) => item.id === step.id)) throw new Error('This slide changed. Reopen the deck and choose it again.');
              await embed(fresh, step.id);
            })}>{onEmbed ? 'Embed slide' : connected ? 'Selected for this slide' : boundHere ? 'Replace OpenRoom slide' : 'Use on selected slide'}</button></li>;
          })}</ul>{!detail.content?.steps.length ? <p>This deck has no slides yet. Open it in OpenRoom to add one.</p> : null}
        </section> : space ? <section><h2>Choose a deck</h2><ul className="items">{decks.map((deck) => <li key={deck.id}><button className="item-button" disabled={busy} onClick={() => void action(async () => { setDetail(await request<DeckDetail>(connection, `/api/decks/${encodeURIComponent(deck.id)}`)); })}>{deck.title}<span aria-hidden="true">→</span></button></li>)}</ul>{decks.length === 0 ? <p>No decks here yet. <a href={`/host/#/space/${encodeURIComponent(space.id)}`} target="_blank" rel="noopener noreferrer">Open this space ↗</a></p> : null}</section> : <section><h2>Choose a space</h2><ul className="items">{spaces.map((item) => <li key={item.id}><button className="item-button" disabled={busy} onClick={() => { setSpace(item); setDetail(null); }}>{item.name}<span aria-hidden="true">→</span></button></li>)}</ul></section>}
      </details>
      {error ? <button disabled={busy} onClick={() => { setReload((value) => value + 1); setRevision((value) => value + 1); }}>Reload content</button> : null}
      <footer><a href="/host/#/settings" target="_blank" rel="noopener noreferrer">Manage connections ↗</a><button className="text-button" disabled={busy} onClick={() => void action(async () => { await disconnect(connection); forgetConnection(office); setConnection(null); setSpace(null); setDetail(null); setSpaces([]); setDecks([]); setBound(null); })}>Sign out</button></footer>
    </>}
  </main>;
}
