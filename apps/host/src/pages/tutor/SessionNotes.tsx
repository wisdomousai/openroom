/**
 * A session was started — it never came from a form.
 *
 * The remaining teacher surface after the hour is this page: the session's
 * notes (stored as the record). A session is not a booking the teacher manages.
 */
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { snapshotHomework, publishedHomeworkOf, type HomeworkAudience, type PublishedHomeworkTask } from '@openroom/schema';

import {
  ApiError,
  listContextLearners,
  type ContextLearner,
  getDeck,
  getSessionItem,
  getSessionRecord,
  saveSessionRecord,
} from '../../api';
import { HomeworkAssignments } from './HomeworkAssignments';
import { clearSessionNotes, readSessionNotes, writeSessionNotes } from '../../lib/scratchpad';
import { useAuth } from '../../useAuth';
import { Button } from '@openroom/ui/components/button';
import { Card, CardContent } from '@openroom/ui/components/card';
import { Label } from '@openroom/ui/components/label';
import { Textarea } from '@openroom/ui/components/textarea';
import type { LibraryPlace } from '@openroom/editor';
import { to } from '../../destinations';
import { invalidateManagementData } from '../../query-client';
import { CONTINUITY_REQUIRED, ContinuityLock, isContinuityRequired } from '../../components/ContinuityLock';
import {
  LoadState,
  PageHeading,
  messageOf,
} from './shared';

export function SessionNotesPage({ sessionId }: { sessionId: string }) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['sessions', user?.id, sessionId, 'record'],
    enabled: !!user, retry: false, gcTime: 0,
    queryFn: async () => {
      const [detail, existing] = await Promise.all([getSessionItem(sessionId), getSessionRecord(sessionId)]);
      const [deck, learners] = await Promise.all([
        detail.canEdit && existing === null ? getDeck(detail.session.deckId, detail.session.deckVersion) : Promise.resolve(null),
        detail.canEdit && detail.session.contextId ? listContextLearners(detail.session.contextId) : Promise.resolve([]),
      ]);
      const published = existing !== null ? publishedHomeworkOf(existing.homework) : deck?.content ? snapshotHomework(deck.content) : [];
      return { session: detail.session, canEdit: detail.canEdit, record: existing, published, learners };
    },
  });
  // Shared Notes are paid; notes kept on this device are not.
  if (user && isContinuityRequired(query.error)) {
    return <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeading title="Session notes" />
      <ContinuityLock />
      <LocalNotes sessionId={sessionId} />
    </div>;
  }
  if (!user || query.isError || !query.data) return <LoadState error={query.isError ? messageOf(query.error, 'Could not load notes') : null} />;
  const { data } = query;
  const place = { spaceId: data.session.spaceId, folderId: data.session.folderId, itemId: data.session.deckId, contextId: data.session.contextId };
  if (!data.canEdit) return <ReadOnlySessionNotes key={`${user.id}:${sessionId}`} sessionId={sessionId} title={data.session.title} record={data.record} tasks={data.published} place={place} inTrash={data.session.deletedAt !== null} />;
  return <SessionNotesForm key={`${user.id}:${sessionId}`} learners={data.learners} sessionId={sessionId} title={data.session.title} record={data.record} published={data.published} hasContext={data.session.contextId !== null} place={place} />;
}

