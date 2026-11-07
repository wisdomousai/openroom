import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { StudentKind, SpaceLanguages } from '@openroom/schema';

import {
  createStudent,
  getStudent,
  listAllSpaces,
  listStudents,
  setSpaceLanguages,
  trashStudent,
  updateStudent,
  type StudentDetail,
  type MySpace,
} from '../../api';
import { LanguagePairFields, useLanguagePair } from '../../components/LanguagePairFields';
import { StudentFieldsEditor } from '../../components/StudentFieldsEditor';
import { ConfirmActionDialog } from '../../components/ManagementTable';
import { Button } from '@openroom/ui/components/button';
import { Input } from '@openroom/ui/components/input';
import {
  studentFromFields,
  fieldsFromStudent,
  LEVEL_CHIPS,
  type StudentFields,
} from '../../lib/student-fields';
import { to, type LinkTarget } from '../../destinations';
import { invalidateManagementData } from '../../query-client';
import {
  LoadState,
  messageOf,
  useLoad,
  type Notify,
} from './shared';

/**
 * `#/tutor/students` is a legacy parse alias onto the Who-I-teach folder.
 * The rail owns the list; this page just lands you on a person.
 */
export function StudentsPage() {
  const navigate = useNavigate();
  const { data, cause } = useLoad(
    ['students', 'collection'],
    () => listStudents(),
    'Could not load students',
  );

  useEffect(() => {
    if (!data || data.length === 0) return;
    const first = data[0]!;
    void navigate({ ...to.library({ spaceId: first.spaceId, studentId: first.id }), replace: true });
  }, [data, navigate]);

  if (data === null) return <LoadState error={cause} />;
  if (data.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 py-16">
        <h1 className="text-page-title">Students</h1>
        <p className="text-secondary text-muted-foreground">No students yet.</p>
        <Button asChild className="w-fit">
          <Link {...to.studentNew()}>Add student</Link>
        </Button>
      </div>
    );
  }
  return <p className="text-secondary text-muted-foreground">Opening…</p>;
}

function StudentForm({
  heading,
  initial,
  submitLabel,
  cancelTo,
  onSubmit,
  kind,
  onKindChange,
  extra,
  footer,
}: {
  heading: string;
  initial?: StudentDetail;
  submitLabel: string;
  cancelTo: LinkTarget;
  onSubmit: (input: { displayName: string; student: Record<string, unknown> }) => Promise<void>;
  kind?: StudentKind;
  onKindChange?: (kind: 'person' | 'group') => void;
  /** Fields that belong to the new student's space rather than the student. */
  extra?: ReactNode;
  /** Below the form: actions on the record itself, such as Move to trash. */
  footer?: ReactNode;
}) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [fields, setFields] = useState<StudentFields>(() => fieldsFromStudent(initial?.student));
  /** The empty-name message sits under Name; a failed save is reported by the buttons. */
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const name = displayName.trim();
    if (name === '') {
      setNameError('Enter a name.');
      nameField.current?.focus();
      return;
    }
    setNameError(null);
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ displayName: name, student: studentFromFields(fields) });
    } catch (cause) {
      setError(messageOf(cause, 'Could not save the student'));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col gap-5">
    <form noValidate className="flex flex-col gap-5" onSubmit={(event) => void save(event)}>
      <header className="flex flex-col gap-2">
        <h1 className="text-screen-title">{heading}</h1>
      </header>

      {onKindChange ? <fieldset className="flex gap-5"><legend className="mb-2 text-row-title">Who is this for?</legend>
        {(['person', 'group'] as const).map((value) => <label key={value} className="flex items-center gap-2">
          <input type="radio" name="student-kind" checked={kind === value} onChange={() => onKindChange(value)} />
          {value === 'person' ? 'Individual' : 'Small group'}
        </label>)}
      </fieldset> : null}

      <div className="flex flex-col gap-2">
        <label htmlFor="student-name" className="text-row-title">
          Name
        </label>
        <Input
          ref={nameField}
          id="student-name"
          required
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'student-name-error' : undefined}
          placeholder="e.g. Camille, Year 9 French, Tuesday group"
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.currentTarget.value);
            if (nameError && event.currentTarget.value.trim() !== '') setNameError(null);
          }}
        />
        {nameError ? <p id="student-name-error" role="alert" className="text-secondary text-destructive">{nameError}</p> : null}
      </div>

      <StudentFieldsEditor value={fields} onChange={setFields} levelSuggestions={kind === 'class' ? LEVEL_CHIPS : undefined} />

      {extra}

      {error ? <p role="alert" className="text-secondary text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2 border-t border-hairline bg-background py-3.5">
        <p className="min-w-0 flex-1 text-caption text-muted-foreground">Only the name is required.</p>
        <Button asChild type="button" variant="outline">
          <Link {...cancelTo}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
    {footer}
    </div>
  );
}

/**
 * The pair a new student starts with: the one last saved on another student,
 * else the one the new space would inherit from where it was added.
 */
export function suggestedLanguages(spaces: readonly MySpace[], sourceSpaceId?: string): SpaceLanguages | null {
  const students = spaces
    .filter((space) => space.id.startsWith('sp_ctx_') && space.role === 'owner' && space.settings.languages)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (students[0]?.settings.languages) return students[0].settings.languages;
  const source = sourceSpaceId
    ? spaces.find((space) => space.id === sourceSpaceId)
    : spaces.filter((space) => !space.shared).sort((a, b) => a.createdAt - b.createdAt)[0];
  return source?.settings.languages ?? null;
}

