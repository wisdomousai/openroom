import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { WorkspaceExperience } from '@openroom/schema';
import { createDeck } from '../api';
import { Button } from '@openroom/ui/components/button';
import { starterDeck } from '../lib/starter-decks';
import { to } from '../destinations';
import { invalidateManagementData } from '../query-client';
import { EXPERIENCES } from '../shell/experiences';
import { messageOf } from '../pages/tutor/shared';

export function SpaceWelcome({ spaceId, contextId, experience, experienceSaved }: {
  spaceId: string;
  contextId: string | null;
  experience: WorkspaceExperience;
  /** Once an experience is saved, the card stops offering the choice. */
  experienceSaved: boolean;
}) {
  const navigate = useNavigate();
  const profile = EXPERIENCES[experience];
  const addSample = useMutation({
    mutationFn: () => createDeck({ spaceId, ...(contextId ? { contextId } : {}), content: starterDeck(experience) }),
    onSuccess: async ({ deck }) => {
      await invalidateManagementData();
      await navigate(to.deckEditor(deck.id));
    },
  });
  // A student space has no experience choice (its settings show languages and brand kits only).
  const choose = !contextId && !experienceSaved;
  return <section aria-labelledby="space-welcome-heading" className="mx-8 mb-5 mt-4 rounded-[var(--radius-xl)] border border-border bg-card p-5">
    <h2 id="space-welcome-heading" className="text-section">Sample deck</h2>
    <p className="mt-2 max-w-md text-secondary text-muted-foreground">{profile.starterTitle}. A short deck with a question, an activity and a recap.</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {choose ? <Button asChild><Link {...to.spaceEdit(spaceId)}>Choose experience</Link></Button> : null}
      <Button variant={choose ? 'outline' : 'default'} onClick={() => addSample.mutate()} disabled={addSample.isPending}>{addSample.isPending ? 'Opening…' : 'Open sample deck'}</Button>
      {experience === 'tutoring' ? <Button asChild variant="outline"><Link {...to.lessonExamples(spaceId, { contextId })}>Sample lessons</Link></Button> : null}
    </div>
    {addSample.error ? <p role="alert" className="mt-3 text-secondary text-destructive">{messageOf(addSample.error, 'Could not open the sample')}</p> : null}
  </section>;
}
