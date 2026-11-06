import { useState } from 'react';
import { facilitateSession, type MySession } from '../api/tokens';
import { useQuery } from '@tanstack/react-query';
import { listMySessions } from '../api';
import type { StoredSession } from '@openroom/editor';
import { Button } from '@openroom/ui/components/button';

/**
 * The button text names the student before the deck: two lessons of decks both
 * called "Untitled" for two students must not read the same.
 */
export function liveNowLabel(session: Pick<MySession, 'shared' | 'title' | 'code' | 'contextName'>): string {
  const verb = session.shared ? 'Join session' : 'Rejoin';
  const deck = session.title ?? session.code;
  return session.contextName ? `${verb} ${session.contextName}, ${deck}` : `${verb} ${deck}`;
}

/**
 * Every live lesson this tutor can rejoin, on every student's place: this row
 * is the cross-device recovery path. The current student's lessons come first.
 */
export function LiveNow({ onOpen, contextId = null }: { onOpen: (session: StoredSession) => void; contextId?: string | null }) {
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data = [] } = useQuery({ queryKey: ['sessions', 'live-now'], queryFn: listMySessions, refetchInterval: 15_000 });
  const live = data.filter((session) => !session.ended && session.recoverable);
  if (live.length === 0) return null;
  const sessions = contextId === null
    ? live
    : [...live.filter((session) => session.contextId === contextId), ...live.filter((session) => session.contextId !== contextId)];
  return <section aria-label="Live now" className="flex flex-wrap items-center gap-3 border-b border-border px-8 py-3">
    <span className="text-caption text-muted-foreground">Live now</span>
    {sessions.map((session) => <Button key={session.sessionCode} size="sm" variant="outline" disabled={joining !== null} onClick={async () => {
      setJoining(session.sessionCode); setError(null);
      try { onOpen({ ...await facilitateSession(session.sessionCode), title: session.title ?? undefined }); }
      catch (err) { setError(err instanceof Error ? err.message : 'Could not join the session.'); }
      finally { setJoining(null); }
    }}>{joining === session.sessionCode ? 'Joining…' : liveNowLabel(session)}</Button>)}
    {error ? <p role="alert" className="text-secondary text-destructive">{error}</p> : null}
  </section>;
}
