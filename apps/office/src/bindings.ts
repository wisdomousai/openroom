import type { PresentationActivity, PresentationComposition } from '@openroom/schema';

/** Public document references only. A presentation must never contain credentials. */
export interface ActivityBinding {
  version: 1;
  presentationId: string;
  slideId: string;
  spaceId: string;
  deckId: string;
  stepId: string;
}
export interface SlideSelection { slideId: string; presentationId: string | null; rawBinding: string | null }
export const PRESENTATION_TAG = 'OPENROOM_PRESENTATION';
export const ACTIVITY_TAG = 'OPENROOM_ACTIVITY';
export const SESSION_TAG = 'OPENROOM_SESSION';
export interface SessionReference { version: 1; presentationId: string; sessionId: string }
export interface SavedSession { raw: string | null; reference: SessionReference | null }
const reference = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export function parseBinding(raw: string | null): ActivityBinding | null {
  if (!raw || raw.length > 1500) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || Array.isArray(value) || Object.keys(value).length !== 6 || value.version !== 1 || !uuid(value.presentationId) || !reference(value.slideId) || !reference(value.spaceId) || !reference(value.deckId) || !reference(value.stepId)) return null;
    return { version: 1, presentationId: value.presentationId, slideId: value.slideId, spaceId: value.spaceId, deckId: value.deckId, stepId: value.stepId };
  } catch { return null; }
}

export function bindingMatches(selection: SlideSelection, binding: ActivityBinding): boolean {
  return selection.presentationId === binding.presentationId && selection.slideId === binding.slideId;
}

export function parseSessionReference(raw: string | null, presentationId: string | null): SessionReference | null {
  if (!raw || raw.length > 1000) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || Array.isArray(value) || Object.keys(value).length !== 3 || value.version !== 1 || !uuid(value.presentationId) || value.presentationId !== presentationId || !uuid(value.sessionId)) return null;
    return { version: 1, presentationId: value.presentationId, sessionId: value.sessionId };
  } catch { return null; }
}

export function readSessionReference(): Promise<SavedSession> {
  return PowerPoint.run(async (context) => {
    const presentation = context.presentation.tags.getItemOrNullObject(PRESENTATION_TAG);
    const session = context.presentation.tags.getItemOrNullObject(SESSION_TAG);
    presentation.load('value'); session.load('value'); await context.sync();
    const raw = session.isNullObject ? null : session.value;
    return { raw, reference: parseSessionReference(raw, presentation.isNullObject ? null : presentation.value) };
  });
}

/** Save the retry identity before sending Start. No capability or join code enters the file. */
export function writeSessionReference(expected: SlideSelection, previous: SavedSession, sessionId: string, activities?: PresentationActivity[]): Promise<SavedSession> {
  return PowerPoint.run(async (context) => {
    const { selection } = await selected(context);
    const binding = parseBinding(selection.rawBinding);
    const tag = context.presentation.tags.getItemOrNullObject(SESSION_TAG); tag.load('value'); await context.sync();
    if (selection.slideId !== expected.slideId || selection.presentationId !== expected.presentationId || selection.rawBinding !== expected.rawBinding || !binding || !bindingMatches(selection, binding)) throw new Error('The selected activity changed. Refresh the selection before starting.');
    if ((tag.isNullObject ? null : tag.value) !== previous.raw) throw new Error('The session reference changed. Reopen the pane before starting.');
    if (activities && JSON.stringify(await presentationActivities(context, binding.presentationId)) !== JSON.stringify(activities)) throw new Error('Connected slides changed. Start again to use the current presentation.');
    const value = parseSessionReference(JSON.stringify({ version: 1, presentationId: binding.presentationId, sessionId }), binding.presentationId);
    if (!value) throw new Error('Could not save the session reference.');
    const raw = JSON.stringify(value);
    context.presentation.tags.add(SESSION_TAG, raw); await context.sync();
    return { raw, reference: value };
  });
}

