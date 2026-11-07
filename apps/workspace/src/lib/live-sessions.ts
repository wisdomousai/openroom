import type { MySession } from '../api/tokens';

/**
 * The recoverable live session of this deck and its student, if one is
 * running. Start session asks once before it files another; a session of the
 * same deck for a different student is a different lesson and does not count.
 */
export function liveSessionOf(
  sessions: readonly MySession[],
  deck: { id: string; studentId?: string | null },
): MySession | null {
  const studentId = deck.studentId || null;
  return sessions.find((session) =>
    session.deckId === deck.id
    && (session.studentId || null) === studentId
    && !session.ended
    && session.recoverable) ?? null;
}
