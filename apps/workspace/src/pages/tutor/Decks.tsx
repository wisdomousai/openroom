import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { createDeck } from '../../api';
import { Button } from '@openroom/ui/components/button';
import { to } from '../../destinations';
import { blankDeck } from '@openroom/editor';
import { invalidateManagementData } from '../../query-client';

/** Creating is an entry into the editor, never a metadata form. */
export function DeckNewPage({ contextId, spaceId, folderId }: {
  contextId: string | null; spaceId: string | null; folderId: string | null;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const creation = useRef<ReturnType<typeof createDeck> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    creation.current ??= createDeck({
      title: 'Untitled', content: blankDeck(), spaceId, folderId,
      ...(contextId ? { contextId } : {}),
    });
    void creation.current.then(async ({ deck }) => {
      await invalidateManagementData();
      if (active) await navigate({ ...to.deckEditor(deck.id), replace: true });
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not create the deck.');
    });
    return () => { active = false; };
  }, [contextId, spaceId, folderId, navigate, attempt]);
  return (
    <main className="flex h-svh flex-col items-center justify-center gap-4 bg-background">
      <p role={error ? 'alert' : 'status'}>{error ?? 'Opening new deck…'}</p>
      {error ? <>
        <Button onClick={() => { creation.current = null; setError(null); setAttempt((n) => n + 1); }}>Retry</Button>
        <Button asChild variant="ghost"><Link {...to.library({ spaceId, folderId })}>Library</Link></Button>
      </> : null}
    </main>
  );
}
