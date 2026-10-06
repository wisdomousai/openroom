/**
 * Homework asides compile to typed tasks, then to a frozen learner snapshot.
 *
 * The student never reads the deck. The session record stores this snapshot.
 * Quiz interactions keep scoring keys (`correct`, `correctAnswers`, `correctOrder`,
 * fill-the-gaps answers, match `correct`) and drop host-only `notes`, `pedagogy`, and
 * option `misconception`.
 */
import type {
  HomeworkQuizTask,
  HomeworkReadingTask,
  HomeworkTask,
  HomeworkWritingTask,
  HomeworkVoiceTask,
  Outline,
  OutlineAside,
} from './outline-types.js';
import type { Interaction } from './types.js';
import { validateSession } from './validate.js';

/** Quiz homework may reuse these live types. `qna` / `scale` / `numeric` stay live-only. */
export const HOMEWORK_QUIZ_TYPES = ['choice', 'text', 'fill-the-gaps', 'match', 'ranking'] as const;
export type HomeworkQuizType = (typeof HOMEWORK_QUIZ_TYPES)[number];

export const HOMEWORK_TASK_MAX = 50;
export const NEXT_NOTE_MAX = 2_000;
export const WRITING_BODY_MAX = 10_000;

export function isHomeworkQuizType(type: string): type is HomeworkQuizType {
  return (HOMEWORK_QUIZ_TYPES as readonly string[]).includes(type);
}

export type PublishedQuizInteraction = Extract<Interaction, { type: HomeworkQuizType }>;

export type PublishedHomeworkTask =
  | { id: string; kind: 'reading'; title?: string; body: string }
  | { id: string; kind: 'writing'; title?: string; prompt: string; guidance?: string }
  | { id: string; kind: 'voice'; title?: string; prompt: string; guidance?: string }
  | { id: string; kind: 'quiz'; title?: string; interaction: PublishedQuizInteraction };

function kebabFallback(index: number): string {
  return `item-${String(index + 1)}`;
}

function asTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, 300);
}

/** Old `{ body, items }` homework becomes one or more reading tasks. */
export function legacyHomeworkTasks(aside: OutlineAside): HomeworkReadingTask[] {
  const tasks: HomeworkReadingTask[] = [];
  if (aside.items !== undefined) {
    aside.items.forEach((item, index) => {
      const body = item.trim();
      if (body === '') return;
      tasks.push({ id: kebabFallback(index), kind: 'reading', body });
    });
  }
  if (tasks.length === 0 && aside.body !== undefined && aside.body.trim() !== '') {
    tasks.push({
      id: 'reading',
      kind: 'reading',
      ...(asTitle(aside.title) === undefined ? {} : { title: asTitle(aside.title) }),
      body: aside.body.trim(),
    });
  }
  return tasks;
}

/** Tasks the file actually carries, falling back to the old prose/list shape. */
export function homeworkTasksOf(aside: OutlineAside | undefined): HomeworkTask[] {
  if (aside === undefined) return [];
  if (aside.tasks !== undefined && aside.tasks.length > 0) return aside.tasks;
  return legacyHomeworkTasks(aside);
}

/** Strip host-only fields; keep the keys the learner page needs to score. */
export function projectHomeworkInteraction(interaction: Interaction): PublishedQuizInteraction | null {
  if (
    interaction.type === 'qna' ||
    interaction.type === 'scale' ||
    interaction.type === 'numeric'
  ) {
    return null;
  }
  switch (interaction.type) {
    case 'choice': {
      const { notes: _notes, pedagogy: _pedagogy, options, ...rest } = interaction;
      return {
        ...rest,
        options: options.map(({ misconception: _misconception, ...option }) => option),
      };
    }
    case 'text': {
      const { notes: _notes, pedagogy: _pedagogy, ...rest } = interaction;
      return rest;
    }
    case 'fill-the-gaps': {
      const { notes: _notes, pedagogy: _pedagogy, ...rest } = interaction;
      return rest;
    }
    case 'match': {
      const { notes: _notes, pedagogy: _pedagogy, ...rest } = interaction;
      return rest;
    }
    case 'ranking': {
      const { notes: _notes, pedagogy: _pedagogy, ...rest } = interaction;
      return rest;
    }
  }
}

export function snapshotHomework(outline: Outline): PublishedHomeworkTask[] {
  const aside = outline.homework;
  if (aside === undefined) return [];
  const published: PublishedHomeworkTask[] = [];
  for (const task of homeworkTasksOf(aside)) {
    const snapped = snapshotHomeworkTask(task, outline.interactions);
    if (snapped !== null) published.push(snapped);
  }
  return published;
}

export function snapshotHomeworkTask(
  task: HomeworkTask,
  interactions: readonly Interaction[],
): PublishedHomeworkTask | null {
  if (task.kind === 'reading') {
    const next: PublishedHomeworkTask = { id: task.id, kind: 'reading', body: task.body };
    if (task.title !== undefined) next.title = task.title;
    return next;
  }
  if (task.kind === 'writing' || task.kind === 'voice') {
    const next: Extract<PublishedHomeworkTask, { kind: 'writing' | 'voice' }> = { id: task.id, kind: task.kind, prompt: task.prompt };
    if (task.title !== undefined) next.title = task.title;
    if (task.guidance !== undefined) next.guidance = task.guidance;
    return next;
  }
  const interaction = interactions.find((candidate) => candidate.id === task.interactionId);
  if (interaction === undefined) return null;
  const projected = projectHomeworkInteraction(interaction);
  if (projected === null) return null;
  const next: PublishedHomeworkTask = { id: task.id, kind: 'quiz', interaction: projected };
  if (task.title !== undefined) next.title = task.title;
  return next;
}

