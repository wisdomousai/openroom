import type { Outline } from '@openroom/schema';
import type { Connection } from './auth';

export interface Space { id: string; name: string; role: string }
export interface Deck { id: string; title: string; spaceId: string }
export interface DeckDetail { deck: Deck; content: Outline | null }
export class ConnectionExpired extends Error {}
export class RequestError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function request<T>(connection: Connection, path: string, signal?: AbortSignal, body?: object): Promise<T> {
  if (connection.expiresAt <= Date.now()) throw new ConnectionExpired('Your connection expired. Sign in again to continue.');
  const response = await fetch(path, { credentials: 'omit', method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${connection.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, signal, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 401) throw new ConnectionExpired('This connection is no longer active. Sign in again to continue.');
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: string } | null;
    const code = typeof error?.error === 'string' ? error.error : 'request-failed';
    const messages: Record<string, string> = {
      'presentation-space-mismatch': 'Use slides from one shared space in a session. Move the source decks into the same space before starting.',
      'presentation-context-mismatch': 'These decks are linked to different students or groups. Use decks with the same student or group for one session.',
      'presentation-identity-mismatch': 'These decks use different participant identity settings. Match those settings before starting one session.',
      'invalid-presentation-content': 'Complete any unfinished questions in OpenRoom, or reduce the number of embedded slides, then try again.',
      'presentation-too-large': 'The embedded slides are too large for one session. Use fewer slides and try again.',
      'session-already-ended': 'This session has ended. Start a new session for another audience.',
      'session-expired': 'This session has expired. Start a new session for another audience.',
      'activity-not-found': 'This slide changed. Choose a saved OpenRoom slide again.',
      'request-id-conflict': 'This session belongs to another presenter. Resume it with an authorized account or start a new session.',
      'deck-content-not-found': 'Save this deck in OpenRoom before starting a session.',
    };
    throw new RequestError(response.status, code, messages[code] ?? (response.status === 403 || response.status === 404 ? 'This content is unavailable or you no longer have access.' : 'Could not complete this action. Try again.'));
  }
  return response.json() as Promise<T>;
}
