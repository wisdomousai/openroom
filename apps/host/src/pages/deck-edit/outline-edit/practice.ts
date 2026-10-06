import { projectHomeworkInteraction, type HomeworkPracticeInteraction, type Outline } from '@openroom/schema';
import { keepValid, uniqueId, usedIds } from './blocks';
import { setHomeworkTask } from './asides';
import { insertTemplate } from './templates';

interface PracticeExercise { title?: string; interaction: HomeworkPracticeInteraction }

const TEMPLATE_FOR_TYPE: Record<HomeworkPracticeInteraction['type'], string> = {
  choice: 'choice', text: 'open-response', 'fill-the-gaps': 'fill-gaps', match: 'matching', ranking: 'ranking',
};

/** Copy the selected exercise and key, never the learner's response or identity. */
export function insertPracticeExercise(outline: Outline, afterStepId: string | null, exercise: PracticeExercise): { outline: Outline; stepId: string } {
  const inserted = insertTemplate(outline, afterStepId, TEMPLATE_FOR_TYPE[exercise.interaction.type]);
  const step = inserted.outline.steps.find((item) => item.id === inserted.stepId);
  if (!step || step.kind !== 'interaction') return { outline, stepId: '' };
  const interaction = projectHomeworkInteraction(structuredClone(exercise.interaction));
  if (!interaction) return { outline, stepId: '' };
  const next = keepValid(outline, { ...inserted.outline,
    steps: inserted.outline.steps.map((item) => item.id === step.id && exercise.title ? { ...item, body: exercise.title } : item),
    interactions: inserted.outline.interactions.map((item) => item.id === step.interactionId ? { ...interaction, id: step.interactionId } : item),
  });
  return { outline: next, stepId: next === outline ? '' : step.id };
}

/** Homework gets its own question, so subsequent edits do not alter an existing slide. */
export function addPracticeHomework(outline: Outline, exercise: PracticeExercise): Outline {
  const interaction = projectHomeworkInteraction(structuredClone(exercise.interaction));
  if (!interaction) return outline;
  const used = usedIds(outline);
  for (const task of outline.homework?.tasks ?? []) used.add(task.id);
  const interactionId = uniqueId('practice-question', used);
  used.add(interactionId);
  const taskId = uniqueId('practice', used);
  return keepValid(outline, setHomeworkTask({ ...outline, interactions: [...outline.interactions, { ...interaction, id: interactionId }] }, {
    id: taskId, kind: 'quiz', interactionId, ...(exercise.title ? { title: exercise.title } : {}),
  }));
}
