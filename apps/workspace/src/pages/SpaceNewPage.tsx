import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { WorkspaceExperience } from '@openroom/schema';
import { createSpace } from '../api';
import { ExperienceFields } from '../components/ExperienceFields';
import { Button } from '@openroom/ui/components/button';
import { Input } from '@openroom/ui/components/input';
import { to } from '../destinations';
import { messageOf } from './tutor/shared';

export function SpaceNewPage() {
  const [name, setName] = useState('');
  const [experience, setExperience] = useState<WorkspaceExperience>('classroom');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => createSpace({ name: name.trim(), experience }),
    onSuccess: async (space) => {
      await queryClient.invalidateQueries({ queryKey: ['spaces'] });
      await navigate(to.library({ spaceId: space.id }));
    },
  });
  const submit = (event: FormEvent) => { event.preventDefault(); if (name.trim() && !create.isPending) create.mutate(); };
  return <form onSubmit={submit} className="mx-auto flex w-full max-w-3xl flex-col gap-6">
    <header><h1 className="text-screen-title">New space</h1>
      <p className="mt-2 text-muted-foreground">Choose a home for your decks. You can invite collaborators and change the experience later.</p></header>
    <div className="grid gap-2"><label htmlFor="space-name" className="font-medium">Space name</label>
      <Input id="space-name" required maxLength={120} autoFocus placeholder="e.g. French lessons, Year 9, Team workshops"
        value={name} onChange={(event) => setName(event.currentTarget.value)} /></div>
    <ExperienceFields value={experience} onChange={setExperience} disabled={create.isPending} />
    {create.error ? <p role="alert" className="text-sm text-destructive">{messageOf(create.error, 'Could not create the space')}</p> : null}
    <div className="flex justify-end gap-2 border-t pt-4">
      <Button asChild variant="outline"><Link {...to.library()}>Cancel</Link></Button>
      <Button type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? 'Creating…' : 'Create space'}</Button>
    </div>
  </form>;
}
