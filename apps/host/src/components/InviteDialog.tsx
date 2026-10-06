import { useEffect, useState } from 'react';

import type { SpaceMember, SpaceRole } from '../api';
import { givenName, possessive } from '../lib/initials';
import { inviteEmailError } from '../lib/members';
import { cn } from '@openroom/ui/utils';
import { PersonBadge } from './PersonBadge';
import { Button } from '@openroom/ui/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@openroom/ui/components/dialog';
import { Input } from '@openroom/ui/components/input';

export type InviteIntent = 'teach-edit' | 'teach' | 'read';

const INTENTS: { id: InviteIntent; label: string; role: Exclude<SpaceRole, 'owner'> }[] = [
  { id: 'teach-edit', label: 'Editor', role: 'editor' },
  { id: 'teach', label: 'Presenter', role: 'presenter' },
  { id: 'read', label: 'Read only', role: 'presenter' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personName: string;
  selfEmail?: string | null;
  members?: SpaceMember[];
  busy?: boolean;
  error?: string | null;
  onSend: (input: {
    email: string;
    role: Exclude<SpaceRole, 'owner'>;
    readTheCard: boolean;
  }) => void | Promise<void>;
}

/**
 * Invite a colleague into this folder's space.
 * Students never need an account — that line stays in the footer.
 */
export function InviteDialog({
  open,
  onOpenChange,
  personName,
  selfEmail = null,
  members = [],
  busy = false,
  error = null,
  onSend,
}: Props) {
  const [email, setEmail] = useState('');
  const [intent, setIntent] = useState<InviteIntent>('teach-edit');
  const [readTheCard, setReadTheCard] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail('');
      setIntent('teach-edit');
      setReadTheCard(true);
      setLocalError(null);
    }
  }, [open]);

  const who = givenName(personName);
  const chosen = INTENTS.find((row) => row.id === intent) ?? INTENTS[0]!;

  const submit = async () => {
    const problem = inviteEmailError(email, selfEmail);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    await onSend({ email: email.trim(), role: chosen.role, readTheCard });
  };

  const others = members.filter((member) => member.role !== 'owner');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-3rem)] w-[min(520px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-0 pt-[18px] pr-12">
          <DialogTitle>Invite to {personName}</DialogTitle>
          <DialogDescription className="max-w-[60ch] pt-2 text-rail font-normal leading-snug text-muted-foreground">
            A folder is the thing you share. Whoever you invite here sees {possessive(who)} decks —
            not your other students.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-[18px] px-6 pb-5 pt-4">
          <Input
            type="email"
            autoComplete="email"
            placeholder="Their email address"
            aria-label="Their email address"
            value={email}
            onChange={(event) => {
              setEmail(event.currentTarget.value);
              setLocalError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
          />

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-row-title">Role</legend>
            <div className="flex flex-wrap gap-1.5">
              {INTENTS.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={cn(
                    'inline-flex h-[30px] items-center rounded-full px-3 text-rail font-normal',
                    intent === row.id
                      ? 'bg-accent font-semibold text-accent-foreground'
                      : 'border border-input text-[color:color-mix(in_oklab,var(--foreground)_72%,var(--muted-foreground))] hover:bg-chrome',
                  )}
                  aria-pressed={intent === row.id}
                  onClick={() => setIntent(row.id)}
                >
                  {row.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex cursor-pointer items-start gap-2.5 text-rail font-normal leading-normal">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={readTheCard}
              onChange={(event) => setReadTheCard(event.currentTarget.checked)}
            />
            <span>
              Let them read the card too
              <span className="block text-caption text-muted-foreground">
                Turn this off for a cover teacher who only needs to run the session.
              </span>
            </span>
          </label>

          {others.map((member) => (
            <div
              key={member.userId}
              className="flex items-center gap-2.5 rounded-[var(--radius-lg)] bg-background px-3.5 py-3"
            >
              <PersonBadge
                name={member.name ?? member.email ?? 'Member'}
                id={member.userId}
                size="md"
                className="bg-border text-[color:color-mix(in_oklab,var(--foreground)_72%,var(--muted-foreground))]"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-rail">
                  {member.name ?? member.email ?? member.userId}
                </span>
                <span className="text-caption text-muted-foreground">
                  {member.role === 'editor' ? 'Editor' : 'Presenter'}
                </span>
              </span>
            </div>
          ))}

          {localError || error ? (
            <p className="text-secondary text-destructive">{localError ?? error}</p>
          ) : null}
        </DialogBody>

        <DialogFooter className="-mx-0 -mb-0 px-6">
          <p className="min-w-0 text-caption text-muted-foreground">Students never need an account.</p>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Sending…' : 'Send invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
