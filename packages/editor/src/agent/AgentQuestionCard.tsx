import { useMemo, useState } from 'react';

import type { DesktopAgentQuestion, DesktopAgentQuestionAnswer } from '../../../../apps/host/src/desktop-bridge';
import { Button } from '@openroom/ui/components/button';
import { Checkbox } from '@openroom/ui/components/checkbox';
import { Input } from '@openroom/ui/components/input';
import { cn } from '@openroom/ui/utils';

export interface AgentQuestionCardProps {
  id: string;
  questions: DesktopAgentQuestion[];
  answers?: DesktopAgentQuestionAnswer[];
  cancelled?: boolean;
  interactive: boolean;
  onAnswer?: (id: string, answers: DesktopAgentQuestionAnswer[]) => void;
}

interface DraftAnswer {
  optionIds: string[];
  text: string;
}

function emptyDraft(questions: DesktopAgentQuestion[]): DraftAnswer[] {
  return questions.map(() => ({ optionIds: [], text: '' }));
}

function answerComplete(question: DesktopAgentQuestion, draft: DraftAnswer): boolean {
  if (question.options.length === 0) return draft.text.trim() !== '';
  return draft.optionIds.length > 0 || draft.text.trim() !== '';
}

function formatAnswer(question: DesktopAgentQuestion, answer: DesktopAgentQuestionAnswer): string {
  const labels = answer.optionIds.map(
    (id) => question.options.find((option) => option.id === id)?.label ?? id,
  );
  const bits = [...labels];
  if (answer.text !== undefined && answer.text !== '') bits.push(answer.text);
  return bits.join(', ');
}

export function AgentQuestionCard({
  id,
  questions,
  answers,
  cancelled,
  interactive,
  onAnswer,
}: AgentQuestionCardProps) {
  const [draft, setDraft] = useState<DraftAnswer[]>(() => emptyDraft(questions));
  const ready = useMemo(
    () => questions.every((question, index) => answerComplete(question, draft[index] ?? { optionIds: [], text: '' })),
    [questions, draft],
  );

  if (cancelled === true) {
    return <p className="text-caption text-muted-foreground">Skipped</p>;
  }

  if (answers !== undefined) {
    return (
      <ul className="flex flex-col gap-1">
        {questions.map((question) => {
          const answer = answers.find((item) => item.questionId === question.id);
          return (
            <li key={question.id} className="text-caption text-muted-foreground">
              <span>{question.header ?? question.prompt}</span>
              {answer === undefined ? null : (
                <>
                  {' → '}
                  <span>{formatAnswer(question, answer)}</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  if (!interactive) {
    return (
      <ul className="flex flex-col gap-1">
        {questions.map((question) => (
          <li key={question.id} className="text-caption text-muted-foreground">
            {question.header ?? question.prompt}
          </li>
        ))}
      </ul>
    );
  }

  const setOption = (index: number, optionId: string, multi: boolean) => {
    setDraft((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        if (!multi) return { ...item, optionIds: [optionId] };
        const selected = item.optionIds.includes(optionId)
          ? item.optionIds.filter((id) => id !== optionId)
          : [...item.optionIds, optionId];
        return { ...item, optionIds: selected };
      }),
    );
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border bg-background p-2"
      data-agent-question={id}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || onAnswer === undefined) return;
        onAnswer(
          id,
          questions.map((question, index) => {
            const item = draft[index] ?? { optionIds: [], text: '' };
            const text = item.text.trim();
            return {
              questionId: question.id,
              optionIds: item.optionIds,
              ...(text === '' ? {} : { text }),
            };
          }),
        );
      }}
    >
      {questions.map((question, index) => {
        const item = draft[index] ?? { optionIds: [], text: '' };
        const multi = question.multiSelect === true;
        return (
          <fieldset key={question.id} className="flex flex-col gap-1.5">
            {question.header === undefined ? null : (
              <legend className="text-caption font-semibold text-foreground">{question.header}</legend>
            )}
            <p className="text-caption">{question.prompt}</p>
            {question.options.length === 0 ? null : (
              <ul className="flex flex-col gap-1">
                {question.options.map((option) => {
                  const selected = item.optionIds.includes(option.id);
                  if (multi) {
                    return (
                      <li key={option.id}>
                        <label className="flex items-start gap-2 rounded-md border border-border px-2 py-1.5 text-caption">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={() => setOption(index, option.id, true)}
                            aria-label={option.label}
                          />
                          <span className="flex min-w-0 flex-col">
                            <span>{option.label}</span>
                            {option.description === undefined ? null : (
                              <span className="text-muted-foreground">{option.description}</span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  }
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        className={cn(
                          'flex w-full flex-col items-start rounded-md border px-2 py-1.5 text-left text-caption',
                          selected ? 'border-primary bg-accent' : 'border-border',
                        )}
                        onClick={() => setOption(index, option.id, false)}
                      >
                        <span>{option.label}</span>
                        {option.description === undefined ? null : (
                          <span className="text-muted-foreground">{option.description}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <Input
              value={item.text}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((current) =>
                  current.map((entry, entryIndex) =>
                    entryIndex === index ? { ...entry, text: value } : entry,
                  ),
                );
              }}
              placeholder={question.options.length === 0 ? 'Your answer' : 'Other'}
              aria-label={question.options.length === 0 ? question.prompt : `${question.prompt} Other`}
              className="h-8 text-caption"
            />
          </fieldset>
        );
      })}
      <Button type="submit" size="sm" disabled={!ready} className="self-start text-caption">
        Continue
      </Button>
    </form>
  );
}
