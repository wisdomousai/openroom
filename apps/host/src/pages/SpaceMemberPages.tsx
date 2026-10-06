import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import {
  ApiError,
  createInvite,
  getSpaceMembers,
  patchMember,
  removeMember,
  revokeInvite,
  type PendingSpaceInvite,
  type SpaceMember,
  type SpaceRole,
} from '../api';
import {
  ActionMenuDivider,
  CollectionMeta,
  CollectionToolbar,
  ConfirmActionDialog,
  ManagementTable,
  RowActions,
} from '../components/ManagementTable';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { DropdownMenuItem } from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { to } from '../destinations';
import { useAuth } from '../useAuth';
import { LoadState, PageHeading, messageOf } from './tutor/shared';

const TEAM_REQUIRED = 'Invitations and shared workspaces require a Tutoring licence.';

export function SpaceMembersPage({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const canInvite = user?.entitlements?.team === true;
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | SpaceRole>('all');
  const [pendingMember, setPendingMember] = useState<SpaceMember | null>(null);
  const [pendingInvite, setPendingInvite] = useState<PendingSpaceInvite | null>(null);
  const queryClient = useQueryClient();
  const membersQuery = useQuery({
    queryKey: ['spaces', spaceId, 'members'] as const,
    queryFn: () => getSpaceMembers(spaceId),
  });
  const data = membersQuery.data ?? null;

  const members = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLocaleLowerCase();
    return data.members.filter((member) => {
      const searchable = `${member.name ?? ''} ${member.email ?? ''} ${member.userId} ${member.role}`.toLocaleLowerCase();
      return (!needle || searchable.includes(needle)) && (roleFilter === 'all' || member.role === roleFilter);
    });
  }, [data, query, roleFilter]);

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(spaceId, userId),
    onSuccess: async () => {
      setPendingMember(null);
      await queryClient.invalidateQueries({ queryKey: ['spaces', spaceId, 'members'] });
    },
  });
  const revokeMutation = useMutation({
    mutationFn: revokeInvite,
    onSuccess: async () => {
      setPendingInvite(null);
      await queryClient.invalidateQueries({ queryKey: ['spaces', spaceId, 'members'] });
    },
  });
  const busy = removeMutation.isPending || revokeMutation.isPending;
  const error = membersQuery.error
    ? messageOf(membersQuery.error, 'Could not load space members')
    : removeMutation.error
      ? messageOf(removeMutation.error, 'Could not remove member')
      : revokeMutation.error
        ? messageOf(revokeMutation.error, 'Could not revoke invite')
        : null;

  if (data === null) return <LoadState error={error} />;
  const canManage = data.role === 'owner';

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Share this space"
        description="People you invite see the same folders and decks."
        action={(
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link {...to.library({ spaceId })}>Library</Link></Button>
            {canManage && canInvite ? <Button asChild><Link {...to.spaceInvite(spaceId)}>Invite</Link></Button> : null}
          </div>
        )}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {canManage && !canInvite ? <p className="text-sm text-muted-foreground">{TEAM_REQUIRED}</p> : null}
      <div className="flex flex-col gap-3">
        <CollectionToolbar
          value={query}
          onChange={setQuery}
          placeholder="Search members…"
          filters={(
            <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as 'all' | SpaceRole)}>
              <SelectTrigger className="w-[10rem]" aria-label="Filter by role"><SelectValue placeholder="All roles" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="presenter">Presenter</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        />
        <CollectionMeta count={members.length} noun="member" />
        <ManagementTable
          caption="Space members"
          rows={members.map((member) => ({ ...member, id: member.userId }))}
          columns={[
            {
              key: 'member',
              header: 'Member',
              accessor: (member) => member.name ?? member.email ?? member.userId,
              cell: (member) => (
                <div className="min-w-0">
                  <p className="truncate font-medium">{member.name ?? member.email ?? member.userId}</p>
                  {member.name && member.email ? <p className="truncate text-xs text-muted-foreground">{member.email}</p> : null}
                </div>
              ),
            },
            { key: 'role', header: 'Role', accessor: (member) => member.role, className: 'w-[9rem]', cell: (member) => <Badge variant="muted">{member.role}</Badge> },
            { key: 'invited-by', header: 'Added by', accessor: (member) => member.invitedBy ?? 'Space owner', className: 'max-w-[14rem]', cell: (member) => <span className="truncate text-sm text-muted-foreground">{member.invitedBy ?? 'Space owner'}</span> },
            {
              key: 'actions',
              header: '',
              className: 'w-14 text-right',
              cell: (member) => (
                <RowActions label={`Actions for ${member.name ?? member.email ?? member.userId}`}>
                  {canManage && member.role !== 'owner' ? <DropdownMenuItem asChild><Link {...to.spaceMemberEdit(spaceId, member.userId)}>Edit role</Link></DropdownMenuItem> : null}
                  {canManage && member.role !== 'owner' ? (
                    <>
                      <ActionMenuDivider />
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setPendingMember(member)}>Remove from space</DropdownMenuItem>
                    </>
                  ) : <DropdownMenuItem disabled>Managed by space</DropdownMenuItem>}
                </RowActions>
              ),
            },
          ]}
          empty={query || roleFilter !== 'all' ? 'No members match these filters.' : 'No members yet.'}
        />
      </div>

      {canManage && data.invites && data.invites.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-base font-semibold">Pending invites</h2>
          <ManagementTable
            caption="Pending space invites"
            rows={data.invites}
            columns={[
              { key: 'email', header: 'Email', accessor: (invite) => invite.email, cell: (invite) => <span className="font-medium">{invite.email}</span> },
              { key: 'role', header: 'Role', accessor: (invite) => invite.role, className: 'w-[9rem]', cell: (invite) => <Badge variant="muted">{invite.role}</Badge> },
              { key: 'created', header: 'Created', accessor: (invite) => invite.createdAt, className: 'w-[12rem]', cell: (invite) => <span className="text-sm text-muted-foreground">{new Date(invite.createdAt).toLocaleString()}</span> },
              { key: 'actions', header: '', className: 'w-14 text-right', cell: (invite) => <RowActions label={`Actions for invite to ${invite.email}`}><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setPendingInvite(invite)}>Revoke invite</DropdownMenuItem></RowActions> },
            ]}
            empty="No pending invites."
          />
        </div>
      ) : null}

      <ConfirmActionDialog
        open={pendingMember !== null}
        onOpenChange={(open) => { if (!open && !busy) setPendingMember(null); }}
        title="Remove member"
        description={pendingMember ? `${pendingMember.name ?? pendingMember.email ?? pendingMember.userId} will lose access to this space.` : ''}
        confirmLabel="Remove member"
        busy={busy}
        onConfirm={() => { if (pendingMember) removeMutation.mutate(pendingMember.userId); }}
      />
      <ConfirmActionDialog
        open={pendingInvite !== null}
        onOpenChange={(open) => { if (!open && !busy) setPendingInvite(null); }}
        title="Revoke invite"
        description={pendingInvite ? `The invite for ${pendingInvite.email} will no longer work.` : ''}
        confirmLabel="Revoke invite"
        busy={busy}
        onConfirm={() => { if (pendingInvite) revokeMutation.mutate(pendingInvite.id); }}
      />
    </div>
  );
}

