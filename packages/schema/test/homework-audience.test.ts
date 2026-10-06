import { expect, it } from 'vitest';
import { homeworkForLearner, parseHomeworkAudience } from '../src/homework-audience.js';
import type { PublishedHomeworkTask } from '../src/homework.js';

const tasks: PublishedHomeworkTask[] = [
  { id: 'read', kind: 'reading', body: 'Shared reading' },
  { id: 'write', kind: 'writing', prompt: 'Private writing' },
  { id: 'voice', kind: 'voice', prompt: 'Private voice' },
];
it('keeps shared tasks and filters each private audience without exposing its membership', () => {
  const audiences = { write: ['lea'], voice: ['noor'] };
  expect(homeworkForLearner(tasks, audiences, 'lea')).toEqual(tasks.slice(0, 2));
  expect(homeworkForLearner(tasks, audiences, 'noor')).toEqual([tasks[0], tasks[2]]);
  expect(homeworkForLearner(tasks, audiences, 'new-person')).toEqual([tasks[0]]);
  expect(homeworkForLearner(tasks, { write: [] }, 'lea')).toEqual([]);
  expect(homeworkForLearner(tasks, null, 'lea')).toEqual([]);
});
it('rejects unknown tasks or people and canonicalizes recipient order for revision comparison', () => {
  expect(parseHomeworkAudience({ write: ['noor', 'lea', 'lea'] }, ['write'], ['lea', 'noor'])).toEqual({ write: ['lea', 'noor'] });
  expect(parseHomeworkAudience({ write: ['outsider'] }, ['write'], ['lea'])).toBeNull();
  expect(parseHomeworkAudience({ missing: ['lea'] }, ['write'], ['lea'])).toBeNull();
  expect(parseHomeworkAudience({ write: null }, ['write'], ['lea'])).toBeNull();
});
