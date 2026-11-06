import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { stringify } from 'yaml';
import type { Outline } from '@openroom/schema';
import type { VersionHistoryProps } from '@openroom/editor';

import { getDeck, listDeckVersions } from '../api';
import { Button } from '@openroom/ui/components/button';

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
 *
 * Every version can be opened again, the latest included, except the one the
 * editor already holds unchanged. Opening a version replaces the draft, so a
 * draft with unsaved work asks first.
 */
export function VersionHistory({
  deckId,
  refreshKey,
  currentVersion,
  loadedVersion = null,
  unsavedDraft = false,
  onLoadVersion,
}: VersionHistoryProps) {
  const versionsQuery = useQuery({
    queryKey: ['decks', deckId, 'versions', refreshKey] as const,
    queryFn: () => listDeckVersions(deckId),
  });
  const versions = versionsQuery.data ?? [];
  const [confirming, setConfirming] = useState<number | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const restore = async (version: number) => {
    setConfirming(null);
    setOpening(version);
    setProblem(null);
    try {
      const detail = await getDeck(deckId, version);
      if (detail.content === null) throw new Error(`Version ${String(version)} has no content to open.`);
      onLoadVersion(stringify(detail.content as Outline, { lineWidth: 100 }), version);
    } catch (cause) {
      setProblem(cause instanceof Error && cause.message !== '' ? cause.message : `Version ${String(version)} could not be opened. Try again.`);
    } finally {
      setOpening(null);
    }
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
    <div className="flex flex-col gap-2">
      {problem === null ? null : <p role="alert" className="text-caption text-destructive">{problem}</p>}
      <ul className="flex flex-col">
        {versions.map((entry, index) => {
          const latest = entry.version === currentVersion || index === 0;
          const open = entry.version === loadedVersion;
          return (
            <li
              key={entry.version}
              className="flex flex-col gap-2 border-b border-hairline py-2.5 last:border-b-0"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-row-title tabular-nums">v{entry.version}</p>
                  <p className="text-caption text-muted-foreground">
                    {when(entry.createdAt)}
                    {latest ? ' · latest' : ''}
                    {open ? ' · open' : ''}
                  </p>
                </div>
                {open || confirming === entry.version ? null : (
                  <Button
                    type="button"
                    size="sm"
                    variant="subtle"
                    disabled={opening !== null}
                    onClick={() => {
                      if (unsavedDraft) setConfirming(entry.version);
                      else void restore(entry.version);
                    }}
                  >
                    {opening === entry.version ? 'Opening…' : 'Restore'}
                  </Button>
                )}
              </div>
              {confirming === entry.version ? (
                <div role="group" aria-label={`Restore v${String(entry.version)}`} className="flex flex-col gap-2">
                  <p className="text-caption">
                    Replace the open draft with v{entry.version}? Your unsaved edits are not kept.
                  </p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={() => void restore(entry.version)}>
                      Replace draft
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