export function SpaceInvitePage({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const canInvite = user?.entitlements?.team === true;
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const accessQuery = useQuery({
    queryKey: ['spaces', spaceId, 'members'] as const,
    queryFn: () => getSpaceMembers(spaceId),
  });
  const form = useForm({
    defaultValues: { email: '', role: 'editor' as 'editor' | 'presenter' },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await createInvite(spaceId, value.email.trim(), value.role);
        // Back to the one share surface — not into the folder browser mid-invite.
        await navigate(to.spaceMembers(spaceId));
      } catch (cause) {
        setError(
          cause instanceof ApiError && cause.message === 'team-required'
            ? TEAM_REQUIRED
            : cause instanceof ApiError && cause.status === 409
              ? 'Already a member or already invited.'
              : messageOf(cause, 'Could not send invite'),
        );
      }
    },
  });

  if (!accessQuery.data) {
    return <LoadState error={accessQuery.error ? messageOf(accessQuery.error, 'Could not check space access') : null} />;
  }
  if (accessQuery.data.role !== 'owner') {
    return <p className="text-sm text-destructive">Only the space owner can invite teachers.</p>;
  }
  if (!canInvite) {
    return <p className="text-sm text-muted-foreground">{TEAM_REQUIRED}</p>;
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Invite</h1>
        <p className="mt-1 text-sm text-muted-foreground">They join this space and see the same decks.</p>
      </header>
      <form onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
        <Card><CardContent className="flex flex-col gap-5 p-6">
          <form.Field name="email" validators={{ onChange: ({ value }) => value.trim() === '' ? 'Enter an email address.' : undefined }}>
            {(field) => <div className="flex flex-col gap-2"><Label htmlFor="invite-email">Email</Label><Input id="invite-email" type="email" required value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} aria-invalid={field.state.meta.errors.length > 0} />{field.state.meta.errors[0] ? <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p> : null}</div>}
          </form.Field>
          <form.Field name="role">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="invite-role">Role</Label><Select value={field.state.value} onValueChange={(value) => field.handleChange(value as 'editor' | 'presenter')}><SelectTrigger id="invite-role" aria-label="Role"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="editor">Editor</SelectItem><SelectItem value="presenter">Presenter</SelectItem></SelectGroup></SelectContent></Select></div>}</form.Field>
          <p className="text-xs text-muted-foreground">Editors can change decks. Presenters can only start them.</p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>{([canSubmit, isSubmitting]) => <div className="flex gap-2"><Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Sending…' : 'Send invite'}</Button><Button asChild type="button" variant="outline"><Link {...to.spaceMembers(spaceId)}>Cancel</Link></Button></div>}</form.Subscribe>
        </CardContent></Card>
      </form>
    </div>
  );
}

