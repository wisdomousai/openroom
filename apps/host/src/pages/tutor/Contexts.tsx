import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { ContextKind } from '@openroom/schema';

import {
  createContext,
  getContext,
  listContexts,
  updateContext,
  type ContextDetail,
} from '../../api';
import { ContextFieldsEditor } from '../../components/ContextFieldsEditor';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  contextFromFields,
  fieldsFromContext,
  LEVEL_CHIPS,
  type ContextFields,
} from '../../lib/context-fields';
import { to, type LinkTarget } from '../../destinations';
import { invalidateManagementData } from '../../query-client';
import {
  LoadState,
  messageOf,
  useLoad,
} from './shared';

/**
 * `#/tutor/contexts` is a legacy parse alias onto the Who-I-teach folder.
 * The rail owns the list; this page just lands you on a person.
 */
export function ContextsPage() {
  const navigate = useNavigate();
  const { data, error } = useLoad(
    ['contexts', 'collection'],
    () => listContexts(),
    'Could not load students',
  );

  useEffect(() => {
    if (!data || data.length === 0) return;
    const first = data[0]!;
    void navigate({ ...to.library({ spaceId: first.spaceId, contextId: first.id }), replace: true });
  }, [data, navigate]);

  if (data === null) return <LoadState error={error} />;
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

function ContextForm({
  heading,
  initial,
  submitLabel,
  cancelTo,
  onSubmit,
  kind,
  onKindChange,
}: {
  heading: string;
  initial?: ContextDetail;
  submitLabel: string;
  cancelTo: LinkTarget;
  onSubmit: (input: { displayName: string; context: Record<string, unknown> }) => Promise<void>;
  kind?: ContextKind;
  onKindChange?: (kind: 'person' | 'group') => void;
}) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [fields, setFields] = useState<ContextFields>(() => fieldsFromContext(initial?.context));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const name = displayName.trim();
    if (name === '') {
      setError('Enter a name.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ displayName: name, context: contextFromFields(fields) });
    } catch (cause) {
      setError(messageOf(cause, 'Could not save the context'));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-screen-title">{heading}</h1>
      </header>

      {onKindChange ? <fieldset className="flex gap-5"><legend className="mb-2 text-row-title">Who is this for?</legend>
        {(['person', 'group'] as const).map((value) => <label key={value} className="flex items-center gap-2">
          <input type="radio" name="context-kind" checked={kind === value} onChange={() => onKindChange(value)} />
          {value === 'person' ? 'Individual' : 'Small group'}
        </label>)}
      </fieldset> : null}

      <div className="flex flex-col gap-2">
        <label htmlFor="context-name" className="text-row-title">
          Name
        </label>
        <Input
          id="context-name"
          required
          placeholder="e.g. Camille, Year 9 French, Tuesday group"
          value={displayName}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
        />
      </div>

      <ContextFieldsEditor value={fields} onChange={setFields} levelSuggestions={kind === 'class' ? LEVEL_CHIPS : undefined} />

      {error ? <p role="alert" className="text-secondary text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2 border-t border-hairline bg-background py-3.5">
        <p className="min-w-0 flex-1 text-caption text-muted-foreground">Only the name is required.</p>
        <Button asChild type="button" variant="outline">
          <Link {...cancelTo}>Cancel</Link>
        </Button>
        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function ContextNewPage({ sourceSpaceId, experience = 'tutoring' }: { sourceSpaceId?: string; experience?: 'tutoring' | 'classroom' }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<'person' | 'group'>('person');
  return (
    <ContextForm
      heading={experience === 'classroom' ? 'Add class' : 'Add student or group'}
      kind={experience === 'classroom' ? 'class' : kind}
      onKindChange={experience === 'tutoring' ? setKind : undefined}
      submitLabel="Save"
      cancelTo={to.library({ spaceId: sourceSpaceId })}
      onSubmit={async (input) => {
        const created = await createContext({
          displayName: input.displayName,
          kind: experience === 'classroom' ? 'class' : kind,
          context: input.context,
          sourceSpaceId,
          experience,
        });
        await invalidateManagementData();
        await navigate(to.library({ spaceId: created.spaceId, contextId: created.id }));
      }}
    />
  );
}

export function ContextEditPage({ contextId }: { contextId: string }) {
  const navigate = useNavigate();
  const { data: detail, error } = useLoad(
    ['contexts', contextId, 'edit'],
    () => getContext(contextId),
    'Could not load the context',
  );
  if (detail === null) return <LoadState error={error} />;
  return (
    <ContextForm
      heading={`${detail.displayName}’s context`}
      initial={detail}
      kind={detail.kind}
      submitLabel="Save"
      cancelTo={to.library({ spaceId: detail.spaceId, contextId })}
      onSubmit={async (input) => {
        await updateContext(contextId, {
          displayName: input.displayName,
          kind: detail.kind,
          context: input.context,
        });
        await invalidateManagementData();
        await navigate(to.library({ spaceId: detail.spaceId, contextId }));
      }}
    />
  );
}

/** Deep links to a context land on that person’s folder. */
export function ContextDetailPage({ contextId }: { contextId: string }) {
  const navigate = useNavigate();
  const { data, error } = useLoad(
    ['contexts', contextId, 'redirect'],
    () => getContext(contextId),
    'Could not load the context',
  );

  useEffect(() => {
    if (!data) return;
    void navigate({
      to: '/space/$spaceId',
      params: { spaceId: data.spaceId },
      search: { folderId: undefined, itemId: undefined, contextId },
      replace: true,
    });
  }, [contextId, data, navigate]);

  if (data === null) return <LoadState error={error} />;
  return <p className="text-secondary text-muted-foreground">Opening…</p>;
}