function downloadPrivateNotes(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'openroom-private-notes.txt';
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LocalNotes({ sessionId }: { sessionId: string }) {
  const [text, setText] = useState(() => readSessionNotes(sessionId));
  return <section className="grid gap-3 rounded-xl border border-border bg-card p-6" aria-label="Notes on this device">
    <div><Label htmlFor="local-session-notes">Notes on this device</Label><p className="mt-1 text-sm text-muted-foreground">Kept in this browser. These notes are not shared with the space or learners.</p></div>
    <Textarea id="local-session-notes" rows={5} value={text} onChange={(event) => { setText(event.target.value); writeSessionNotes(sessionId, event.target.value); }} />
    <Button type="button" variant="outline" className="w-fit" disabled={!text} onClick={() => downloadPrivateNotes(text)}>Download private notes</Button>
  </section>;
}

function ReadOnlySessionNotes({ sessionId, title, record, tasks, place, inTrash }: {
  sessionId: string; title: string; record: Awaited<ReturnType<typeof getSessionRecord>>;
  tasks: PublishedHomeworkTask[]; place: LibraryPlace; inTrash: boolean;
}) {
  return <div className="mx-auto flex max-w-2xl flex-col gap-6">
    <PageHeading title={`Session notes — ${title}`} description={inTrash ? 'This session is in the trash. Saved notes are read-only.' : 'You can present in this space. Editors save shared session notes.'} />
    <LocalNotes sessionId={sessionId} />
    {record ? <section aria-label="Saved session notes" className="grid gap-5 rounded-xl border border-border bg-card p-6">
      <h2 className="font-semibold">Saved session notes</h2>
      {record.outcomes.length > 0 ? <div><h3 className="text-sm font-medium">Outcomes</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{record.outcomes.map((item, index) => <li key={index} className="whitespace-pre-wrap break-words">{String(item)}</li>)}</ul></div> : null}
      {record.nextNote ? <div><h3 className="text-sm font-medium">Next step</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{record.nextNote}</p></div> : null}
      {record.notes ? <div><h3 className="text-sm font-medium">Private teaching notes</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{record.notes}</p></div> : null}
      {tasks.length > 0 ? <div className="grid gap-3"><h3 className="text-sm font-medium">Homework</h3>{tasks.map((task) => <div key={task.id} className="border-l-2 border-primary/30 pl-3">{task.title ? <h4 className="text-sm font-medium">{task.title}</h4> : null}<p className="whitespace-pre-wrap break-words text-sm">{task.kind === 'reading' ? task.body : task.kind === 'quiz' ? task.interaction.prompt : task.prompt}</p></div>)}</div> : null}
    </section> : <p className="text-sm text-muted-foreground">No shared notes have been saved.</p>}
    <Button asChild variant="outline" className="w-fit"><Link {...to.library(place)}>Back to library</Link></Button>
  </div>;
}

function SessionNotesForm({
  sessionId,
  title,
  record,
  published,
  learners,
  hasContext,
  place,
}: {
  sessionId: string;
  title: string;
  record: Awaited<ReturnType<typeof getSessionRecord>>;
  published: PublishedHomeworkTask[];
  learners: ContextLearner[];
  hasContext: boolean;
  place: LibraryPlace;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [accessLost, setAccessLost] = useState(false);
  const [tasks, setTasks] = useState(published);
  const [audience, setAudience] = useState<HomeworkAudience>(record?.homeworkAudience ?? {});
  const hasMissingRecipients = Object.values(audience).some((recipients) => recipients.length === 0);
  /*
   * After a session ends, the live console hands private notes from the
   * live-keyed scratchpad into a session-keyed slot (see lib/scratchpad.ts). Prefer
   * a saved record when one exists; otherwise offer the scratchpad as a prefill
   * the tutor still has to save deliberately. Never put note text in a URL.
   */
  const [scratchpad] = useState(() => readSessionNotes(sessionId));
  const [addedScratchpad, setAddedScratchpad] = useState(false);
  const hasSeparateScratchpad = !!record?.notes && !!scratchpad && record.notes !== scratchpad;
  const form = useForm({
    defaultValues: {
      outcomes: (record?.outcomes ?? []).map(String).join('\n'),
      nextNote: record?.nextNote ?? '',
      notes: record?.notes || scratchpad,
    },
    onSubmit: async ({ value }) => {
      if (accessLost) return;
      setError(null);
      try {
        await saveSessionRecord(sessionId, {
          outcomes: value.outcomes.split('\n').map((line) => line.trim()).filter(Boolean),
          notes: value.notes,
          nextNote: value.nextNote,
          homework: tasks,
          homeworkAudience: audience,
          homeworkRevision: record?.homeworkRevision,
          artifacts: record?.artifacts ?? [],
        });
        clearSessionNotes(sessionId);
        await invalidateManagementData();
        await navigate(to.library(place));
      } catch (cause) {
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
          writeSessionNotes(sessionId, value.notes);
          setAccessLost(true);
          setError(isContinuityRequired(cause) ? CONTINUITY_REQUIRED : 'Your access changed. Shared notes were not saved. Your private notes are kept on this device; download a copy before leaving.');
          return;
        }
        setError(cause instanceof ApiError && cause.status === 409 ? 'Another tutor changed the homework. Copy your edits before reloading.' : cause instanceof ApiError && cause.message === 'invalid-homework-audience' ? 'Check the selected learners. Each individual task needs at least one person from this context.' : messageOf(cause, 'Could not save notes'));
      }
    },
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeading title={`Session notes — ${title}`} description={hasContext ? 'Share outcomes and homework with learners. Your next step and tutor notes stay private.' : 'Record the outcomes and next step. These notes stay in this space.'} />
      {hasSeparateScratchpad && !addedScratchpad ? <section className="grid gap-3 rounded-xl border border-border bg-card p-6" aria-label="Notes on this device"><h2 className="font-semibold">Notes on this device</h2><p className="whitespace-pre-wrap break-words text-sm">{scratchpad}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={accessLost} onClick={() => { const next = [form.getFieldValue('notes'), scratchpad].filter(Boolean).join('\n\n'); form.setFieldValue('notes', next); writeSessionNotes(sessionId, next); setAddedScratchpad(true); }}>Add to private notes</Button><Button type="button" variant="ghost" onClick={() => downloadPrivateNotes(scratchpad)}>Download private notes</Button></div></section> : null}
      <form onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
        <Card>
          <CardContent className="flex flex-col gap-5 p-6">
            <fieldset disabled={accessLost} className="contents">
            <form.Field name="outcomes">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="record-outcomes">Outcomes (one per line)</Label><Textarea id="record-outcomes" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} /></div>}</form.Field>
            <form.Field name="nextNote">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="record-next">Next step</Label><Textarea id="record-next" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} /></div>}</form.Field>
            <form.Field name="notes">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="record-notes">{hasContext ? 'Tutor notes' : 'Private notes'}</Label><Textarea id="record-notes" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => { field.handleChange(event.currentTarget.value); writeSessionNotes(sessionId, event.currentTarget.value); }} /></div>}</form.Field>
            {hasContext ? <form.Subscribe selector={(state) => state.isSubmitting}>{(busy) => <HomeworkAssignments tasks={tasks} audience={audience} learners={learners} onTasks={setTasks} onAudience={setAudience} disabled={busy} />}</form.Subscribe> : null}
            </fieldset>
            {accessLost ? <form.Subscribe selector={(state) => state.values.notes}>{(notes) => <Button type="button" variant="outline" className="w-fit" onClick={() => downloadPrivateNotes(notes)}>Download private notes</Button>}</form.Subscribe> : null}
            {error === CONTINUITY_REQUIRED ? <><ContinuityLock /><p role="alert" className="text-sm text-destructive">Shared notes not saved. Private notes are kept on this device.</p></> : error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>{([canSubmit, isSubmitting]) => <div className="flex gap-2"><Button type="submit" disabled={accessLost || !canSubmit || isSubmitting || hasMissingRecipients}>{isSubmitting ? 'Saving…' : record ? 'Update notes' : 'Save notes'}</Button><Button asChild type="button" variant="outline"><Link {...to.library(place)}>Cancel</Link></Button></div>}</form.Subscribe>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
