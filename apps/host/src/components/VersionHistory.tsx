import { useQuery } from '@tanstack/react-query';
import { stringify } from 'yaml';
import type { Outline } from '@openroom/schema';

import { getDeck, listDeckVersions } from '../api';
import { Button } from './ui/button';

function when(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Stamped versions of this deck. Lives in the task pane History tab — the
 * sanctioned home for dates and version numbers (AGENTS.md No-Ledger Rule).
 */
export function VersionHistory({
  deckId,
  refreshKey,
  currentVersion,
  onLoadVersion,
}: {
  deckId: string;
  /** Bumped after a stamp so the list refreshes. */
  refreshKey: number;
  currentVersion: number;
  onLoadVersion: (source: string, version: number) => void;
}) {
  const versionsQuery = useQuery({
    queryKey: ['decks', deckId, 'versions', refreshKey] as const,
    queryFn: () => listDeckVersions(deckId),
  });
  const versions = versionsQuery.data ?? [];

  const restore = async (version: number) => {
    const detail = await getDeck(deckId, version);
    if (detail.content === null) return;
    onLoadVersion(stringify(detail.content as Outline, { lineWidth: 100 }), version);
  };

  if (versionsQuery.error) {
    return <p className="text-caption text-destructive">Could not load version history.</p>;
  }
  if (versions.length === 0) {
    return (
      <p className="text-caption text-muted-foreground">
        {versionsQuery.isPending ? 'Loading…' : 'No versions yet.'}
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {versions.map((entry, index) => {
        const latest = entry.version === currentVersion || index === 0;
        return (
          <li
            key={entry.version}
            className="flex items-center justify-between gap-2 border-b border-hairline py-2.5 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="text-row-title tabular-nums">v{entry.version}</p>
              <p className="text-caption text-muted-foreground">
                {when(entry.createdAt)}
                {latest ? ' · latest' : ''}
              </p>
            </div>
            {latest ? null : (
              <Button type="button" size="sm" variant="subtle" onClick={() => void restore(entry.version)}>
                Restore
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
