import { useEffect, useState } from 'react';

import { Button } from '@openroom/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@openroom/ui/components/dialog';
import { Input } from '@openroom/ui/components/input';
import { Label } from '@openroom/ui/components/label';
import { Textarea } from '@openroom/ui/components/textarea';

export type LiveInsertKind = 'term' | 'statement' | 'question';

export type LiveInsertDraft =
  | { kind: 'term'; term: string; meaning: string }
  | { kind: 'statement'; title: string; body: string }
  | {
      kind: 'question';
      prompt: string;
      options: [string, string, string, string];
      /** Which option fields are marked correct; none marked means no correct answer. */
      correct: [boolean, boolean, boolean, boolean];
    };

const TITLES: Record<LiveInsertKind, string> = {
  term: 'Insert term',
  statement: 'Insert statement',
  question: 'Insert question',
};

const EDIT_TITLES: Record<LiveInsertKind, string> = {
  term: 'Change term',
  statement: 'Change statement',
  question: 'Change question',
};

function emptyDraft(kind: LiveInsertKind): LiveInsertDraft {
  if (kind === 'term') return { kind: 'term', term: '', meaning: '' };
  if (kind === 'statement') return { kind: 'statement', title: '', body: '' };
  return {
    kind: 'question',
    prompt: '',
    options: ['', '', '', ''],
    correct: [false, false, false, false],
  };
}

export function LiveInsertDialog({
  open,
  kind,
  mode = 'insert',
  initial,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  kind: LiveInsertKind | null;
  mode?: 'insert' | 'edit';
  initial?: LiveInsertDraft | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (draft: LiveInsertDraft) => void;
}) {
  const [draft, setDraft] = useState<LiveInsertDraft | null>(null);

  useEffect(() => {
    if (!open || kind === null) return;
    setDraft(initial ?? emptyDraft(kind));
  }, [open, kind, initial]);

  if (kind === null || draft === null || draft.kind !== kind) return null;

  const ready =
    draft.kind === 'term'
      ? draft.term.trim() !== '' && draft.meaning.trim() !== ''
      : draft.kind === 'statement'
        ? draft.title.trim() !== '' && draft.body.trim() !== ''
        : draft.prompt.trim() !== '' &&
          draft.options.filter((option) => option.trim() !== '').length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(28rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? EDIT_TITLES[kind] : TITLES[kind]}</DialogTitle>
          <DialogDescription>
            {mode === 'edit'
              ? 'Update this slide. The audience sees the change when you save.'
              : 'Fill this in first. The slide goes on stage only when you insert it.'}
          </DialogDescription>
        </DialogHeader>

        {draft.kind === 'term' ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="live-insert-term">Term</Label>
              <Input
                id="live-insert-term"
                value={draft.term}
                autoFocus
                onChange={(event) =>
                  setDraft({ ...draft, term: event.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="live-insert-meaning">Meaning</Label>
              <Textarea
                id="live-insert-meaning"
                rows={3}
                value={draft.meaning}
                onChange={(event) =>
                  setDraft({ ...draft, meaning: event.currentTarget.value })
                }
              />
            </div>
          </div>
        ) : null}

        {draft.kind === 'statement' ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="live-insert-title">Heading</Label>
              <Input
                id="live-insert-title"
                value={draft.title}
                autoFocus
                onChange={(event) =>
                  setDraft({ ...draft, title: event.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="live-insert-body">Text</Label>
              <Textarea
                id="live-insert-body"
                rows={4}
                value={draft.body}
                onChange={(event) =>
                  setDraft({ ...draft, body: event.currentTarget.value })
                }
              />
            </div>
          </div>
        ) : null}

        {draft.kind === 'question' ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="live-insert-prompt">Question</Label>
              <Textarea
                id="live-insert-prompt"
                rows={2}
                value={draft.prompt}
                autoFocus
                onChange={(event) =>
                  setDraft({ ...draft, prompt: event.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-secondary font-semibold">Options (at least two)</span>
              {draft.options.map((option, index) => {
                const letter = String.fromCharCode(65 + index);
                const correct = draft.correct[index] === true;
                return (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={option}
                      placeholder={`Option ${letter}`}
                      aria-label={`Option ${letter}`}
                      className="flex-1"
                      onChange={(event) => {
                        const options: [string, string, string, string] = [
                          ...draft.options,
                        ];
                        options[index] = event.currentTarget.value;
                        setDraft({ ...draft, options });
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant={correct ? 'default' : 'outline'}
                      aria-pressed={correct}
                      aria-label={`Mark correct, option ${letter}`}
                      onClick={() => {
                        const marks: [boolean, boolean, boolean, boolean] = [
                          ...draft.correct,
                        ];
                        marks[index] = !correct;
                        setDraft({ ...draft, correct: marks });
                      }}
                    >
                      {correct ? '✓ Correct' : 'Mark correct'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!ready}
            onClick={() => {
              if (!ready) return;
              onConfirm(draft);
              onOpenChange(false);
            }}
          >
            {mode === 'edit' ? 'Save' : 'Insert on stage'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
