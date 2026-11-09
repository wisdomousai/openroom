import type { Interaction, Outline } from '@openroom/schema';
import { request, RequestError, type Deck, type DeckDetail } from './api';
import type { Connection } from './auth';
import { PRESENTATION_TAG, readSlide, writeBindingToSlide, type SlideSelection } from './bindings';
import { addQuestion, newOutline, questionForStep, replaceQuestion, type QuestionDraft } from './question';

/** The OpenRoom deck that holds the questions created in this presentation. A reference, never a credential. */
export const DECK_TAG = 'OPENROOM_DECK';
export interface DeckReference { version: 1; presentationId: string; spaceId: string; deckId: string }
export interface PresentationDeck { presentationId: string | null; reference: DeckReference | null }

const reference = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export function parseDeckReference(raw: string | null, presentationId: string | null): DeckReference | null {
  if (!raw || raw.length > 1000) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || Array.isArray(value) || Object.keys(value).length !== 4 || value.version !== 1 || !uuid(value.presentationId) || value.presentationId !== presentationId || !reference(value.spaceId) || !reference(value.deckId)) return null;
    return { version: 1, presentationId: value.presentationId, spaceId: value.spaceId, deckId: value.deckId };
  } catch { return null; }
}

export function readPresentationDeck(): Promise<PresentationDeck> {
  return PowerPoint.run(async (context) => {
    const presentation = context.presentation.tags.getItemOrNullObject(PRESENTATION_TAG);
    const deck = context.presentation.tags.getItemOrNullObject(DECK_TAG);
    presentation.load('value'); deck.load('value'); await context.sync();
    const presentationId = presentation.isNullObject ? null : presentation.value;
    return { presentationId, reference: parseDeckReference(deck.isNullObject ? null : deck.value, presentationId) };
  });
}

/** The deck named by this presentation's tag cannot be used: it is gone, in the trash, or not writable for this account. */
export class DeckUnavailable extends Error {
  constructor() { super('The OpenRoom deck for this presentation is not available. Save the questions in a new deck.'); }
}
/** The question was edited in OpenRoom after the form was opened. */
export class QuestionChanged extends Error {
  constructor() { super('This question changed in OpenRoom. Reload it.'); }
}

const unavailable = (cause: unknown) => cause instanceof RequestError && (cause.status === 403 || cause.status === 404 || cause.code === 'resource-in-trash') ? new DeckUnavailable() : cause;

/**
 * Record the deck once it exists. The presentation ID is created here when no slide has one yet.
 * The tag is read again inside the write: when another window recorded a deck first, that deck wins
 * (unless the caller is replacing an unusable deck) and `created` is false.
 */
async function writePresentationDeck(spaceId: string, deckId: string, replace: boolean): Promise<{ reference: DeckReference; created: boolean }> {
  return PowerPoint.run(async (context) => {
    const presentation = context.presentation.tags.getItemOrNullObject(PRESENTATION_TAG);
    const deck = context.presentation.tags.getItemOrNullObject(DECK_TAG);
    presentation.load('value'); deck.load('value'); await context.sync();
    const presentationId = !presentation.isNullObject && uuid(presentation.value) ? presentation.value : crypto.randomUUID();
    if (!replace) {
      const existing = parseDeckReference(deck.isNullObject ? null : deck.value, presentationId);
      if (existing) return { reference: existing, created: false };
    }
    const value = parseDeckReference(JSON.stringify({ version: 1, presentationId, spaceId, deckId }), presentationId);
    if (!value) throw new Error('Could not save the deck reference in this presentation.');
    context.presentation.tags.add(PRESENTATION_TAG, presentationId);
    context.presentation.tags.add(DECK_TAG, JSON.stringify(value));
    await context.sync();
    return { reference: value, created: true };
  });
}

