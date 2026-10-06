import { useRef, useState } from 'react';
import {
  fillTheGapsGapIssue,
  gapsForFillTheGapsPrompt,
  insertFillTheGapsRange,
  removeFillTheGapsGap,
  splitFillTheGapsPrompt,
  validateSession,
  MAX_OPTIONS,
  MAX_RANKING_OPTIONS,
  type FillTheGapsDisplay,
  type FillTheGapsGapDraft,
  type Interaction,
} from '@openroom/schema';

import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';

export type AskKind = 'choice' | 'ranking' | 'fill-the-gaps' | 'match' | 'text';

const KINDS: { id: AskKind; label: string }[] = [
  { id: 'choice', label: 'Multiple choice' },
  { id: 'ranking', label: 'Ranking' },
  { id: 'fill-the-gaps', label: 'Fill the gaps' },
  { id: 'match', label: 'Match' },
  { id: 'text', label: 'Open answer' },
];

const GAP_DISPLAYS: { id: FillTheGapsDisplay; label: string }[] = [
  { id: 'gaps', label: 'Typed answer' },
  { id: 'bank', label: 'Word bank' },
  { id: 'choices', label: 'Choices' },
];

interface AnswerRow {
  label: string;
  correct: boolean;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const STARTER_SENTENCE = "J'ai raté le train.";

/**
 * Author a question in its own dialog, then land it as one slide.
 * The primary is live orange — it creates something the class does.
 */
export function AskDialog({
  open,
  afterLabel,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  /** e.g. "after slide 4" */
  afterLabel: string;
  onOpenChange: (open: boolean) => void;
  onAdd: (interaction: Interaction) => void;
}) {
  const [kind, setKind] = useState<AskKind>('choice');
  const [prompt, setPrompt] = useState('');
  const [answers, setAnswers] = useState<AnswerRow[]>([
    { label: '', correct: false },
    { label: '', correct: false },
    { label: '', correct: false },
  ]);
  const [pairs, setPairs] = useState([{ left: '', right: '' }, { left: '', right: '' }]);
  const [fillTheGapsPrompt, setFillTheGapsPrompt] = useState('');
  const [fillTheGapsGaps, setFillTheGapsGaps] = useState<FillTheGapsGapDraft[]>([]);
  const [fillTheGapsDisplay, setFillTheGapsDisplay] = useState<FillTheGapsDisplay>('gaps');
  const [fillTheGapsBank, setFillTheGapsBank] = useState<string[]>([]);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const sentenceRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setKind('choice');
    setPrompt('');
    setAnswers([
      { label: '', correct: false },
      { label: '', correct: false },
      { label: '', correct: false },
    ]);
    setPairs([{ left: '', right: '' }, { left: '', right: '' }]);
    setFillTheGapsPrompt('');
    setFillTheGapsGaps([]);
    setFillTheGapsDisplay('gaps');
    setFillTheGapsBank([]);
    setSelection({ start: 0, end: 0 });
  };

  const build = (): Interaction => {
    const id = `ask-${String(Date.now())}`;
    if (kind === 'fill-the-gaps') {
      return {
        id,
        type: 'fill-the-gaps',
        prompt: fillTheGapsPrompt,
        display: fillTheGapsDisplay,
        gaps: fillTheGapsGaps,
        ...(fillTheGapsDisplay === 'bank' && fillTheGapsBank.length > 0
          ? { bank: fillTheGapsBank }
          : {}),
      };
    }
    if (kind === 'match') {
      return {
        id,
        type: 'match',
        prompt: prompt.trim(),
        left: pairs.map((pair, i) => ({ id: `left-${i + 1}`, label: pair.left.trim() })),
        right: pairs.map((pair, i) => ({ id: `right-${i + 1}`, label: pair.right.trim() })),
        correct: Object.fromEntries(pairs.map((_, i) => [`left-${i + 1}`, `right-${i + 1}`])),
      };
    }
    if (kind === 'text') {
      return { id, type: 'text', prompt: prompt.trim() };
    }
    if (kind === 'ranking') {
      return {
        id,
        type: 'ranking',
        prompt: prompt.trim(),
        options: answers.filter((row) => row.label.trim() !== '').map((row, index) => ({
          id: `option-${String(index + 1)}`,
          label: row.label.trim(),
        })),
      };
    }
    return {
      id,
      type: 'choice',
      prompt: prompt.trim(),
      options: answers.filter((row) => row.label.trim() !== '').map((row, index) => ({
        id: `option-${String(index + 1)}`,
        label: row.label.trim(),
        ...(row.correct ? { correct: true as const } : {}),
      })),
    };
  };

  const candidate = build();
  const ready = validateSession({ version: 1, meta: { title: 'Question' }, interactions: [candidate] }).ok;