export function SpaceMemberEditPage({ spaceId, userId }: { spaceId: string; userId: string }) {
  const query = useQuery({
    queryKey: ['spaces', spaceId, 'members'] as const,
    queryFn: () => getSpaceMembers(spaceId),
  });
  if (!query.data) return <LoadState error={query.error ? messageOf(query.error, 'Could not load member') : null} />;
  if (query.data.role !== 'owner') return <p className="text-sm text-destructive">Only the space owner can edit members.</p>;
  const member = query.data.members.find((candidate) => candidate.userId === userId);
  if (!member || member.role === 'owner') return <p className="text-sm text-destructive">Member not found.</p>;
  return <SpaceMemberEditForm spaceId={spaceId} member={member} />;
}

function SpaceMemberEditForm({ spaceId, member }: { spaceId: string; member: SpaceMember }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const form = useForm({
    defaultValues: { role: member.role as Exclude<SpaceRole, 'owner'> },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await patchMember(spaceId, member.userId, value.role);
        await queryClient.invalidateQueries({ queryKey: ['spaces', spaceId, 'members'] });
        // Back to the one share surface, the same place an invite lands.
        await navigate(to.spaceMembers(spaceId));
      } catch (cause) {
        setError(messageOf(cause, 'Could not update member'));
      }
    },
  });
  const removeMutation = useMutation({
    mutationFn: () => removeMember(spaceId, member.userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['spaces', spaceId, 'members'] });
      await navigate(to.spaceMembers(spaceId));
    },
    onError: (cause) => setError(messageOf(cause, 'Could not remove member')),
  });

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <header><h1 className="font-display text-2xl font-semibold">Edit teacher</h1><p className="mt-1 text-sm text-muted-foreground">{member.name ?? member.email ?? member.userId}</p></header>
      <form onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
        <Card><CardContent className="flex flex-col gap-5 p-6">
          <form.Field name="role">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="member-role">Role</Label><Select value={field.state.value} onValueChange={(value) => field.handleChange(value as Exclude<SpaceRole, 'owner'>)}><SelectTrigger id="member-role" aria-label="Role"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="editor">Editor</SelectItem><SelectItem value="presenter">Presenter</SelectItem></SelectGroup></SelectContent></Select></div>}</form.Field>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <div className="flex flex-wrap gap-2"><Button type="submit" disabled={isSubmitting || removeMutation.isPending}>{isSubmitting ? 'Saving…' : 'Save role'}</Button><Button asChild type="button" variant="outline"><Link {...to.spaceMembers(spaceId)}>Cancel</Link></Button><Button type="button" variant="outline" className="ml-auto text-destructive" disabled={isSubmitting || removeMutation.isPending} onClick={() => setConfirmRemove(true)}>Remove from space</Button></div>}</form.Subscribe>
        </CardContent></Card>
      </form>
      <ConfirmActionDialog open={confirmRemove} onOpenChange={(open) => { if (!open && !removeMutation.isPending) setConfirmRemove(false); }} title="Remove member" description={`${member.name ?? member.email ?? member.userId} will lose access to this space.`} confirmLabel="Remove member" busy={removeMutation.isPending} onConfirm={() => removeMutation.mutate()} />
    </div>
  );
}
