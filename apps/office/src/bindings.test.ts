import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_TAG, PRESENTATION_TAG, SESSION_TAG, bindingMatches, parseBinding, parseSessionReference, readPresentationActivities, readSelection, readSessionReference, writeBinding, writeSessionReference } from './bindings';

afterEach(() => vi.unstubAllGlobals());
function presentation() {
  const presentationTags = new Map<string, string>(), slideTags = new Map<string, Map<string, string>>();
  let selectedIds = ['42'];
  const tags = (values: Map<string, string>) => ({
    getItemOrNullObject: (key: string) => ({ value: values.get(key), isNullObject: !values.has(key), load() {} }),
    add: (key: string, value: string) => values.set(key, value), delete: (key: string) => values.delete(key),
  });
  const slide = (id: string) => { if (!slideTags.has(id)) slideTags.set(id, new Map()); return { id, tags: tags(slideTags.get(id)!) }; };
  vi.stubGlobal('PowerPoint', { run: (work: (context: unknown) => unknown) => work({ sync: () => Promise.resolve(), presentation: { slides: { get items() { return [...slideTags.keys()].map(slide); }, load() {} }, tags: tags(presentationTags), getSelectedSlides: () => ({ items: selectedIds.map(slide), load() {} }) } }) });
  return { presentationTags, slideTags, select: (...ids: string[]) => { selectedIds = ids; } };
}

describe('PowerPoint activity references', () => {
  it('persists only references, reopens the binding, and requires explicit reconnection after copying a slide', async () => {
    const file = presentation(), initial = await readSelection();
    expect(file.presentationTags.size).toBe(0);
    const connected = await writeBinding(initial, { spaceId: 'space-1', deckId: 'deck-1', stepId: 'question-1' });
    const binding = parseBinding(connected.rawBinding)!;
    expect(bindingMatches(await readSelection(), binding)).toBe(true);
    expect(Object.keys(binding).sort()).toEqual(['deckId', 'presentationId', 'slideId', 'spaceId', 'stepId', 'version']);
    expect(file.presentationTags.get(PRESENTATION_TAG)).toBe(binding.presentationId);
    file.slideTags.set('88', new Map([[ACTIVITY_TAG, connected.rawBinding!]])); file.select('88');
    const copy = await readSelection(); expect(bindingMatches(copy, binding)).toBe(false);
    const reconnected = await writeBinding(copy, { spaceId: binding.spaceId, deckId: binding.deckId, stepId: binding.stepId });
    expect(parseBinding(reconnected.rawBinding)?.slideId).toBe('88');
    expect(file.slideTags.get('42')!.get(ACTIVITY_TAG)).toBe(connected.rawBinding);
    await writeBinding(reconnected, null);
    expect((await readSelection()).rawBinding).toBeNull();
  });
  it('does not overwrite a different slide or another edit, and rejects multi-selection', async () => {
    const file = presentation(), original = await readSelection();
    file.select('99');
    await expect(writeBinding(original, { spaceId: 's', deckId: 'd', stepId: 'a' })).rejects.toThrow('selected slide changed');
    expect(file.presentationTags.size).toBe(0); expect(file.slideTags.get('99')!.size).toBe(0);
    file.select('42'); file.slideTags.get('42')!.set(ACTIVITY_TAG, 'another edit');
    await expect(writeBinding(original, null)).rejects.toThrow('selected slide changed');
    expect(file.slideTags.get('42')!.get(ACTIVITY_TAG)).toBe('another edit');
    file.select('42', '99'); await expect(readSelection()).rejects.toThrow('Select one');
  });
  it('reads every connected slide in native order and rejects copied bindings or edits during Start', async () => {
    const file = presentation();
    const first = await writeBinding(await readSelection(), { spaceId: 's', deckId: 'd1', stepId: 'q' });
    file.select('88'); await writeBinding(await readSelection(), { spaceId: 's', deckId: 'd2', stepId: 'q' });
    file.select('99'); await readSelection();
    const activities = await readPresentationActivities(first.presentationId!);
    expect(activities.map((item) => [item.slideId, item.deckId])).toEqual([['42', 'd1'], ['88', 'd2']]);
    file.slideTags.get('99')!.set(ACTIVITY_TAG, first.rawBinding!);
    await expect(readPresentationActivities(first.presentationId!)).rejects.toThrow('Copied slides');
    const copy = await writeBinding(await readSelection(), { spaceId: 's', deckId: 'd1', stepId: 'q' });
    await expect(writeSessionReference(copy, await readSessionReference(), crypto.randomUUID(), activities)).rejects.toThrow('Connected slides changed');
    expect(file.presentationTags.has(SESSION_TAG)).toBe(false);
    expect((await readPresentationActivities(first.presentationId!)).map((item) => item.slideId)).toEqual(['42', '88', '99']);
  });
  it('rejects malformed or credential-bearing file metadata', () => {
    const valid = { version: 1, presentationId: crypto.randomUUID(), slideId: '42', spaceId: 's', deckId: 'd', stepId: 'q' };
    expect(parseBinding(JSON.stringify(valid))).toEqual(valid);
    for (const value of [null, [], { ...valid, token: 'secret' }, { ...valid, version: 2 }, { ...valid, deckId: 'https://attacker.test' }, { ...valid, slideId: {} }]) expect(parseBinding(JSON.stringify(value))).toBeNull();
  });
  it('retains a public retry identity across reloads and refuses to overwrite concurrent session or slide edits', async () => {
    const file = presentation();
    const selection = await writeBinding(await readSelection(), { spaceId: 's', deckId: 'd', stepId: 'q' });
    const initial = await readSessionReference(), id = crypto.randomUUID();
    const saved = await writeSessionReference(selection, initial, id);
    expect(await readSessionReference()).toEqual(saved);
    expect(saved.reference).toEqual({ version: 1, presentationId: selection.presentationId, sessionId: id });
    await expect(writeSessionReference(selection, initial, crypto.randomUUID())).rejects.toThrow('session reference changed');
    file.select('88');
    await expect(writeSessionReference(selection, saved, crypto.randomUUID())).rejects.toThrow('selected activity changed');
    expect(file.presentationTags.get(SESSION_TAG)).toBe(saved.raw);
    expect(parseSessionReference(JSON.stringify({ ...saved.reference, hostToken: 'secret' }), selection.presentationId)).toBeNull();
    expect(parseSessionReference(saved.raw, crypto.randomUUID())).toBeNull();
  });
});