  const fillTheGapsIssue =
    kind === 'fill-the-gaps' ? fillTheGapsGapIssue({ prompt: fillTheGapsPrompt, gaps: fillTheGapsGaps }) : null;
  const fillTheGapsWarning =
    kind !== 'fill-the-gaps'
      ? null
      : fillTheGapsDisplay === 'choices' && fillTheGapsGaps.some((gap) => (gap.distractors?.length ?? 0) < 1)
        ? 'Choices need a wrong option on every gap.'
        : null;

  function commitSentence(next: string): void {
    setFillTheGapsPrompt(next);
    setFillTheGapsGaps(gapsForFillTheGapsPrompt(next, fillTheGapsGaps));
  }

  function makeGap(): void {
    const inserted = insertFillTheGapsRange(
      fillTheGapsPrompt,
      fillTheGapsGaps,
      selection.start,
      selection.end,
    );
    if (inserted === null) return;
    setFillTheGapsPrompt(inserted.prompt);
    setFillTheGapsGaps(inserted.gaps);
  }

  const canMakeGap =
    insertFillTheGapsRange(fillTheGapsPrompt, fillTheGapsGaps, selection.start, selection.end) !==
    null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        aria-describedby="ask-dialog-copy"
        className="flex max-h-[calc(100svh-5rem)] w-[min(38.75rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="px-6 pb-1.5 pt-5">
          <DialogTitle>New question</DialogTitle>
          <DialogDescription id="ask-dialog-copy">
            Participants answer on their phones.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-5">
          <div className="flex flex-col gap-2">
            <span className="text-secondary font-semibold">Kind of question</span>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((entry) => {
                const selected = kind === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setKind(entry.id)}
                    className={cn(
                      'inline-flex h-[30px] items-center rounded-full px-3 text-secondary',
                      selected
                        ? 'bg-live-tint font-semibold text-live-tint-foreground'
                        : 'border border-input hover:bg-chrome',
                    )}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
          </div>

          {kind === 'fill-the-gaps' ? (
            <div className="flex flex-col gap-3">
              <span className="text-secondary font-semibold">The sentence</span>
              <Input
                ref={sentenceRef}
                aria-label="The sentence"
                placeholder={STARTER_SENTENCE}
                value={fillTheGapsPrompt}
                onChange={(event) => commitSentence(event.currentTarget.value)}
                onSelect={(event) =>
                  setSelection({
                    start: event.currentTarget.selectionStart ?? 0,
                    end: event.currentTarget.selectionEnd ?? 0,
                  })
                }
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" disabled={!canMakeGap} onClick={makeGap}>
                  Make a gap
                </Button>
                <span className="text-caption text-muted-foreground">Select a word, then Make a gap.</span>
              </div>
              <p className="text-secondary leading-relaxed">
                {splitFillTheGapsPrompt(fillTheGapsPrompt).map((token, index) => {
                  if (token.kind === 'text') return <span key={index}>{token.text}</span>;
                  const gap = fillTheGapsGaps.find((entry) => entry.id === token.id);
                  const label = gap?.answers[0] ?? token.id;
                  return (
                    <button
                      key={token.id}
                      type="button"
                      className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-live-tint px-2 py-0.5 text-caption font-semibold text-live-tint-foreground"
                      aria-label={`Remove gap ${label}`}
                      onClick={() => {
                        const next = removeFillTheGapsGap(fillTheGapsPrompt, fillTheGapsGaps, token.id);
                        setFillTheGapsPrompt(next.prompt);
                        setFillTheGapsGaps(next.gaps);
                      }}
                    >
                      {label}
                      <span aria-hidden="true">×</span>
                    </button>
                  );
                })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {GAP_DISPLAYS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setFillTheGapsDisplay(entry.id)}
                    aria-pressed={fillTheGapsDisplay === entry.id}
                    className={cn(
                      'inline-flex h-[30px] items-center rounded-full px-3 text-secondary',
                      fillTheGapsDisplay === entry.id
                        ? 'bg-live-tint font-semibold text-live-tint-foreground'
                        : 'border border-input hover:bg-chrome',
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              {fillTheGapsDisplay === 'gaps' ? <p className="text-caption text-muted-foreground">Learners type an answer. No word bank.</p> : null}
              {fillTheGapsGaps.map((gap, index) => (
                <div key={gap.id} className="flex flex-col gap-1.5 rounded-md border border-border p-2">
                  <span className="text-caption font-semibold text-muted-foreground">
                    Gap {String(index + 1)} · {gap.answers[0]}
                  </span>
                  <ChipRow
                    label="Also accepted"
                    values={gap.answers.slice(1)}
                    onChange={(extras) => {
                      setFillTheGapsGaps(
                        fillTheGapsGaps.map((entry) =>
                          entry.id === gap.id ? { ...entry, answers: [gap.answers[0] ?? '', ...extras] } : entry,
                        ),
                      );
                    }}
                  />
                  {fillTheGapsDisplay === 'choices' ? <ChipRow
                    label="Wrong options"
                    values={gap.distractors ?? []}
                    onChange={(distractors) => {
                      setFillTheGapsGaps(
                        fillTheGapsGaps.map((entry) =>
                          entry.id === gap.id
                            ? { ...entry, ...(distractors.length > 0 ? { distractors } : { distractors: undefined }) }
                            : entry,
                        ),
                      );
                    }}
                  /> : null}
                </div>
              ))}
              {fillTheGapsDisplay === 'bank' ? (
                <ChipRow label="Word bank extras" values={fillTheGapsBank} onChange={setFillTheGapsBank} />
              ) : null}
              {fillTheGapsIssue ? (
                <p className="text-caption font-medium text-destructive" role="alert">
                  {fillTheGapsIssue}
                </p>
              ) : null}
              {fillTheGapsWarning ? (
                <p className="text-caption font-medium text-destructive" role="alert">
                  {fillTheGapsWarning}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-secondary font-semibold">What you are asking</span>
              <Input aria-label="Question" placeholder="Ask the class something" value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} />
            </div>
          )}

          {kind === 'match' ? (
            <div className="flex flex-col gap-2">
              <span className="text-secondary font-semibold">Matching pairs</span>
              {pairs.map((pair, index) => (
                <div key={index} className="flex gap-2">
                  {(['left', 'right'] as const).map((side) => (
                    <Input key={side} aria-label={`${side === 'left' ? 'Word' : 'Meaning'} ${index + 1}`} placeholder={`${side === 'left' ? 'Word' : 'Meaning'} ${index + 1}`} value={pair[side]} onChange={(event) => setPairs(pairs.map((entry, i) => i === index ? { ...entry, [side]: event.currentTarget.value } : entry))} />
                  ))}
                  <Button type="button" variant="ghost" size="sm" aria-label={`Remove pair ${index + 1}`} disabled={pairs.length <= 2} onClick={() => setPairs(pairs.filter((_, i) => i !== index))}>×</Button>
                </div>
              ))}
              <Button type="button" variant="ghost" className="self-start" disabled={pairs.length >= 6} onClick={() => setPairs([...pairs, { left: '', right: '' }])}>Add a pair</Button>
            </div>
          ) : null}

          {kind === 'choice' || kind === 'ranking' ? (
            <div className="flex flex-col gap-2">
              <span className="text-secondary font-semibold">Answers</span>
              {answers.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="grid size-6 shrink-0 place-items-center rounded-md bg-chrome text-caption font-semibold text-muted-foreground"
                  >
                    {LETTERS[index] ?? String(index + 1)}
                  </span>
                  <Input
                    aria-label={`Option ${index + 1}`}
                    placeholder={['First option', 'Second option', 'Third option'][index] ?? 'Another option'}
                    value={row.label}
                    onChange={(event) => {
                      const next = answers.slice();
                      next[index] = { ...row, label: event.currentTarget.value };
                      setAnswers(next);
                    }}
                    className="h-8 flex-1"
                  />
                  {kind === 'choice' ? (
                    <button
                      type="button"
                      onClick={() => {
                        const next = answers.map((item, at) =>
                          at === index ? { ...item, correct: !item.correct } : item,
                        );
                        setAnswers(next);
                      }}
                      className={cn(
                        'inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-caption',
                        row.correct
                          ? 'bg-[color-mix(in_oklab,var(--chart-2)_16%,var(--card))] font-semibold text-[var(--chart-2)]'
                          : 'border border-input text-muted-foreground hover:bg-chrome',
                      )}
                    >
                      {row.correct ? '✓ Correct' : 'Mark correct'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Remove this answer"
                    disabled={answers.length <= 2}
                    onClick={() => setAnswers(answers.filter((_, at) => at !== index))}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-chrome hover:text-destructive disabled:opacity-40"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={answers.length >= (kind === 'ranking' ? MAX_RANKING_OPTIONS : MAX_OPTIONS)}
                onClick={() => setAnswers([...answers, { label: '', correct: false }])}
                className="inline-flex h-[30px] items-center gap-1.5 self-start rounded-md px-2.5 text-secondary text-primary hover:bg-accent"
              >
                ＋ Add an answer
              </button>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <span className="min-w-0 text-caption text-muted-foreground">
            Lands as one slide, {afterLabel}
          </span>
          <Button type="button" variant="secondary" onClick={() => { reset(); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="live"
            disabled={!ready}
            onClick={() => {
              if (!ready) return;
              onAdd(candidate);
              reset();
              onOpenChange(false);
            }}
          >
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChipRow({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  function add(): void {
    const word = draft.trim();
    if (word === '') return;
    onChange([...values, word]);
    setDraft('');
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {values.map((word, index) => (
          <button
            key={`${word}-${String(index)}`}
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-input px-2 py-0.5 text-caption"
            onClick={() => onChange(values.filter((_, at) => at !== index))}
          >
            {word}
            <span aria-hidden="true">×</span>
          </button>
        ))}
        <Input
          value={draft}
          placeholder="Add"
          className="h-7 w-28"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      </div>
    </div>
  );
}
