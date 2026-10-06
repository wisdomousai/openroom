import { useState } from 'react';
import { assessHomework, type HomeworkPracticeAnswer, type HomeworkPracticeInteraction } from '@openroom/schema';
import type { ContextReturned } from '../services';
import { Button } from '@openroom/ui/components/button';

type Exercise = ContextReturned['missed'][number]['exercise'];

export function PracticePicker({ missed, onAddSlide, onAddHomework }: {
  missed: ContextReturned['missed'];
  onAddSlide: (exercise: Exercise) => boolean;
  onAddHomework: (exercise: Exercise) => boolean;
}) {
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(null);
  if (missed.length === 0) return null;
  return <section className="grid gap-3 border-t border-hairline px-[18px] py-4">
    <h3 className="text-row-title">Practice to revisit</h3>
    <p className="text-sm text-muted-foreground">Choose an exercise to teach again. Its question and answer key are copied into this deck.</p>
    {missed.map((item) => {
      const key = `${item.learnerId}:${item.itemId}`;
      const { interaction } = item.exercise;
      const assessment = assessHomework(interaction, item.lastAnswer);
      const add = (target: 'slide' | 'homework') => {
        const ok = target === 'slide' ? onAddSlide(item.exercise) : onAddHomework(item.exercise);
        setNotice({ key, text: ok ? target === 'slide' ? 'Exercise added as a slide.' : 'Exercise added to homework.' : 'The exercise could not be added. Check the deck and try again.' });
      };
      return <details key={key} className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">{item.displayName} · {item.exercise.title ?? interaction.prompt}</summary>
        <div className="mt-3 grid gap-3">
          {item.exercise.title ? <p className="whitespace-pre-wrap text-sm">{interaction.prompt}</p> : null}
          <div><p className="text-xs font-medium text-muted-foreground">Learner’s answer</p><ul className="mt-1 grid gap-1 whitespace-pre-wrap text-sm">{answerLines(interaction, item.lastAnswer).map((line, index) => <li key={index}>{line}</li>)}</ul></div>
          {assessment.answers.length > 0 ? <div><p className="text-xs font-medium text-muted-foreground">Answer key</p><ul className="mt-1 grid gap-1 whitespace-pre-wrap text-sm">{assessment.answers.map((line, index) => <li key={index}>{line}</li>)}</ul></div> : <p className="text-sm text-muted-foreground">Open answer, with no fixed answer key.</p>}
          <p className="text-xs text-muted-foreground">The learner’s name and response stay private here.</p>
          <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => add('slide')}>Add as a slide</Button><Button variant="outline" size="sm" onClick={() => add('homework')}>Add to homework</Button></div>
          {notice?.key === key ? <p role="status" className="text-sm">{notice.text}</p> : null}
        </div>
      </details>;
    })}
  </section>;
}

function answerLines(interaction: HomeworkPracticeInteraction, answer: HomeworkPracticeAnswer): string[] {
  if (interaction.type === 'choice' && answer.kind === 'choice') return answer.optionIds.map((id) => interaction.options.find((option) => option.id === id)?.label ?? id);
  if (answer.kind === 'text') return [answer.text];
  if (interaction.type === 'fill-the-gaps' && answer.kind === 'fill-the-gaps') return interaction.gaps.map((gap, index) => `${index + 1}. ${answer.gaps[gap.id] ?? ''}`);
  if (interaction.type === 'match' && answer.kind === 'match') return interaction.left.map((left) => `${left.label} — ${interaction.right.find((right) => right.id === answer.pairs[left.id])?.label ?? ''}`);
  if (interaction.type === 'ranking' && answer.kind === 'ranking') return answer.order.map((id, index) => `${index + 1}. ${interaction.options.find((option) => option.id === id)?.label ?? id}`);
  return [];
}