function parseReading(row: Record<string, unknown>, fallbackId: string): HomeworkReadingTask | null {
  const body = typeof row.body === 'string' ? row.body.trim() : '';
  if (body === '') return null;
  const id = typeof row.id === 'string' && row.id.trim() !== '' ? row.id.trim() : fallbackId;
  const title = asTitle(row.title);
  return title === undefined
    ? { id, kind: 'reading', body }
    : { id, kind: 'reading', title, body };
}

function parseWriting(row: Record<string, unknown>, fallbackId: string): HomeworkWritingTask | HomeworkVoiceTask | null {
  const prompt = typeof row.prompt === 'string' ? row.prompt.trim() : '';
  if (prompt === '' || prompt.length > 2000 || (typeof row.guidance === 'string' && row.guidance.length > 2000)) return null;
  const id = typeof row.id === 'string' && row.id.trim() !== '' ? row.id.trim() : fallbackId;
  const title = asTitle(row.title);
  const guidance =
    typeof row.guidance === 'string' && row.guidance.trim() !== '' ? row.guidance.trim() : undefined;
  return {
    id,
    kind: row.kind === 'voice' ? 'voice' : 'writing',
    prompt,
    ...(title === undefined ? {} : { title }),
    ...(guidance === undefined ? {} : { guidance }),
  };
}

function parseQuizTask(row: Record<string, unknown>, fallbackId: string): HomeworkQuizTask | null {
  const interactionId =
    typeof row.interactionId === 'string' && row.interactionId.trim() !== ''
      ? row.interactionId.trim()
      : '';
  if (interactionId === '') return null;
  const id = typeof row.id === 'string' && row.id.trim() !== '' ? row.id.trim() : fallbackId;
  const title = asTitle(row.title);
  return title === undefined
    ? { id, kind: 'quiz', interactionId }
    : { id, kind: 'quiz', title, interactionId };
}

/**
 * Accept the record body's `homework` field: a string list (legacy) or
 * published / authored task objects. Returns null when the payload is the
 * wrong shape or too large.
 */
export function compileRecordHomework(input: unknown): PublishedHomeworkTask[] | null {
  if (!Array.isArray(input) || input.length > HOMEWORK_TASK_MAX) return null;
  const out: PublishedHomeworkTask[] = [];
  for (const [index, item] of input.entries()) {
    if (typeof item === 'string') {
      const body = item.trim();
      if (body === '') continue;
      out.push({ id: kebabFallback(index), kind: 'reading', body });
      continue;
    }
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const kind = row.kind;
    if (kind === 'reading' || kind === undefined) {
      const reading = parseReading(row, kebabFallback(index));
      if (reading === null) {
        if (kind === 'reading') return null;
        continue;
      }
      out.push(reading);
      continue;
    }
    if (kind === 'writing' || kind === 'voice') {
      const writing = parseWriting(row, kebabFallback(index));
      if (writing === null) return null;
      out.push(writing);
      continue;
    }
    if (kind === 'quiz') {
      if (row.interaction !== undefined && row.interaction !== null && typeof row.interaction === 'object') {
        const interaction = row.interaction as Interaction;
        if (typeof interaction.id !== 'string' || !isHomeworkQuizType(interaction.type)) return null;
        if (!validateSession({ version: 1, meta: { title: 'Homework' }, interactions: [interaction] }).ok) return null;
        const projected = projectHomeworkInteraction(interaction);
        if (projected === null) return null;
        const id = typeof row.id === 'string' && row.id.trim() !== '' ? row.id.trim() : kebabFallback(index);
        const title = asTitle(row.title);
        out.push(title === undefined ? { id, kind: 'quiz', interaction: projected } : { id, kind: 'quiz', title, interaction: projected });
        continue;
      }
      return null;
    }
    return null;
  }
  return new Set(out.map((task) => task.id)).size === out.length ? out : null;
}

export function isPublishedHomeworkTask(value: unknown): value is PublishedHomeworkTask {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id.trim() === '') return false;
  if (row.kind === 'reading') return typeof row.body === 'string' && row.body.trim() !== '';
  if (row.kind === 'writing' || row.kind === 'voice') return typeof row.prompt === 'string' && row.prompt.trim() !== '';
  if (row.kind === 'quiz') {
    return (
      row.interaction !== null &&
      typeof row.interaction === 'object' &&
      typeof (row.interaction as { id?: unknown }).id === 'string'
    );
  }
  return false;
}

export function publishedHomeworkOf(value: unknown): PublishedHomeworkTask[] {
  if (!Array.isArray(value)) return [];
  const compiled = compileRecordHomework(value);
  return compiled ?? [];
}

export function homeworkItemId(sessionId: string, taskId: string): string {
  return `${sessionId}:${taskId}`;
}

export function parseHomeworkItemId(itemId: string): { sessionId: string; taskId: string } | null {
  const split = itemId.indexOf(':');
  if (split <= 0 || split === itemId.length - 1) return null;
  return { sessionId: itemId.slice(0, split), taskId: itemId.slice(split + 1) };
}

export function clipNextNote(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, NEXT_NOTE_MAX);
}
