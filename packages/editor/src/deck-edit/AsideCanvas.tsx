import { useLayoutEffect, useRef } from 'react';
import { isHomeworkQuizType, type HomeworkTask, type Interaction, type OutlineAside } from '@openroom/schema';

import { Button } from '@openroom/ui/components/button';
import { Input } from '@openroom/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@openroom/ui/components/select';
import { Textarea } from '@openroom/ui/components/textarea';

/**
 * Homework or recap — one page on the desk, not a slide.
 */
export function AsideCanvas({
  kind,
  aside,
  interactions = [],
  onChange,
  onAddReading,
  onAddWriting,
  onAddVoice,
  onAddQuiz,
  onQuizChange,
}: {
  kind: 'homework' | 'recap';
  aside: OutlineAside | undefined;
  interactions?: readonly Interaction[];
  onChange: (aside: OutlineAside | undefined) => void;
  onAddReading?: () => void;
  onAddWriting?: () => void;
  onAddVoice?: () => void;
  onAddQuiz?: (interactionId?: string) => void;
  onQuizChange?: (interaction: Interaction) => void;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const pendingTask = useRef<number | null>(null);
  const taskCount = aside?.tasks?.length ?? 0;
  useLayoutEffect(() => {
    if (pendingTask.current === null) return;
    const added = taskCount > pendingTask.current;
    pendingTask.current = null;
    if (!added) return;
    const task = pageRef.current?.querySelector<HTMLElement>('[data-homework-task]:last-of-type');
    task?.scrollIntoView({ block: 'nearest' });
    task?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [taskCount]);
  const add = (action?: () => void) => {
    pendingTask.current = taskCount;
    action?.();
  };
  if (kind === 'recap') {
    return (
      <ProseAside
        kind="recap"
        aside={aside}
        onChange={onChange}
        titlePlaceholder="Recap"
        bodyPlaceholder="Recap"
      />
    );
  }

  const tasks = aside?.tasks ?? [];
  const quizable = interactions.filter((row) => isHomeworkQuizType(row.type));

  return (
    <div className="aside-canvas min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-desk p-4 lg:p-7" role="region" aria-label="Homework document">
      <div ref={pageRef} className="mx-auto flex w-full min-w-0 max-w-[812px] flex-col gap-5 rounded-lg bg-card p-5 shadow-[var(--shadow-page)] lg:p-8">
        <p className="text-caption text-muted-foreground">Sent to student</p>
        <Input
          value={aside?.title ?? ''}
          placeholder="Homework"
          onChange={(event) => writeAside(aside, { title: event.currentTarget.value }, onChange)}
          className="border-0 bg-transparent px-0 text-screen-title shadow-none focus-visible:border-b-2"
          aria-label="homework title"
        />

        {tasks.length === 0 && aside?.body === undefined && aside?.items === undefined ? (
          <p className="text-secondary text-muted-foreground">
            Reading, practice, writing, or a voice response.
          </p>
        ) : null}

        <div className="flex min-w-0 flex-col gap-4">
        {tasks.map((task) => (
          <TaskEditor
            key={task.id}
            task={task}
            quizable={quizable}
            onQuizChange={onQuizChange}
            onChange={(next) => {
              const nextTasks = tasks.map((row) => (row.id === task.id ? next : row));
              writeAside(aside, { tasks: nextTasks }, onChange);
            }}
            onRemove={() => {
              const nextTasks = tasks.filter((row) => row.id !== task.id);
              writeAside(aside, { tasks: nextTasks.length > 0 ? nextTasks : undefined }, onChange);
            }}
          />
        ))}
        </div>

        {tasks.length === 0 || aside?.body !== undefined || aside?.items !== undefined ? (
          <ProseFields aside={aside} onChange={onChange} />
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => add(onAddReading)}>
            Add reading
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => add(onAddWriting)}>
            Add writing
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => add(onAddVoice)}>Add voice response</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => add(() => onAddQuiz?.())}>
            Add a quiz
          </Button>
          {quizable.length > 0 ? (
            <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">or reuse</span>
              {/* Action picker: value stays '' so the placeholder returns after each add. */}
              <Select value="" onValueChange={(id) => add(() => onAddQuiz?.(id))}>
                <SelectTrigger className="h-auto min-h-9 min-w-0 max-w-full whitespace-normal text-left" aria-label="A question in this deck">
                  <SelectValue placeholder="A question in this deck" />
                </SelectTrigger>
                <SelectContent className="max-w-[min(36rem,calc(100vw-2rem))] [overflow-wrap:anywhere]">
                  {quizable.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.prompt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}

        </div>
      </div>
    </div>
  );
}

function ProseAside({
  kind,
  aside,
  onChange,
  titlePlaceholder,
  bodyPlaceholder,
}: {
  kind: 'homework' | 'recap';
  aside: OutlineAside | undefined;
  onChange: (aside: OutlineAside | undefined) => void;
  titlePlaceholder: string;
  bodyPlaceholder: string;
}) {
  return (
    <div className="aside-canvas min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-desk p-4 lg:p-7" role="region" aria-label="Recap document">
      <div className="mx-auto flex w-full min-w-0 max-w-[812px] flex-col gap-4 rounded-lg bg-card p-5 shadow-[var(--shadow-page)] lg:p-8">
        <Input
          value={aside?.title ?? ''}
          placeholder={titlePlaceholder}
          onChange={(event) => writeAside(aside, { title: event.currentTarget.value }, onChange)}
          className="border-0 bg-transparent px-0 text-screen-title shadow-none focus-visible:border-b-2"
          aria-label={`${kind} title`}
        />
        <ProseFields kind={kind} aside={aside} onChange={onChange} bodyPlaceholder={bodyPlaceholder} />
      </div>
    </div>
  );
}

function ProseFields({
  kind = 'homework',
  aside,
  onChange,
  bodyPlaceholder = 'Homework',
}: {
  kind?: 'homework' | 'recap';
  aside: OutlineAside | undefined;
  onChange: (aside: OutlineAside | undefined) => void;
  bodyPlaceholder?: string;
}) {
  return (
    <>
      <Textarea
        rows={6}
        value={aside?.body ?? ''}
        placeholder={bodyPlaceholder}
        onChange={(event) => writeAside(aside, { body: event.currentTarget.value }, onChange)}
        aria-label={`${kind} body`}
      />
      <Textarea
        rows={4}
        value={(aside?.items ?? []).join('\n')}
        placeholder="Or one item per line"
        onChange={(event) => writeAside(aside, { items: event.currentTarget.value.split('\n') }, onChange)}
        aria-label={`${kind} list`}
      />
    </>
  );
}

function TaskEditor({
  task,
  quizable,
  onQuizChange,
  onChange,
  onRemove,
}: {
  task: HomeworkTask;
  quizable: readonly Interaction[];
  onQuizChange?: (interaction: Interaction) => void;
  onChange: (task: HomeworkTask) => void;
  onRemove: () => void;
}) {
  const quiz = task.kind === 'quiz' ? quizable.find((row) => row.id === task.interactionId) : undefined;
  return (
    <div data-homework-task={task.id} className="flex min-w-0 shrink-0 flex-col gap-2 rounded-md border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-muted-foreground">
          {task.kind === 'reading' ? 'Reading' : task.kind === 'writing' ? 'Writing' : task.kind === 'voice' ? 'Voice response' : 'Quiz'}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
      <Input
        value={task.title ?? ''}
        placeholder="Title (optional)"
        onChange={(event) => onChange({ ...task, title: event.currentTarget.value || undefined } as HomeworkTask)}
        aria-label={`${task.kind} title`}
      />
      {task.kind === 'reading' ? (
        <Textarea
          rows={4}
          value={task.body}
          placeholder="Read this."
          onChange={(event) => onChange({ ...task, body: event.currentTarget.value })}
          aria-label="reading body"
        />
      ) : null}
      {task.kind === 'writing' || task.kind === 'voice' ? (
        <>
          <Textarea
            rows={3}
            value={task.prompt}
            placeholder={task.kind === 'voice' ? 'Record a short response.' : 'Write a few sentences.'}
            onChange={(event) => onChange({ ...task, prompt: event.currentTarget.value })}
            aria-label={`${task.kind} prompt`}
          />
          <Textarea
            rows={2}
            value={task.guidance ?? ''}
            placeholder="Guidance (optional)"
            onChange={(event) => onChange({ ...task, guidance: event.currentTarget.value || undefined })}
            aria-label={`${task.kind} guidance`}
          />
        </>
      ) : null}
      {task.kind === 'quiz' ? (
        <>
        <Select value={task.interactionId} onValueChange={(id) => onChange({ ...task, interactionId: id })}>
          <SelectTrigger className="h-auto min-h-9 min-w-0 whitespace-normal text-left" aria-label="quiz question">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-w-[min(36rem,calc(100vw-2rem))] [overflow-wrap:anywhere]">
            {quizable.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {row.prompt || 'Unfinished question'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {quiz ? <Textarea aria-label="Quiz question" placeholder="Ask the class something" value={quiz.prompt} onChange={(event) => onQuizChange?.({ ...quiz, prompt: event.currentTarget.value })} /> : null}
        {quiz?.type === 'choice' ? quiz.options.map((option, index) => (
          <div key={option.id} className="flex gap-2">
            <Input aria-label={`Quiz option ${index + 1}`} placeholder={index === 0 ? 'First option' : index === 1 ? 'Second option' : 'Another option'} value={option.label} onChange={(event) => onQuizChange?.({ ...quiz, options: quiz.options.map((row) => row.id === option.id ? { ...row, label: event.currentTarget.value } : row) })} />
            <Button type="button" size="sm" variant={option.correct ? 'default' : 'outline'} aria-pressed={option.correct === true} onClick={() => onQuizChange?.({ ...quiz, options: quiz.options.map((row) => row.id === option.id ? { ...row, correct: !row.correct } : row) })}>{option.correct ? '✓ Correct' : 'Mark correct'}</Button>
          </div>
        )) : null}
        </>
      ) : null}
    </div>
  );
}

export function writeAside(
  aside: OutlineAside | undefined,
  patch: Partial<OutlineAside>,
  onChange: (aside: OutlineAside | undefined) => void,
) {
  const next: OutlineAside = { ...aside, ...patch };
  const items = next.items?.map((item) => item.trim()).filter((item) => item !== '');
  const cleaned: OutlineAside = {};
  if (next.title !== undefined && next.title.trim() !== '') cleaned.title = next.title;
  if (next.body !== undefined && next.body.trim() !== '') cleaned.body = next.body;
  if (items !== undefined && items.length > 0) cleaned.items = items;
  if (next.tasks !== undefined && next.tasks.length > 0) cleaned.tasks = next.tasks;
  if (cleaned.body === undefined && cleaned.items === undefined && cleaned.tasks === undefined) {
    onChange(undefined);
    return;
  }
  onChange(cleaned);
}
