import { describe, expect, it } from 'vitest';
import { assessHomework, initialHomeworkAnswer, snapshotHomework, validateOutline, type HomeworkPracticeAnswer } from '@openroom/schema';
import { LESSON_EXAMPLES, lessonExample } from './lesson-examples';

describe('complete language lessons', () => {
  it.each(LESSON_EXAMPLES)('$id opens as an independent deck and publishes answerable homework', ({ id, outline }) => {
    expect(validateOutline(outline)).toMatchObject({ ok: true });
    const tasks = snapshotHomework(outline);
    expect(tasks.map((task) => task.kind).sort()).toEqual(['quiz', 'reading', 'voice', 'writing']);
    for (const task of tasks) {
      if (task.kind !== 'quiz') continue;
      const interaction = task.interaction;
      let answer: HomeworkPracticeAnswer = initialHomeworkAnswer(interaction);
      if (interaction.type === 'choice') answer = { kind: 'choice', optionIds: interaction.options.filter((option) => option.correct).map((option) => option.id) };
      if (interaction.type === 'fill-the-gaps') answer = { kind: 'fill-the-gaps', gaps: Object.fromEntries(interaction.gaps.map((gap) => [gap.id, gap.answers[0]!])) };
      if (interaction.type === 'ranking') answer = { kind: 'ranking', order: interaction.correctOrder! };
      expect(assessHomework(interaction, answer).result).toBe('correct');
    }
    const copy = lessonExample(id);
    copy.meta.title = 'My lesson';
    copy.interactions[0]!.prompt = 'My question';
    expect(lessonExample(id)).toEqual(outline);
  });
});