/** The file name without its extension, or a plain fallback for a file that was never saved. */
export function presentationTitle(office: typeof Office | null): string {
  const url = office?.context.document.url ?? '';
  // A web address can carry a query or fragment; a file path can contain ? and # in the name.
  const last = (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url.split(/[?#]/)[0]! : url).split(/[\\/]/).pop() ?? '';
  let name = last;
  try { name = decodeURIComponent(last); } catch { /* a literal % in the name */ }
  return (name.replace(/\.(pptx|pptm|ppt|potx)$/i, '').trim() || 'PowerPoint questions').slice(0, 200);
}

/** The deck editor autosaves a draft; a new version would delete it, so stop and ask the host to save there first. */
async function refuseEditorDraft(connection: Connection, deckId: string): Promise<void> {
  try { await request(connection, `/api/decks/${encodeURIComponent(deckId)}/draft`); }
  catch (cause) { if (cause instanceof RequestError && cause.status === 404) return; throw cause; }
  throw new Error('This deck has unsaved changes in the OpenRoom editor. Save them there first.');
}

async function saveVersion(connection: Connection, deckId: string, change: (outline: Outline) => Outline): Promise<DeckDetail> {
  // One retry covers an edit saved elsewhere between reading and writing. The change is
  // applied to what was read again, so it must still hold for that content.
  for (let attempt = 0; ; attempt += 1) {
    const current = await request<DeckDetail>(connection, `/api/decks/${encodeURIComponent(deckId)}`);
    await refuseEditorDraft(connection, deckId);
    const outline = change(current.content ?? newOutline(current.deck.title));
    try {
      await request(connection, `/api/decks/${encodeURIComponent(deckId)}/versions`, undefined, { content: outline, baseVersion: current.contentVersion ?? 0 });
      // Return what the server now holds, so a later edit compares against that.
      return await request<DeckDetail>(connection, `/api/decks/${encodeURIComponent(deckId)}`);
    } catch (cause) {
      if (attempt === 0 && cause instanceof RequestError && cause.code === 'version-conflict') continue;
      throw cause;
    }
  }
}

export interface CreatedQuestion { detail: DeckDetail; stepId: string; selection: SlideSelection; reference: DeckReference }

/**
 * Create the question in this presentation's deck (creating the deck on first use)
 * and connect it to the slide it was written for. `replaceDeck` ignores the saved
 * deck reference and creates a new deck, for a deck that can no longer be used.
 */
export async function createQuestion(connection: Connection, office: typeof Office | null, selection: SlideSelection, draft: QuestionDraft, spaceId: string | null, replaceDeck = false): Promise<CreatedQuestion> {
  const now = await readSlide(selection.slideId);
  if (!now || now.presentationId !== selection.presentationId || now.rawBinding !== selection.rawBinding) throw new Error('The selected slide changed. Select it and try again.');
  const append = async (reference: DeckReference) => {
    let stepId = '';
    try {
      const detail = await saveVersion(connection, reference.deckId, (outline) => { const next = addQuestion(outline, draft); stepId = next.stepId; return next.outline; });
      return { detail, stepId };
    } catch (cause) { throw unavailable(cause); }
  };
  const saved = replaceDeck ? null : (await readPresentationDeck()).reference;
  let reference: DeckReference, result: { detail: DeckDetail; stepId: string };
  if (saved) {
    reference = saved; result = await append(saved);
  } else {
    if (!spaceId) throw new Error('Choose where to save the questions.');
    const title = presentationTitle(office);
    const created = addQuestion(newOutline(title), draft);
    const response = await request<{ deck: Deck }>(connection, '/api/decks', undefined, { spaceId, title, shape: 'lecture', content: created.outline });
    const written = await writePresentationDeck(response.deck.spaceId, response.deck.id, replaceDeck);
    reference = written.reference;
    if (written.created) result = { detail: { deck: response.deck, content: created.outline }, stepId: created.stepId };
    else {
      // Another window recorded a deck first. Use it and drop the one just made.
      await request(connection, `/api/decks/${encodeURIComponent(response.deck.id)}`, undefined, undefined, 'DELETE').catch(() => undefined);
      result = await append(written.reference);
    }
  }
  const connected = await writeBindingToSlide({ ...selection, presentationId: reference.presentationId }, { spaceId: result.detail.deck.spaceId, deckId: result.detail.deck.id, stepId: result.stepId });
  return { ...result, selection: connected, reference };
}

/** Save an edit to the question the form was opened from. A newer change to that question in OpenRoom is never overwritten. */
export async function updateQuestion(connection: Connection, deckId: string, stepId: string, draft: QuestionDraft, opened: Interaction): Promise<DeckDetail> {
  return saveVersion(connection, deckId, (outline) => {
    const latest = questionForStep(outline, stepId);
    if (latest && JSON.stringify(latest) !== JSON.stringify(opened)) throw new QuestionChanged();
    return replaceQuestion(outline, stepId, draft);
  });
}
