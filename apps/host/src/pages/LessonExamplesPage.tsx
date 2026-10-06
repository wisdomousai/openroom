import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createDeck, getSpaceTree } from '../api';
import { Button } from '@openroom/ui/components/button';
import { to } from '../destinations';
import { LESSON_EXAMPLES, lessonExample } from '../lib/lesson-examples';
import { getBreadcrumbTrail } from '../lib/folder-tree';
import { invalidateManagementData } from '../query-client';
import { SlideThumbnail } from '../../../../packages/editor/src/deck-edit/SlideThumbnail';
import { LoadState, PageHeading, messageOf } from './tutor/shared';

export default function LessonExamplesPage({ spaceId, folderId, contextId }: { spaceId: string; folderId: string | null; contextId: string | null }) {
  const navigate = useNavigate();
  const [language, setLanguage] = useState('all');
  const [level, setLevel] = useState('all');
  const tree = useQuery({ queryKey: ['spaces', spaceId, 'tree', 'all'], queryFn: () => getSpaceTree(spaceId) });
  const open = useMutation({
    mutationFn: (id: string) => createDeck({ spaceId, folderId, ...(contextId ? { contextId } : {}), content: lessonExample(id) }),
    onSuccess: async ({ deck }) => { await invalidateManagementData(); await navigate(to.deckEditor(deck.id)); },
  });
  if (!tree.data) return <LoadState error={tree.error ? messageOf(tree.error, 'Could not load this folder') : null} />;
  const { space, folders } = tree.data;
  const canEdit = space.role === 'owner' || space.role === 'editor';
  const validFolder = !folderId || folders.some((folder) => folder.id === folderId);
  const path = [space.name, ...getBreadcrumbTrail(folders, folderId).map((folder) => folder.name)].join(' › ');
  const examples = LESSON_EXAMPLES.filter(({ outline }) => (language === 'all' || outline.meta.locale === language) && (level === 'all' || outline.meta.level === level));
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
    <PageHeading title="Sample lessons" description="Complete French and German lessons to adapt for your learners." action={<Button asChild variant="outline"><Link {...to.library({ spaceId, folderId, contextId })}>Back to Library</Link></Button>} />
    <p className="text-sm text-muted-foreground">Each lesson includes teaching notes, questions, speaking activities and homework. Opening a sample creates your own editable deck.</p>
    <p className="text-sm">Saving in: <span className="font-medium">{path}</span></p>
    {!validFolder ? <p role="alert" className="text-sm text-destructive">This folder is no longer available. Return to the Library and choose a folder.</p> : null}
    {!canEdit ? <p className="text-sm text-muted-foreground">An editor can add a sample to this space.</p> : null}
    <div className="flex flex-wrap gap-x-6 gap-y-3">
      <div role="group" aria-label="Lesson language" className="flex flex-wrap gap-2">{[['all', 'Both languages'], ['fr', 'Français'], ['de', 'Deutsch']].map(([value, label]) => <Button key={value} variant={language === value ? 'default' : 'outline'} aria-pressed={language === value} onClick={() => setLanguage(value!)}>{label}</Button>)}</div>
      <div role="group" aria-label="Lesson level" className="flex flex-wrap gap-2">{['all', 'A1', 'A2', 'B1', 'B2'].map((value) => <Button key={value} variant={level === value ? 'default' : 'outline'} aria-pressed={level === value} onClick={() => setLevel(value)}>{value === 'all' ? 'All levels' : value}</Button>)}</div>
    </div>
    {open.error ? <p role="alert" className="text-sm text-destructive">{messageOf(open.error, 'Could not open this lesson. Try again.')}</p> : null}
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {examples.map(({ id, outline }) => <article key={id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label={`${outline.meta.language} ${outline.meta.level}: ${outline.meta.title}`}>
        <div className="aspect-video border-b border-border"><SlideThumbnail outline={outline} step={outline.steps[0]!} /></div>
        <div className="flex flex-1 flex-col gap-3 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{outline.meta.language} · {outline.meta.level}</p>
          <h2 lang={outline.meta.locale} className="font-display text-xl font-semibold">{outline.meta.title}</h2>
          <p lang={outline.meta.locale} className="text-sm leading-relaxed text-muted-foreground">{outline.meta.description}</p>
          <p className="text-sm text-muted-foreground">{outline.steps.filter((step) => !step.breakoutOf).length} slides · questions · writing and voice homework</p>
          <details className="text-sm"><summary className="cursor-pointer font-medium">Lesson aims</summary><ul lang={outline.meta.locale} className="mt-2 list-disc space-y-1 pl-5">{outline.meta.objectives?.map((objective) => <li key={objective}>{objective}</li>)}</ul></details>
          <Button className="mt-auto self-start" aria-label={`Open ${outline.meta.title}`} disabled={!canEdit || !validFolder || open.isPending} onClick={() => open.mutate(id)}>{open.isPending && open.variables === id ? 'Opening…' : 'Open lesson'}</Button>
        </div>
      </article>)}
    </div>
  </div>;
}
