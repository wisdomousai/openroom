import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Outline } from '@openroom/schema';
import { RequestError, type DeckDetail } from './api';
import type { Connection } from './auth';
import { ACTIVITY_TAG, readSelection } from './bindings';
import { addQuestion, emptyDraft, newOutline, questionForStep, type QuestionDraft } from './question';
import { createQuestion, DECK_TAG, DeckUnavailable, QuestionChanged, updateQuestion } from './presentation-deck';

const requestMock = vi.hoisted(() => vi.fn());
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), request: requestMock }));

const connection: Connection = { token: 't', expiresAt: Date.now() + 1e6 } as Connection;
const presentationId = '7c2f1d1e-4b7a-4d3a-9a51-0b2e6f1c9d10';
const draft = (prompt = 'Which topic?'): QuestionDraft => ({ ...emptyDraft('choice'), prompt, options: [{ label: 'One', correct: false }, { label: 'Two', correct: false }] });

/** A presentation with tags on the deck and on each slide, and a selection that can move. */
function file(slides = ['42']) {
  const presentationTags = new Map<string, string>(), slideTags = new Map(slides.map((id) => [id, new Map<string, string>()]));
  let selected = slides[0]!;
  const tags = (values: Map<string, string>) => ({
    getItemOrNullObject: (key: string) => ({ value: values.get(key), isNullObject: !values.has(key), load() {} }),
    add: (key: string, value: string) => values.set(key, value), delete: (key: string) => values.delete(key),
  });
  const slide = (id: string) => ({ id, tags: tags(slideTags.get(id)!), isNullObject: false, load() {} });
  vi.stubGlobal('PowerPoint', { run: (work: (context: unknown) => unknown) => work({ sync: () => Promise.resolve(), presentation: {
    slides: { getItemOrNullObject: (id: string) => slideTags.has(id) ? slide(id) : { isNullObject: true, load() {} } },
    tags: tags(presentationTags), getSelectedSlides: () => ({ items: [slide(selected)], load() {} }),
  } }) });
  return { presentationTags, slideTags, select: (id: string) => { selected = id; } };
}

/** Fake worker: one deck per ID with a version counter, an optional editor draft, and scripted failures. */
function worker(decks: Record<string, { content: Outline | null; version: number; draft?: boolean }>, options: { conflicts?: number; onConflict?: () => void; failVersions?: RequestError; failGet?: RequestError } = {}) {
  const posts: { path: string; body: { content: Outline; baseVersion: number } }[] = [], deleted: string[] = [];
  let conflicts = options.conflicts ?? 0, created = 0;
  requestMock.mockImplementation(async (_connection: Connection, path: string, _signal?: AbortSignal, body?: { content: Outline; baseVersion: number; spaceId?: string; title?: string }, method?: string) => {
    if (path === '/api/decks' && body) { created += 1; const id = `new-${created}`; decks[id] = { content: body.content, version: 1 }; return { deck: { id, title: body.title, spaceId: body.spaceId } }; }
    const [, , , id = "", tail] = path.split("/"), deck = decks[id];
    if (method === 'DELETE') { deleted.push(id); return { ok: true }; }
    if (options.failGet && !tail) throw options.failGet;
    if (!deck) throw new RequestError(404, 'not-found', 'gone');
    if (tail === 'draft') { if (deck.draft) return { deckId: id }; throw new RequestError(404, 'not-found', 'none'); }
    if (tail === 'versions') {
      if (options.failVersions) throw options.failVersions;
      if (conflicts > 0) { conflicts -= 1; options.onConflict?.(); throw new RequestError(409, 'version-conflict', 'conflict'); }
      posts.push({ path, body: body! }); deck.content = body!.content; deck.version += 1; return { ok: true };
    }
    return { deck: { id, title: 'Deck', spaceId: 'space-1' }, content: deck.content, contentVersion: deck.version } satisfies DeckDetail & { deck: unknown };
  });
  return { posts, deleted };
}

