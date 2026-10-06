import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { WorkspaceExperience } from '@openroom/schema';
import { createDeck } from '../api';
import { Button } from './ui/button';
import { starterDeck } from '../lib/starter-decks';
import { to } from '../destinations';
import { invalidateManagementData } from '../query-client';
import { EXPERIENCES } from '../shell/experiences';
import { messageOf } from '../pages/tutor/shared';

export function SpaceWelcome({ spaceId, contextId, experience }: { spaceId: string; contextId: string | null; experience: WorkspaceExperience }) {
  const navigate = useNavigate();
  const profile = EXPERIENCES[experience];
  const addSample = useMutation({
    mutationFn: () => createDeck({ spaceId, ...(contextId ? { contextId } : {}), content: starterDeck(experience) }),
    onSuccess: async ({ deck }) => {
      await invalidateManagementData();
      await navigate(to.deckEditor(deck.id));
    },
  });
  return <section aria-label="Getting started" className="mx-5 mb-5 mt-4 rounded-xl border bg-card p-5">
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{profile.label}</p>
    <h2 className="mt-2 text-lg font-semibold">Open a sample and make it yours</h2>
    <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{profile.starterTitle}. A short deck with an audience question, an activity and a recap.</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button onClick={() => addSample.mutate()} disabled={addSample.isPending}>{addSample.isPending ? 'Opening…' : 'Open sample deck'}</Button>
      <Button asChild variant="subtle"><Link {...to.spaceEdit(spaceId)}>Choose experience</Link></Button>
    </div>
    {addSample.error ? <p role="alert" className="mt-3 text-sm text-destructive">{messageOf(addSample.error, 'Could not open the sample')}</p> : null}
  </section>;
}
