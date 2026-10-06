import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { acceptInvite, getHomeSummary, myInvites } from '../api';
import { invalidateManagementData } from '../query-client';
import { to } from '../destinations';
import { Button } from './ui/button';

/** Invitations and unfinished Notes remain reachable from the Library. */
export function WorkspaceUpdates({ contextId }: { contextId: string | null }) {
  const navigate = useNavigate();
  const invites = useQuery({ queryKey: ['spaces', 'invitations'], queryFn: myInvites });
  const home = useQuery({ queryKey: ['dashboard', 'home'], queryFn: getHomeSummary });
  const accept = useMutation({ mutationFn: acceptInvite, onSuccess: async (result) => {
    await invalidateManagementData();
    await invites.refetch();
    void navigate(to.library({ spaceId: result.spaceId }));
  } });
  const notes = (home.data?.needsRecord ?? []).filter((row) => !contextId || row.contextId === contextId);
  if (!invites.data?.length && !notes.length) return null;
  return <section aria-label="Invitations and Notes" className="flex flex-col gap-2 border-b px-8 py-3 text-sm">
    {invites.data?.map((invite) => <div key={invite.id} className="flex items-center justify-between gap-3">
      <span>{invite.inviterName ?? 'A workspace owner'} invited you to {invite.spaceName}</span>
      <Button size="sm" variant="outline" disabled={accept.isPending} onClick={() => accept.mutate(invite.id)}>Accept invitation</Button>
    </div>)}
    {accept.error ? <p role="alert" className="text-destructive">{accept.error.message}</p> : null}
    {notes.slice(0, 3).map((row) => <Link key={row.sessionId} {...to.sessionNotes(row.sessionId)} className="underline underline-offset-4">Write Notes for {row.title}</Link>)}
  </section>;
}
