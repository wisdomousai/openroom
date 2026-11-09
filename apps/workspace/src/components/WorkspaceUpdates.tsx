import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { acceptInvite, ApiError, getHomeSummary, myInvites, type HomeNeedsRecord } from '../api';
import { invalidateManagementData } from '../query-client';
import { to } from '../destinations';
import { Button } from '@openroom/ui/components/button';

/**
 * The prompt is timeless: it names the person and the deck, never when the
 * session happened or how often the deck was taught (AGENTS.md No-Ledger rule).
 */
export function writeNotesLabel(row: Pick<HomeNeedsRecord, 'studentName' | 'title'>): string {
  return row.studentName ? `Write the notes for ${row.studentName}’s session, ${row.title}` : `Write the notes for ${row.title}`;
}

/** Prompts that would read the same get a silent ordinal (" · 2"), like the person view's Notes group. */
export function numberedLabels<Row extends Pick<HomeNeedsRecord, 'studentName' | 'title'>>(rows: readonly Row[]): { row: Row; label: string }[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const label = writeNotesLabel(row);
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    return { row, label: count === 1 ? label : `${label} · ${String(count)}` };
  });
}

/**
 * The invitee's sentence for `team-required`: acceptance waits on the space
 * owner's plan, never on a licence of the invitee's own. The owner's Share page
 * keeps the buyer sentence from the shared error table.
 */
export const OWNER_PLAN_INACTIVE = 'The space owner’s shared-workspace plan is not active. Ask them to renew it, then accept again. The invitation stays here.';

export function acceptErrorSentence(error: Error): string {
  return error instanceof ApiError && error.code === 'team-required' ? OWNER_PLAN_INACTIVE : error.message;
}

/** Invitations and unfinished Notes remain reachable from the Library. */
export function WorkspaceUpdates({ studentId }: { studentId: string | null }) {
  const navigate = useNavigate();
  const invites = useQuery({ queryKey: ['spaces', 'invitations'], queryFn: myInvites });
  const home = useQuery({ queryKey: ['dashboard', 'home'], queryFn: getHomeSummary });
  const accept = useMutation({ mutationFn: acceptInvite, onSuccess: async (result) => {
    await invalidateManagementData();
    await invites.refetch();
    void navigate(to.library({ spaceId: result.spaceId }));
  } });
  const notes = (home.data?.needsRecord ?? []).filter((row) => !studentId || row.studentId === studentId);
  if (!invites.data?.length && !notes.length) return null;
  return <section aria-label="Invitations and Notes" className="flex flex-col gap-2 border-b px-8 py-3 text-secondary">
    {invites.data?.map((invite) => <div key={invite.id} className="flex items-center justify-between gap-3">
      <span>{invite.inviterName ?? 'A workspace owner'} invited you to {invite.spaceName}</span>
      <Button size="sm" variant="outline" disabled={accept.isPending} onClick={() => accept.mutate(invite.id)}>Accept invitation</Button>
    </div>)}
    {accept.error ? <p role="alert" className="text-destructive">{acceptErrorSentence(accept.error)}</p> : null}
    {numberedLabels(notes).map(({ row, label }) => <Link key={row.sessionId} {...to.sessionNotes(row.sessionId)} className="w-fit underline underline-offset-4">{label}</Link>)}
  </section>;
}
