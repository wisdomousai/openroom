/**
 * A session was started — it never came from a form.
 *
 * The remaining teacher surface after the hour is this page: the session's
 * notes (stored as the record). A session is not a booking the teacher manages.
 */
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { NEXT_NOTE_MAX, snapshotHomework, publishedHomeworkOf, type HomeworkAudience, type PublishedHomeworkTask } from '@openroom/schema';

import {
  ApiError,
  getStudent,
  listStudentLearners,
  type StudentLearner,
  getDeck,
  getSessionItem,
  getSessionRecord,
  saveSessionRecord,
} from '../../api';
import { HomeworkAssignments } from './HomeworkAssignments';
import { clearSessionNotes, readSessionNotes, writeSessionNotes } from '@openroom/editor';
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

/** "Session notes — Léa, Au cafe": the person first, as Live now names them. */
function notesTitle(title: string, studentName: string | null): string {
  return studentName ? `Session notes — ${studentName}, ${title}` : `Session notes — ${title}`;
}

export function SessionNotesPage({ sessionId }: { sessionId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  /*
   * Arriving here usually means a session just ended. Drop the Library's
   * Live now list, so it never shows Rejoin for the ended session while it
   * reloads, and mark the write-notes prompts stale. Nothing refetches now:
   * this page's own record query stays as loaded.
   */
  useEffect(() => {
    queryClient.removeQueries({ queryKey: ['sessions', 'live-now'] });
    void queryClient.invalidateQueries({ predicate: (query) => ['sessions', 'dashboard'].includes(String(query.queryKey[0])) && query.queryKey[2] !== sessionId, refetchType: 'none' });
  }, [queryClient, sessionId]);
  const query = useQuery({
    queryKey: ['sessions', user?.id, sessionId, 'record'],
    enabled: !!user, retry: false, gcTime: 0,
    queryFn: async () => {
      const [detail, existing] = await Promise.all([getSessionItem(sessionId), getSessionRecord(sessionId)]);
      const studentId = detail.session.studentId;
      const [deck, learners, student] = await Promise.all([
        detail.canEdit && existing === null ? getDeck(detail.session.deckId, detail.session.deckVersion) : Promise.resolve(null),
        detail.canEdit && studentId ? listStudentLearners(studentId) : Promise.resolve([]),
        // The heading names the person; a name that cannot be read leaves the deck title alone.
        studentId ? getStudent(studentId).catch(() => null) : Promise.resolve(null),
      ]);
      const published = existing !== null ? publishedHomeworkOf(existing.homework) : deck?.content ? snapshotHomework(deck.content) : [];
      return { session: detail.session, canEdit: detail.canEdit, record: existing, published, learners, studentName: student?.displayName ?? null };
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
  const place = { spaceId: data.session.spaceId, folderId: data.session.folderId, itemId: data.session.deckId, studentId: data.session.studentId };
  const title = notesTitle(data.session.title, data.studentName);
  if (!data.canEdit) return <ReadOnlySessionNotes key={`${user.id}:${sessionId}`} sessionId={sessionId} title={title} record={data.record} tasks={data.published} place={place} inTrash={data.session.deletedAt !== null} />;
  return <SessionNotesForm key={`${user.id}:${sessionId}`} learners={data.learners} sessionId={sessionId} title={title} studentName={data.studentName} record={data.record} published={data.published} hasStudent={data.session.studentId !== null} place={place} />;
}

/** The notes as plain text, one labelled block per filled field, for the download after a failed save. */
function notesText(fields: Array<[label: string, value: string]>): string {
  return fields.filter(([, value]) => value.trim()).map(([label, value]) => `${label}\n${value.trim()}`).join('\n\n');
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
    <div><Label htmlFor="local-session-notes">Notes on this device</Label><p className="mt-1 text-secondary text-muted-foreground">Kept in this browser. These notes are not shared with the space or learners.</p></div>
    <Textarea id="local-session-notes" rows={5} value={text} onChange={(event) => { setText(event.target.value); writeSessionNotes(sessionId, event.target.value); }} />
    <Button type="button" variant="outline" className="w-fit" disabled={!text} onClick={() => downloadPrivateNotes(text)}>Download private notes</Button>
  </section>;
}

function ReadOnlySessionNotes({ sessionId, title, record, tasks, place, inTrash }: {
  sessionId: string; title: string; record: Awaited<ReturnType<typeof getSessionRecord>>;
  tasks: PublishedHomeworkTask[]; place: LibraryPlace; inTrash: boolean;
}) {
  return <div className="mx-auto flex max-w-2xl flex-col gap-6">
    <PageHeading title={title} description={inTrash ? 'This session is in the trash. Saved notes are read-only.' : 'You can present in this space. Editors save shared session notes.'} />
    <LocalNotes sessionId={sessionId} />
    {record ? <section aria-label="Saved session notes" className="grid gap-5 rounded-xl border border-border bg-card p-6">
      <h2 className="text-section">Saved session notes</h2>
      {record.outcomes.length > 0 ? <div><h3 className="text-row-title">Outcomes</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-secondary">{record.outcomes.map((item, index) => <li key={index} className="whitespace-pre-wrap break-words">{String(item)}</li>)}</ul></div> : null}
      {record.nextNote ? <div><h3 className="text-row-title">Next session</h3><p className="mt-2 whitespace-pre-wrap break-words text-secondary">{record.nextNote}</p></div> : null}
      {record.notes ? <div><h3 className="text-row-title">Private teaching notes</h3><p className="mt-2 whitespace-pre-wrap break-words text-secondary">{record.notes}</p></div> : null}
      {tasks.length > 0 ? <div className="grid gap-3"><h3 className="text-row-title">Homework</h3>{tasks.map((task) => <div key={task.id} className="border-l-2 border-primary/30 pl-3">{task.title ? <h4 className="text-row-title">{task.title}</h4> : null}<p className="whitespace-pre-wrap break-words text-secondary">{task.kind === 'reading' ? task.body : task.kind === 'quiz' ? task.interaction.prompt : task.prompt}</p></div>)}</div> : null}
    </section> : <p className="text-secondary text-muted-foreground">No shared notes have been saved.</p>}
    <Button asChild variant="outline" className="w-fit"><Link {...to.library(place)}>Back to library</Link></Button>
  </div>;
}

function SessionNotesForm({
  sessionId,
  title,
  studentName,
  record,
  published,
  learners,
  hasStudent,
  place,
}: {
  sessionId: string;
  title: string;
  studentName: string | null;
  record: Awaited<ReturnType<typeof getSessionRecord>>;
  published: PublishedHomeworkTask[];
  learners: StudentLearner[];
  hasStudent: boolean;
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
   * live-keyed scratchpad into a session-keyed slot (see packages/editor/src/live/scratchpad.ts). Prefer
   * a saved record when one exists; otherwise offer the scratchpad as a prefill
   * the tutor still has to save deliberately. Never put note text in a URL.
   */
  const [scratchpad] = useState(() => readSessionNotes(sessionId));
  const [addedScratchpad, setAddedScratchpad] = useState(false);
  const hasSeparateScratchpad = !!record?.notes && !!scratchpad && record.notes !== scratchpad;
  const notesLabel = hasStudent ? 'Tutor notes' : 'Private notes';
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
          /*
           * The student's Next session note is the latest one written. Re-saving
           * an older session's Notes with the field untouched must not put that
           * older note back, so an unchanged value on an existing record is left
           * out (the worker then keeps both the record's and the student's note).
           * A new record always sends it: a blank one clears the note.
           */
          ...(record && value.nextNote === (record.nextNote ?? '') ? {} : { nextNote: value.nextNote }),
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
          // Only the tutor notes field is kept on this device; the download carries the other fields too.
          writeSessionNotes(sessionId, value.notes);
          setAccessLost(true);
          const kept = `${notesLabel} are kept on this device. Download notes to keep the outcomes, Next session and ${notesLabel.toLowerCase()}.`;
          setError(isContinuityRequired(cause) ? CONTINUITY_REQUIRED : cause.status === 401 ? `Your sign-in expired, so these notes were not saved. ${kept} Then sign in again.` : `Your access changed, so these notes were not saved. ${kept}`);
          return;
        }
        const notSaved = (cause instanceof ApiError && cause.status >= 500) || cause instanceof TypeError;
        if (notSaved) {
          setError('Notes were not saved. Check your connection and try again.');
          return;
        }
        setError(cause instanceof ApiError && cause.status === 409 ? 'Another tutor changed the homework. Copy your edits before reloading.' : cause instanceof ApiError && cause.message === 'invalid-homework-audience' ? 'Check the selected learners. Each individual task needs at least one person from this student.' : messageOf(cause, 'Could not save notes'));
      }
    },
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeading title={title} description={hasStudent ? 'Share outcomes and homework with learners. Next session and tutor notes stay private.' : 'Record the outcomes and a note for the next session. These notes stay in this space.'} />
      {hasSeparateScratchpad && !addedScratchpad ? <section className="grid gap-3 rounded-xl border border-border bg-card p-6" aria-labelledby="unsaved-notes-heading"><div><h2 id="unsaved-notes-heading" className="text-section">Unsaved {notesLabel.toLowerCase()}</h2><p className="mt-1 text-secondary text-muted-foreground">Kept on this device from an edit that was not saved.</p></div><p className="whitespace-pre-wrap break-words text-secondary">{scratchpad}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={accessLost} onClick={() => { const next = [form.getFieldValue('notes'), scratchpad].filter(Boolean).join('\n\n'); form.setFieldValue('notes', next); writeSessionNotes(sessionId, next); setAddedScratchpad(true); }}>Add to private notes</Button><Button type="button" variant="ghost" onClick={() => downloadPrivateNotes(scratchpad)}>Download private notes</Button></div></section> : null}
      <form onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
        <Card>
          <CardContent className="flex flex-col gap-5 p-6">
            <fieldset disabled={accessLost} className="contents">
            <form.Field name="outcomes">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="record-outcomes">Outcomes (one per line)</Label><Textarea id="record-outcomes" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} /></div>}</form.Field>
            <form.Field name="nextNote">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="record-next">Next session</Label>{studentName ? <p id="record-next-help" className="text-secondary text-muted-foreground">Tutors only. Shown with {studentName} in the Library and at the top of their next deck.</p> : null}<Textarea id="record-next" maxLength={NEXT_NOTE_MAX} aria-describedby={studentName ? 'record-next-help' : undefined} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} /></div>}</form.Field>
            <form.Field name="notes">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="record-notes">{notesLabel}</Label><Textarea id="record-notes" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => { field.handleChange(event.currentTarget.value); writeSessionNotes(sessionId, event.currentTarget.value); }} /></div>}</form.Field>
            {hasStudent ? <form.Subscribe selector={(state) => state.isSubmitting}>{(busy) => <HomeworkAssignments tasks={tasks} audience={audience} learners={learners} onTasks={setTasks} onAudience={setAudience} disabled={busy} />}</form.Subscribe> : null}
            </fieldset>
            {accessLost ? <form.Subscribe selector={(state) => state.values}>{(values) => <Button type="button" variant="outline" className="w-fit" onClick={() => downloadPrivateNotes(notesText([['Outcomes', values.outcomes], ['Next session', values.nextNote], [notesLabel, values.notes]]))}>Download notes</Button>}</form.Subscribe> : null}
            {error === CONTINUITY_REQUIRED ? <><ContinuityLock /><p role="alert" className="text-secondary text-destructive">Shared notes not saved. {notesLabel} are kept on this device. Download notes to keep the outcomes, Next session and {notesLabel.toLowerCase()}.</p></> : error ? <p role="alert" className="text-secondary text-destructive">{error}</p> : null}
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>{([canSubmit, isSubmitting]) => <div className="flex gap-2"><Button type="submit" disabled={accessLost || !canSubmit || isSubmitting || hasMissingRecipients}>{isSubmitting ? 'Saving…' : record ? 'Update notes' : 'Save notes'}</Button><Button asChild type="button" variant="outline"><Link {...to.library(place)}>Cancel</Link></Button></div>}</form.Subscribe>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