async function selected(context: PowerPoint.RequestContext) {
  const slides = context.presentation.getSelectedSlides();
  slides.load('items/id');
  const presentationTag = context.presentation.tags.getItemOrNullObject(PRESENTATION_TAG);
  presentationTag.load('value');
  await context.sync();
  if (slides.items.length !== 1) throw new Error('Select one PowerPoint slide, then refresh the selection.');
  const slide = slides.items[0]!;
  const tag = slide.tags.getItemOrNullObject(ACTIVITY_TAG); tag.load('value');
  await context.sync();
  return { slide, selection: { slideId: slide.id, presentationId: presentationTag.isNullObject ? null : presentationTag.value, rawBinding: tag.isNullObject ? null : tag.value } satisfies SlideSelection };
}

export function readSelection(): Promise<SlideSelection> {
  return PowerPoint.run(async (context) => (await selected(context)).selection);
}

async function presentationActivities(context: PowerPoint.RequestContext, presentationId: string): Promise<PresentationActivity[]> {
  const slides = context.presentation.slides;
  slides.load('items/id'); await context.sync();
  const tags = slides.items.map((slide) => { const tag = slide.tags.getItemOrNullObject(ACTIVITY_TAG); tag.load('value'); return tag; });
  await context.sync();
  const activities: PresentationActivity[] = [];
  slides.items.forEach((slide, index) => {
    const tag = tags[index]!;
    if (tag.isNullObject) return;
    const binding = parseBinding(tag.value);
    if (!binding || !bindingMatches({ presentationId, slideId: slide.id, rawBinding: tag.value }, binding)) throw new Error(`Reconnect the activity on PowerPoint slide ${index + 1} before starting. Copied slides need their own connection.`);
    activities.push({ slideId: slide.id, spaceId: binding.spaceId, deckId: binding.deckId, stepId: binding.stepId });
  });
  if (!activities.length) throw new Error('Connect an activity before starting.');
  return activities;
}

export function readPresentationActivities(presentationId: string): Promise<PresentationActivity[]> {
  return PowerPoint.run(async (context) => {
    const tag = context.presentation.tags.getItemOrNullObject(PRESENTATION_TAG); tag.load('value'); await context.sync();
    if (tag.isNullObject || tag.value !== presentationId) throw new Error('The presentation changed. Refresh the selection.');
    return presentationActivities(context, presentationId);
  });
}

export function composedStep(presentation: PresentationComposition | null | undefined, binding: ActivityBinding | null): string | null {
  if (!binding || presentation?.id !== binding.presentationId) return null;
  return presentation.activities.find((item) => item.slideId === binding.slideId && item.spaceId === binding.spaceId && item.deckId === binding.deckId && item.stepId === binding.stepId)?.sessionStepId ?? null;
}

/** Selection and existing tags are checked again inside the write, before any mutation. */
export function writeBinding(expected: SlideSelection, activity: { spaceId: string; deckId: string; stepId: string } | null): Promise<SlideSelection> {
  return PowerPoint.run(async (context) => {
    const { slide, selection } = await selected(context);
    if (selection.slideId !== expected.slideId || selection.presentationId !== expected.presentationId || selection.rawBinding !== expected.rawBinding) throw new Error('The selected slide changed. Refresh the selection before connecting an activity.');
    if (activity === null) {
      slide.tags.delete(ACTIVITY_TAG); await context.sync();
      return { ...selection, rawBinding: null };
    }
    const presentationId = uuid(selection.presentationId) ? selection.presentationId : crypto.randomUUID();
    const binding = parseBinding(JSON.stringify({ version: 1, presentationId, slideId: selection.slideId, spaceId: activity.spaceId, deckId: activity.deckId, stepId: activity.stepId }));
    if (!binding) throw new Error('This activity cannot be connected to PowerPoint.');
    const rawBinding = JSON.stringify(binding);
    context.presentation.tags.add(PRESENTATION_TAG, presentationId);
    slide.tags.add(ACTIVITY_TAG, rawBinding);
    await context.sync();
    return { slideId: selection.slideId, presentationId, rawBinding };
  });
}
