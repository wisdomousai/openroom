/**
 * The tutor's private scratchpad.
 *
 * Why it lives in `localStorage` and nowhere else: a live session is an
 * ephemeral thing, and typing an observation about a named student into it must
 * not be the same act as filing a durable record about that student. The line
 * is `docs/PRD.md` § Product principles ("operational aggregates, not participant surveillance
 * data") and `docs/TUTORING.md` ("a short outcome record, not a transcript"),
 * and `docs/IA.md` draws it explicitly for the tutoring aside.
 *
 * So the scratchpad:
 *  - never travels on the WebSocket and never reaches the Worker or D1;
 *  - holds only what the tutor typed — nothing learner-generated is ever copied
 *    into it, and there is no "add to record" button in the live console;
 *  - is offered as a PREFILL on `#/sessions/:id/record` after the session ends,
 *    where the tutor composes and saves the notes deliberately.
 *
 * Keyed by join code while the session is live, re-keyed to the durable session
 * id at the moment it ends (the notes form is addressed by session id). Note
 * text never travels in a URL.
 */

const LIVE_PREFIX = 'openroom.host.notes.live.';
const SESSION_PREFIX = 'openroom.host.notes.session.';

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the scratchpad degrades to this tab's memory */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readLiveNotes(sessionCode: string): string {
  return get(LIVE_PREFIX + sessionCode) ?? '';
}

export function writeLiveNotes(sessionCode: string, text: string): void {
  if (text === '') {
    remove(LIVE_PREFIX + sessionCode);
    return;
  }
  set(LIVE_PREFIX + sessionCode, text);
}

/**
 * End of session: move the notes from the live code key to the durable session
 * key so the notes form can offer them, and drop the live-keyed copy. Called
 * with the durable session id; without one there is no record to prefill and
 * the notes are simply cleared.
 */
export function handOffLiveNotes(sessionCode: string, sessionId: string | null): void {
  const text = readLiveNotes(sessionCode);
  remove(LIVE_PREFIX + sessionCode);
  if (sessionId === null || text === '') return;
  set(SESSION_PREFIX + sessionId, text);
}

/** The prefill offered on the notes form. Reading does not consume it. */
export function readSessionNotes(sessionId: string): string {
  return get(SESSION_PREFIX + sessionId) ?? '';
}

/** Retain unsaved private notes on this device, including after role changes. */
export function writeSessionNotes(sessionId: string, text: string): void {
  if (text === '') remove(SESSION_PREFIX + sessionId);
  else set(SESSION_PREFIX + sessionId, text);
}

/** Called once the notes are actually saved — the scratchpad has done its job. */
export function clearSessionNotes(sessionId: string): void {
  remove(SESSION_PREFIX + sessionId);
}
