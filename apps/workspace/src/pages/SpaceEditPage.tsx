/**
 * `#/space/:id/edit` — space settings.
 *
 * Experience controls workspace navigation. Languages configure word lookup.
 * Both live on the space and are patched independently.
 *
 * A student's own space shows only what applies to it: its title is the
 * student's name and it has no experience choice, because the experience of a
 * student space decides only that the student is listed under Students.
 *
 * Only supported pairs are offered. The dictionary can only serve a pair it has
 * a verified source for (packages/schema/src/languages.ts), so a picker that
 * offered more would be offering a lookup that returns nothing. The picker
 * itself is shared with the live lookup strip — see
 * components/LanguagePairFields.tsx — because both must offer the same list.
 *
 * Each Save says that it saved in a status line beside it, and stays focusable
 * (`aria-disabled`, not `disabled`), so a keyboard user hears the result and
 * keeps their place.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { WorkspaceExperience } from '@openroom/schema';

import { getSpaceTree, setSpaceLanguages, updateSpaceSettings } from '../api';
import { ExperienceFields } from '../components/ExperienceFields';
import { LanguagePairFields, useLanguagePair } from '../components/LanguagePairFields';
import { Button } from '@openroom/ui/components/button';
import { Card, CardContent } from '@openroom/ui/components/card';
import { Link } from '@tanstack/react-router';

import { to } from '../destinations';
import { LoadState, PageHeading, messageOf } from './tutor/shared';

const QUIET_DISABLED = 'aria-disabled:cursor-default aria-disabled:opacity-50';

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
  const [savedNote, setSavedNote] = useState<{ experience: string; languages: string }>({ experience: '', languages: '' });
  const experience = chosen?.spaceId === spaceId ? chosen.experience : space?.settings?.experience ?? 'classroom';
  const saveExperience = useMutation({
    mutationFn: () => updateSpaceSettings(spaceId, { experience }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['spaces'] });
      setChosen(null);
      setSavedNote((note) => ({ ...note, experience: 'Experience saved.' }));
    },
  });

  const save = useMutation({
    mutationFn: (languages: { taught: string; native: string } | null) =>
      setSpaceLanguages(spaceId, languages),
    onSuccess: async (_result, languages) => {
      await queryClient.invalidateQueries({ queryKey: ['spaces'] });
      setSavedNote((note) => ({ ...note, languages: languages === null ? 'Languages cleared.' : 'Languages saved.' }));
    },
  });

  const saveError = save.error
    ? messageOf(save.error, 'Could not save the language pair')
    : saveExperience.error ? messageOf(saveExperience.error, 'Could not save the experience') : null;

  if (space === null) return <LoadState error={treeQuery.error ?? null} />;

  const canEdit = space.role === 'owner' || space.role === 'editor';
  const student = space.context ?? null;
  const experienceUnchanged = experience === space.settings?.experience;
  const languagesUnsaveable = !pair.complete || !pair.changed;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeading
        title={student ? student.displayName : 'Space settings'}
        description={student ? 'Space settings' : space.name}
        action={
          <Button asChild variant="outline">
            <Link {...to.library(student ? { spaceId, contextId: student.id } : { spaceId })}>Library</Link>
          </Button>
        }
      />
      {saveError ? <p role="alert" className="text-secondary text-destructive">{saveError}</p> : null}
      <Card><CardContent className="flex items-center justify-between gap-4 pt-6"><div><h2 className="text-section">Brand kits</h2><p className="text-secondary text-muted-foreground">Reusable colors, logos and slide masters for this space.</p></div><Button asChild variant="outline"><Link {...to.brandKits(spaceId)}>Open brand kits</Link></Button></CardContent></Card>
      {student ? null : <Card><CardContent className="flex flex-col gap-4 pt-6">
        <ExperienceFields value={experience} onChange={(value) => { setChosen({ spaceId, experience: value }); setSavedNote((note) => ({ ...note, experience: '' })); }}
          disabled={space.role !== 'owner' || saveExperience.isPending} />
        <p className="text-secondary text-muted-foreground">Choose the navigation and sample decks for this space. Your decks, languages and sharing stay as they are.</p>
        {space.role === 'owner'
          ? <div className="flex items-center gap-3">
              <Button className={QUIET_DISABLED} aria-disabled={experienceUnchanged || saveExperience.isPending}
                onClick={() => { if (!experienceUnchanged && !saveExperience.isPending) saveExperience.mutate(); }}>
                {saveExperience.isPending ? 'Saving…' : 'Save experience'}
              </Button>
              <p role="status" className="text-secondary text-muted-foreground">{savedNote.experience}</p>
            </div>
          : <p className="text-secondary text-muted-foreground">The space owner chooses its experience.</p>}
      </CardContent></Card>}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <h2 className="text-section">Dictionary languages</h2>
          <p className="text-secondary text-muted-foreground">
            {student
              ? `Set the language you teach ${student.displayName} and the language used for meanings.`
              : 'Set the language you teach and the language used for meanings.'}
          </p>
          <LanguagePairFields pair={{
            ...pair,
            chooseNative: (value) => { pair.chooseNative(value); setSavedNote((note) => ({ ...note, languages: '' })); },
            chooseTaught: (value) => { pair.chooseTaught(value); setSavedNote((note) => ({ ...note, languages: '' })); },
          }} disabled={!canEdit} idPrefix="space" />

          {canEdit ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                className={QUIET_DISABLED}
                aria-disabled={languagesUnsaveable || save.isPending}
                onClick={() => { if (!languagesUnsaveable && !save.isPending) save.mutate({ taught: pair.taught, native: pair.native }); }}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className={QUIET_DISABLED}
                aria-disabled={stored === null || save.isPending}
                onClick={() => { if (stored !== null && !save.isPending) save.mutate(null); }}
              >
                Clear languages
              </Button>
              <p role="status" className="ml-1 text-secondary text-muted-foreground">{savedNote.languages}</p>
            </div>
          ) : (
            <p className="text-secondary text-muted-foreground">Editors and owners can change this.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