beforeEach(() => { requestMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('saving from the pane', () => {
  const start = () => { const { outline, stepId } = addQuestion(newOutline('Deck'), draft('Before')); return { outline, stepId }; };

  it('stops when the deck editor holds an unsaved draft', async () => {
    const { outline, stepId } = start(), decks = { d1: { content: outline, version: 1, draft: true } }, { posts } = worker(decks);
    await expect(updateQuestion(connection, 'd1', stepId, draft('After'), questionForStep(outline, stepId)!)).rejects.toThrow('unsaved changes in the OpenRoom editor');
    expect(posts).toHaveLength(0);
  });

  it('does not write over a question that changed after the form was opened', async () => {
    const { outline, stepId } = start(), opened = questionForStep(outline, stepId)!;
    const newer = { ...outline, interactions: outline.interactions.map((item) => ({ ...item, prompt: 'Changed in OpenRoom' })) } as Outline;
    const { posts } = worker({ d1: { content: newer, version: 2 } });
    await expect(updateQuestion(connection, 'd1', stepId, draft('After'), opened)).rejects.toBeInstanceOf(QuestionChanged);
    expect(posts).toHaveLength(0);
  });

  it('retries a version conflict only while the question is unchanged', async () => {
    const { outline, stepId } = start(), opened = questionForStep(outline, stepId)!;
    const decks: Record<string, { content: Outline | null; version: number }> = { d1: { content: outline, version: 1 } };
    // Another slide is added elsewhere: the edit still applies, on top of it.
    const other = addQuestion(outline, draft('Elsewhere')).outline;
    const unrelated = worker(decks, { conflicts: 1, onConflict: () => { decks.d1 = { content: other, version: 2 }; } });
    await updateQuestion(connection, 'd1', stepId, draft('After'), opened);
    expect(unrelated.posts).toHaveLength(1);
    expect(unrelated.posts[0]!.body.baseVersion).toBe(2);
    expect(unrelated.posts[0]!.body.content.steps).toHaveLength(2);
    expect(questionForStep(unrelated.posts[0]!.body.content, stepId)).toMatchObject({ prompt: 'After' });
    // The same question is edited elsewhere: nothing is written.
    const decks2: Record<string, { content: Outline | null; version: number }> = { d1: { content: outline, version: 1 } };
    const changed = { ...outline, interactions: outline.interactions.map((item) => ({ ...item, prompt: 'Elsewhere' })) } as Outline;
    const conflicting = worker(decks2, { conflicts: 1, onConflict: () => { decks2.d1 = { content: changed, version: 2 }; } });
    await expect(updateQuestion(connection, 'd1', stepId, draft('After'), opened)).rejects.toBeInstanceOf(QuestionChanged);
    expect(conflicting.posts).toHaveLength(0);
  });
});

describe('adding a question from the pane', () => {
  const selection = () => readSelection();

  it('reports a deck that is gone, in the trash or not writable', async () => {
    for (const failure of [new RequestError(404, 'not-found', 'x'), new RequestError(403, 'forbidden', 'x'), new RequestError(409, 'resource-in-trash', 'x')]) {
      const slides = file();
      slides.presentationTags.set('OPENROOM_PRESENTATION', presentationId);
      slides.presentationTags.set(DECK_TAG, JSON.stringify({ version: 1, presentationId, spaceId: 'space-1', deckId: 'd1' }));
      worker({ d1: { content: newOutline('Deck'), version: 1 } }, { failVersions: failure.status === 404 ? undefined : failure, failGet: failure.status === 404 ? failure : undefined });
      await expect(createQuestion(connection, null, await selection(), draft(), null)).rejects.toBeInstanceOf(DeckUnavailable);
      expect(slides.slideTags.get('42')!.has(ACTIVITY_TAG)).toBe(false);
    }
  });

  it('creates a new deck and replaces the tag when asked to', async () => {
    const slides = file();
    slides.presentationTags.set('OPENROOM_PRESENTATION', presentationId);
    slides.presentationTags.set(DECK_TAG, JSON.stringify({ version: 1, presentationId, spaceId: 'space-1', deckId: 'gone' }));
    worker({});
    const result = await createQuestion(connection, null, await selection(), draft(), 'space-2', true);
    expect(result.reference).toMatchObject({ deckId: 'new-1', spaceId: 'space-2', presentationId });
    expect(JSON.parse(slides.presentationTags.get(DECK_TAG)!).deckId).toBe('new-1');
    expect(JSON.parse(slides.slideTags.get('42')!.get(ACTIVITY_TAG)!)).toMatchObject({ deckId: 'new-1', slideId: '42' });
  });

  it('refuses before saving anything when the selected slide has changed', async () => {
    const slides = file(['42', '99']);
    worker({});
    const stale = await selection();
    slides.slideTags.get('42')!.set(ACTIVITY_TAG, '{}');
    await expect(createQuestion(connection, null, stale, draft(), 'space-1')).rejects.toThrow('selected slide changed');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('connects the slide the question was written for, not the one selected now', async () => {
    const slides = file(['42', '99']);
    worker({});
    const written = await selection();
    slides.select('99');
    const result = await createQuestion(connection, null, written, draft(), 'space-1');
    expect(result.selection.slideId).toBe('42');
    expect(slides.slideTags.get('42')!.has(ACTIVITY_TAG)).toBe(true);
    expect(slides.slideTags.get('99')!.has(ACTIVITY_TAG)).toBe(false);
  });

  it('uses the deck another window recorded first and drops the one just made', async () => {
    const slides = file(), mine = await selection();
    const theirs = addQuestion(newOutline('Theirs'), draft('First window')).outline;
    const { posts, deleted } = worker({ winner: { content: theirs, version: 1 } });
    // Another window records its deck while this one is creating its own.
    const create = requestMock.getMockImplementation()!;
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const result = await create(...args);
      if (args[1] === '/api/decks') slides.presentationTags.set('OPENROOM_PRESENTATION', presentationId), slides.presentationTags.set(DECK_TAG, JSON.stringify({ version: 1, presentationId, spaceId: 'space-1', deckId: 'winner' }));
      return result;
    });
    const result = await createQuestion(connection, null, mine, draft('Second window'), 'space-1');
    expect(result.reference.deckId).toBe('winner');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.content.interactions.map((item) => item.prompt)).toEqual(['First window', 'Second window']);
    expect(deleted).toEqual(['new-1']);
    expect(JSON.parse(slides.slideTags.get('42')!.get(ACTIVITY_TAG)!)).toMatchObject({ deckId: 'winner' });
  });
});
