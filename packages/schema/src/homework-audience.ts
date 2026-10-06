import { HOMEWORK_TASK_MAX, type PublishedHomeworkTask } from './homework.js';

/** An omitted task is shared with the context. An explicit list names its recipients. */
export type HomeworkAudience = Record<string, string[]>;

export function parseHomeworkAudience(value: unknown, taskIds: readonly string[], learnerIds?: readonly string[]): HomeworkAudience | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > HOMEWORK_TASK_MAX) return null;
  const tasks = new Set(taskIds);
  const learners = learnerIds === undefined ? undefined : new Set(learnerIds);
  const normalized: [string, string[]][] = [];
  for (const [taskId, recipients] of entries) {
    if (!tasks.has(taskId) || !Array.isArray(recipients) || recipients.length === 0 || recipients.length > 500) return null;
    if (recipients.some((id) => typeof id !== 'string' || !id || id.length > 100 || (learners !== undefined && !learners.has(id)))) return null;
    normalized.push([taskId, [...new Set(recipients as string[])].sort()]);
  }
  return Object.fromEntries(normalized.sort(([a], [b]) => a.localeCompare(b)));
}

/** Fail closed on malformed stored audiences. Never send the audience map to a learner. */
export function homeworkForLearner(tasks: PublishedHomeworkTask[], audience: unknown, learnerId: string): PublishedHomeworkTask[] {
  const parsed = parseHomeworkAudience(audience, tasks.map((task) => task.id));
  if (parsed === null) return [];
  return tasks.filter((task) => !Object.hasOwn(parsed, task.id) || parsed[task.id]!.includes(learnerId));
}
