/**
 * `#/space/:id/edit` — space settings.
 *
 * Experience controls workspace navigation. Languages configure word lookup.
 * Both live on the space and are patched independently.
 *
 * Only supported pairs are offered. The dictionary can only serve a pair it has
 * a verified source for (packages/schema/src/languages.ts), so a picker that
 * offered more would be offering a lookup that returns nothing. The picker
 * itself is shared with the live lookup strip — see
 * components/LanguagePairFields.tsx — because both must offer the same list.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { WorkspaceExperience } from '@openroom/schema';

import { getSpaceTree, setSpaceLanguages, updateSpaceSettings } from '../api';
import { ExperienceFields } from '../components/ExperienceFields';
import { LanguagePairFields, useLanguagePair } from '../components/LanguagePairFields';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Link } from '@tanstack/react-router';

import { to } from '../destinations';
import { LoadState, PageHeading, messageOf } from './tutor/shared';

export function SpaceEditPage({ spaceId }: { spaceId: string }) {
  const queryClient = useQueryClient();
  const treeQuery = useQuery({
    queryKey: ['spaces', spaceId, 'tree', 'all'] as const,
    queryFn: () => getSpaceTree(spaceId),
  });
  const space = treeQuery.data?.space ?? null;
  const stored = space?.settings?.languages ?? null;

  const pair = useLanguagePair(stored);
  const [chosen, setChosen] = useState<{ spaceId: string; experience: WorkspaceExperience } | null>(null);
  const experience = chosen?.spaceId === spaceId ? chosen.experience : space?.settings?.experience ?? 'classroom';
  const saveExperience = useMutation({
    mutationFn: () => updateSpaceSettings(spaceId, { experience }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['spaces'] });
      setChosen(null);
    },
  });

  const save = useMutation({
    mutationFn: (languages: { taught: string; native: string } | null) =>
      setSpaceLanguages(spaceId, languages),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['spaces'] });
    },
  });

  const error = treeQuery.error
    ? messageOf(treeQuery.error, 'Could not load this space')
    : save.error
      ? messageOf(save.error, 'Could not save the language pair')
      : saveExperience.error ? messageOf(saveExperience.error, 'Could not save the experience') : null;

  if (space === null) return <LoadState error={error} />;

  const canEdit = space.role === 'owner' || space.role === 'editor';

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeading
        title="Space settings"
        description={space.name}
        action={
          <Button asChild variant="outline">
            <Link {...to.library({ spaceId })}>Library</Link>
          </Button>
        }
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Card><CardContent className="flex items-center justify-between gap-4 pt-6"><div><h2 className="font-semibold">Brand kits</h2><p className="text-sm text-muted-foreground">Reusable colors, logos and slide masters for this space.</p></div><Button asChild variant="outline"><Link {...to.brandKits(spaceId)}>Open brand kits</Link></Button></CardContent></Card>
      <Card><CardContent className="flex flex-col gap-4 pt-6">
        <ExperienceFields value={experience} onChange={(value) => setChosen({ spaceId, experience: value })}
          disabled={space.role !== 'owner' || saveExperience.isPending} />
        <p className="text-sm text-muted-foreground">Choose the navigation and sample decks for this space. Your decks, languages and sharing stay as they are.</p>
        {space.role === 'owner'
          ? <Button className="self-start" disabled={experience === space.settings?.experience || saveExperience.isPending}
              onClick={() => saveExperience.mutate()}>{saveExperience.isPending ? 'Saving…' : 'Save experience'}</Button>
          : <p className="text-sm text-muted-foreground">The space owner chooses its experience.</p>}
      </CardContent></Card>
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <h2 className="text-base font-semibold">Dictionary languages</h2>
          <p className="text-sm text-muted-foreground">Set the language you teach and the language used for meanings.</p>
          <LanguagePairFields pair={pair} disabled={!canEdit} idPrefix="space" />

          {canEdit ? (
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={!pair.complete || !pair.changed || save.isPending}
                onClick={() => save.mutate({ taught: pair.taught, native: pair.native })}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              {stored !== null ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => save.mutate(null)}
                >
                  Clear languages
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Editors and owners can change this.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