export function StudentNewPage({ sourceSpaceId, experience = 'tutoring', notify }: { sourceSpaceId?: string; experience?: 'tutoring' | 'classroom'; notify?: Notify }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<'person' | 'group'>('person');
  const spacesQuery = useQuery({ queryKey: ['spaces', 'all'] as const, queryFn: listAllSpaces });
  /*
   * The suggestion is taken once, from the first fresh answer (not a cached
   * one being refetched): a later refetch must not replace a pair the tutor
   * has already chosen. The fields wait for it; if the list cannot load they
   * open empty.
   */
  const [suggested, setSuggested] = useState<SpaceLanguages | null | undefined>(undefined);
  useEffect(() => {
    if (suggested !== undefined || spacesQuery.isFetching) return;
    if (spacesQuery.data) setSuggested(suggestedLanguages(spacesQuery.data, sourceSpaceId));
    else if (spacesQuery.isError) setSuggested(null);
  }, [sourceSpaceId, spacesQuery.data, spacesQuery.isError, spacesQuery.isFetching, suggested]);
  const pair = useLanguagePair(suggested ?? null);
  return (
    <StudentForm
      extra={
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-row-title">Dictionary languages</legend>
          <p className="text-secondary text-muted-foreground">Optional. Word lookup in these lessons uses this pair.</p>
          <LanguagePairFields pair={pair} idPrefix="new-student" disabled={suggested === undefined} />
        </fieldset>
      }
      heading={experience === 'classroom' ? 'Add class' : 'Add student or group'}
      kind={experience === 'classroom' ? 'class' : kind}
      onKindChange={experience === 'tutoring' ? setKind : undefined}
      submitLabel="Save"
      cancelTo={to.library({ spaceId: sourceSpaceId })}
      onSubmit={async (input) => {
        const created = await createStudent({
          displayName: input.displayName,
          kind: experience === 'classroom' ? 'class' : kind,
          student: input.student,
          sourceSpaceId,
          experience,
        });
        /*
         * The pair lives on the new space, and what the form showed is what it
         * gets: a complete pair, or none. Only if the form was saved before its
         * fields opened does the pair the worker copied at creation stay. The
         * student exists by now, so a failure here is reported on their place
         * rather than inviting a second Save.
         */
        const languages = pair.complete ? { taught: pair.taught, native: pair.native } : suggested === undefined ? undefined : null;
        if (languages !== undefined) {
          try {
            await setSpaceLanguages(created.spaceId, languages);
          } catch (cause) {
            notify?.(`${input.displayName} was added, but the dictionary languages were not saved. ${messageOf(cause, 'Set them in Space settings.')}`, 'error');
          }
        }
        await invalidateManagementData();
        await navigate(to.library({ spaceId: created.spaceId, studentId: created.id }));
      }}
    />
  );
}

export function StudentEditPage({ studentId }: { studentId: string }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const { data: detail, cause } = useLoad(
    ['students', studentId, 'edit'],
    () => getStudent(studentId),
    'Could not load the student',
  );
  if (detail === null) return <LoadState error={cause} what="student" />;
  const place = to.library({ spaceId: detail.spaceId, studentId });
  const moveToTrash = async () => {
    setTrashing(true);
    setTrashError(null);
    try {
      await trashStudent(studentId);
      await invalidateManagementData();
      setConfirming(false);
      // Their place shows that they are in Trash, with Restore.
      await navigate(place);
    } catch (failure) {
      setTrashError(messageOf(failure, 'Could not move to trash'));
      setTrashing(false);
    }
  };
  return (
    <StudentForm
      footer={detail.deletedAt === null ? <>
        <div className="flex justify-end border-t border-hairline pt-3.5">
          <Button type="button" variant="outline" className="text-destructive" onClick={() => setConfirming(true)}>Move to trash</Button>
        </div>
        {trashError ? <p role="alert" className="text-secondary text-destructive">{trashError}</p> : null}
        <ConfirmActionDialog
          open={confirming}
          onOpenChange={(open) => { if (!open && !trashing) setConfirming(false); }}
          title={`Move ${detail.displayName} to trash`}
          description={`Moves ${detail.displayName} to Trash. Their access links stop working until you restore them. Permanently deleting them from Trash also deletes their decks, access links and learner work.`}
          confirmLabel="Move to trash"
          busy={trashing}
          onConfirm={() => void moveToTrash()}
        />
      </> : null}
      heading={`Edit ${detail.displayName}`}
      initial={detail}
      kind={detail.kind}
      submitLabel="Save"
      cancelTo={place}
      onSubmit={async (input) => {
        await updateStudent(studentId, {
          displayName: input.displayName,
          kind: detail.kind,
          student: input.student,
        });
        await invalidateManagementData();
        await navigate(place);
      }}
    />
  );
}

/** Deep links to a student land on that person’s folder. */
export function StudentDetailPage({ studentId }: { studentId: string }) {
  const navigate = useNavigate();
  const { data, cause } = useLoad(
    ['students', studentId, 'redirect'],
    () => getStudent(studentId),
    'Could not load the student',
  );

  useEffect(() => {
    if (!data) return;
    void navigate({
      to: '/space/$spaceId',
      params: { spaceId: data.spaceId },
      search: { folderId: undefined, itemId: undefined, studentId },
      replace: true,
    });
  }, [studentId, data, navigate]);

  if (data === null) return <LoadState error={cause} what="student" />;
  return <p className="text-secondary text-muted-foreground">Opening…</p>;
}
