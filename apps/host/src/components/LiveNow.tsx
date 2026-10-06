import { useState } from 'react';
import { facilitateSession } from '../api/tokens';
import { useQuery } from '@tanstack/react-query';
import { listMySessions } from '../api';
import type { StoredSession } from '../../../../packages/editor/src/types';
import { Button } from '@openroom/ui/components/button';

export function LiveNow({ onOpen }: { onOpen: (session: StoredSession) => void }) {
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data = [] } = useQuery({ queryKey: ['sessions', 'live-now'], queryFn: listMySessions, refetchInterval: 15_000 });
  const sessions = data.filter((session) => !session.ended && session.recoverable);
  if (sessions.length === 0) return null;
  return <section aria-label="Live now" className="flex flex-wrap items-center gap-3 border-b border-border px-8 py-3">
    <span className="text-caption text-muted-foreground">Live now</span>
    {sessions.map((session) => <Button key={session.sessionCode} size="sm" variant="outline" disabled={joining !== null} onClick={async () => {
      setJoining(session.sessionCode); setError(null);
      try { onOpen({ ...await facilitateSession(session.sessionCode), title: session.title ?? undefined }); }
      catch (err) { setError(err instanceof Error ? err.message : 'Could not join the session.'); }
      finally { setJoining(null); }
    }}>{joining === session.sessionCode ? 'Joining…' : session.shared ? 'Join session' : 'Rejoin'} {session.title ?? session.code}</Button>)}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </section>;
}
