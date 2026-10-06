import {
  validateOutline,
  type HomeworkTask,
  type Interaction,
  type Outline,
  type OutlineAside,
  type OutlineStep,
} from '@openroom/schema';
import { keepValid } from './blocks';
import { syncedFillTheGaps } from './interaction';

/**
 * Structural edits on a parsed `Outline` — the two aside pages: homework
 * (reading / writing / quiz tasks, including missed practice) and recap.
 */


const EMPTY_ASIDE = { body: '' } as const;

function nextTaskId(existing: readonly HomeworkTask[], prefix: string): string {
  const taken = new Set(existing.map((task) => task.id));
  if (!taken.has(prefix)) return prefix;
  let n = 2;
  while (taken.has(`${prefix}-${String(n)}`)) n += 1;
  return `${prefix}-${String(n)}`;
}

/** Homework — not a slide. Passing `undefined` removes the page. */
export function setHomework(outline: Outline, homework: OutlineAside | undefined): Outline {
  if (homework === undefined) {
    if (outline.homework === undefined) return outline;
    const next = { ...outline };
    delete next.homework;
    return pruneRemovedQuizzes(outline, next);
  }
  return pruneRemovedQuizzes(outline, { ...outline, homework: normalizeAside(homework) });
}

function pruneRemovedQuizzes(previous: Outline, next: Outline): Outline {
  const removed = new Set(previous.homework?.tasks?.flatMap((task) => task.kind === 'quiz' ? [task.interactionId] : []) ?? []);
  for (const task of next.homework?.tasks ?? []) if (task.kind === 'quiz') removed.delete(task.interactionId);
  for (const step of next.steps) if (step.kind === 'interaction') removed.delete(step.interactionId);
  return removed.size === 0 ? next : { ...next, interactions: next.interactions.filter((item) => !removed.has(item.id)) };
}

export function setHomeworkTask(outline: Outline, task: HomeworkTask): Outline {
  const current = outline.homework?.tasks ?? [];
  const index = current.findIndex((row) => row.id === task.id);
  const tasks = index === -1 ? [...current, task] : current.map((row, i) => (i === index ? task : row));
  return setHomework(outline, { ...outline.homework, tasks });
}

export function removeHomeworkTask(outline: Outline, taskId: string): Outline {
  const current = outline.homework?.tasks;
  if (current === undefined) return outline;
  const tasks = current.filter((task) => task.id !== taskId);
  if (tasks.length === current.length) return outline;
  if (tasks.length === 0) {
    const { tasks: _removed, ...rest } = outline.homework ?? {};
    if (rest.body === undefined && rest.items === undefined) return setHomework(outline, undefined);
    return setHomework(outline, rest);
  }
  return setHomework(outline, { ...outline.homework, tasks });
}

export function addHomeworkReading(outline: Outline): Outline {
  const tasks = outline.homework?.tasks ?? [];
  return setHomeworkTask(outline, {
    id: nextTaskId(tasks, 'reading'),
    kind: 'reading',
    body: '',
  });
}

export function addHomeworkWriting(outline: Outline): Outline {
  const tasks = outline.homework?.tasks ?? [];
  return setHomeworkTask(outline, {
    id: nextTaskId(tasks, 'writing'),
    kind: 'writing',
    prompt: '',
  });
}

export function addHomeworkVoice(outline: Outline): Outline {
  const tasks = outline.homework?.tasks ?? [];
  return setHomeworkTask(outline, {
    id: nextTaskId(tasks, 'voice'), kind: 'voice',
    prompt: '',
  });
}

/**
 * Adds a homework-only choice quiz. The interaction is not a slide.
 * Pass `interactionId` to reuse one already on the file.
 */
export function addHomeworkQuiz(outline: Outline, interactionId?: string): Outline {
  const tasks = outline.homework?.tasks ?? [];
  if (interactionId !== undefined) {
    return setHomeworkTask(outline, {
      id: nextTaskId(tasks, 'quiz'),
      kind: 'quiz',
      interactionId,
    });
  }
  const used = new Set(outline.interactions.map((row) => row.id));
  let id = 'homework-quiz';
  let n = 2;
  while (used.has(id)) {
    id = `homework-quiz-${String(n)}`;
    n += 1;
  }
  const interaction: Interaction = {
    id,
    type: 'choice',
    prompt: '',
    options: [
      { id: 'a', label: '', correct: true },
      { id: 'b', label: '' },
    ],
  };
  return setHomeworkTask(
    { ...outline, interactions: [...outline.interactions, interaction] },
    { id: nextTaskId(tasks, 'quiz'), kind: 'quiz', interactionId: id },
  );
}

/** Edit a question owned or reused by a homework task, preserving its identity. */
export function setHomeworkInteraction(outline: Outline, interaction: Interaction): Outline {
  if (!outline.homework?.tasks?.some((task) => task.kind === 'quiz' && task.interactionId === interaction.id)) return outline;
  const next = interaction.type === 'fill-the-gaps' ? syncedFillTheGaps(interaction) : interaction;
  if (next === null) return outline;
  return keepValid(outline, { ...outline, interactions: outline.interactions.map((item) => item.id === next.id ? next : item) });
}

/** Recap — not a slide. Passing `undefined` removes the page. */
export function setRecap(outline: Outline, recap: OutlineAside | undefined): Outline {
  if (recap === undefined) {
    if (outline.recap === undefined) return outline;
    const next = { ...outline };
    delete next.recap;
    return next;
  }
  return { ...outline, recap: normalizeAside(recap) };
}

function normalizeAside(aside: OutlineAside): OutlineAside {
  const next: OutlineAside = {};
  if (aside.title !== undefined && aside.title.trim() !== '') next.title = aside.title;
  if (aside.body !== undefined && aside.body.trim() !== '') next.body = aside.body;
  const items = aside.items?.map((item) => item.trim()).filter((item) => item !== '');
  if (items !== undefined && items.length > 0) next.items = items;
  if (aside.tasks !== undefined && aside.tasks.length > 0) next.tasks = aside.tasks;
  if (next.body === undefined && next.items === undefined && next.tasks === undefined) {
    return { ...EMPTY_ASIDE, ...next };
  }
  return next;
}

/** One-line contents of a homework/recap page, for the rail. */
export function asideMeta(aside: OutlineAside | undefined, empty: string): string {
  if (aside === undefined) return empty;
  if (aside.tasks !== undefined && aside.tasks.length > 0) {
    const n = aside.tasks.length;
    return n === 1 ? 'One task' : `${String(n)} tasks`;
  }
  if (aside.items !== undefined && aside.items.length > 0) {
    const n = aside.items.length;
    return n === 1 ? 'One item' : `${String(n)} items`;
  }
  if (aside.body !== undefined && aside.body.trim() !== '') return 'Written';
  return empty;
}

/** Rename the document without changing slide content. */
export function renameDeck(outline: Outline, title: string): Outline {
  return { ...outline, meta: { ...outline.meta, title: title.trim().slice(0, 200) || 'Untitled' } };
}
