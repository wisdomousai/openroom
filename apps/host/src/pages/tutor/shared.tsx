import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { ArchiveRestore, Trash2 } from 'lucide-react';

import {
  getSpaceTree,
  type ContextKind,
} from '../../api';
import { getBreadcrumbTrail } from '../../lib/folder-tree';
import { Button } from '@openroom/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@openroom/ui/components/card';
import { Link } from '@tanstack/react-router';

import { to } from '../../destinations';
import { CONTINUITY_REQUIRED, ContinuityLock } from '../../components/ContinuityLock';

export type Notify = (message: string, tone?: 'info' | 'error') => void;

export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function formatDate(timestamp: number | null): string {
  // No time on the record — not "not scheduled": nothing here books anything.
  if (timestamp === null) return 'No date';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

/**
 * Transitional shared Query adapter for page-level server state. Every caller
 * supplies a semantic key so related screens never collide in the cache.
 */
export function useLoad<T>(
  queryKey: readonly unknown[],
  fn: () => Promise<T>,
  fallback: string,
): { data: T | null; error: string | null; reload: () => void } {
  const query = useQuery({ queryKey, queryFn: fn });
  return {
    data: query.data ?? null,
    error: query.error ? messageOf(query.error, fallback) : null,
    reload: () => { void query.refetch(); },
  };
}

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  /** Fact line only (path). Do not put date, status, or product/IA lectures here. */
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

export function EmptyCollection({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-6 text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

export function LoadState({ error }: { error: string | null }) {
  const queryClient = useQueryClient();
  if (error === CONTINUITY_REQUIRED) return <ContinuityLock />;
  if (!error) return <p className="text-sm text-muted-foreground" role="status">Loading…</p>;
  return (
    <div className="flex flex-col items-start gap-2 text-sm text-destructive" role="alert">
      <p>{error}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void queryClient.refetchQueries({ type: 'active' })}>
        Retry
      </Button>
    </div>
  );
}

/** The kinds of “who” a context can describe. Shared by the context form and the gate. */
export const KIND_OPTIONS: { value: ContextKind; label: string; hint: string }[] = [
  { value: 'person', label: 'One person', hint: '1:1 tutoring or coaching' },
  { value: 'group', label: 'Group', hint: 'A team, table, or small set of people' },
  { value: 'class', label: 'Class', hint: 'A class section or period' },
  { value: 'event', label: 'Event', hint: 'A meeting, open evening, or workshop' },
  { value: 'other', label: 'Other', hint: 'Anything that does not fit above' },
];

/**
 * Read-only place for create/edit forms. Location is inherited from the route
 * or parent object — not a flat parent/folder foreign-key picker.
 */
export function ItemLocation({
  spaceId,
  folderId,
  contextLabel,
}: {
  spaceId: string | null;
  folderId: string | null;
  /** Optional “who” line when creating from a context. */
  contextLabel?: string | null;
}) {
  const placeQuery = useQuery({
    queryKey: ['spaces', spaceId, 'tree'] as const,
    queryFn: () => getSpaceTree(spaceId!),
    enabled: spaceId !== null,
  });
  const spaceName = placeQuery.data?.space.name ?? null;
  const folders = placeQuery.data?.folders ?? [];
  const error = placeQuery.error ? messageOf(placeQuery.error, 'Could not load place') : null;

  if (!spaceId) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        Not saved in a space yet. Open a space folder and start from there.
        {error ? <p className="mt-1 text-destructive">{error}</p> : null}
      </div>
    );
  }

  const trail = getBreadcrumbTrail(folders, folderId);
  const placeTo = to.library({ spaceId, folderId });
  const path = [spaceName ?? 'Space', ...trail.map((f) => f.name)].join(' › ');

  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
      {contextLabel ? (
        <p className="text-muted-foreground">
          For <span className="font-medium text-foreground">{contextLabel}</span>
        </p>
      ) : null}
      <p>
        <span className="text-muted-foreground">Saving in </span>
        <Link className="font-medium underline-offset-4 hover:underline" {...placeTo}>
          {path}
        </Link>
      </p>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function TrashList({
  title,
  rows,
  onRestore,
  onPurge,
}: {
  title: string;
  rows: { id: string; label: string }[];
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
              <span className="font-medium">{row.label}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => onRestore(row.id)}>
                  <ArchiveRestore /> Restore
                </Button>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => onPurge(row.id)}>
                  <Trash2 /> Permanently delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
