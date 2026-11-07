import { JoinError } from '@openroom/sdk';

const LINK_BACK = 'Open the personal link your tutor sent you to come back to the lesson.';
const GUEST_LINK_BACK = 'Open the guest link you were sent to come back to the session.';

/**
 * Join failures the participant can act on, keyed by the server's stable
 * error code. An ended session and a mistyped code share one line on purpose:
 * the join form must not tell which codes exist.
 */
const MESSAGES: Record<string, string> = {
  'session-full': 'This session is full.',
  'session-not-found': 'This session has ended, or the code is wrong. Check it with your tutor.',
  'session-not-started': 'Your tutor has not started the session yet.',
  'student-link-required': LINK_BACK,
  'student-link-invalid': 'This link no longer works. Ask your tutor for a new one.',
  'invalid-student-link': 'This link no longer works. Ask your tutor for a new one.',
  'guest-link-required': GUEST_LINK_BACK,
  'guest-link-invalid': 'This guest link no longer works. Ask the host for a new one.',
  'invalid-guest-link': 'This guest link no longer works. Ask the host for a new one.',
};

/**
 * How a learner gets back into a session a code alone cannot open: identified
 * sessions take the personal link, guest-list sessions the guest link. Null for modes
 * the join code opens.
 */
export function comeBackLine(identityMode: string | undefined): string | null {
  if (identityMode === 'identified') return LINK_BACK;
  if (identityMode === 'guest-list') return GUEST_LINK_BACK;
  return null;
}

/** The line the join screen shows for a failed join. */
export function joinErrorMessage(error: unknown): string {
  if (error instanceof JoinError && error.code !== undefined) {
    const known = MESSAGES[error.code];
    if (known !== undefined) return known;
  }
  return error instanceof Error ? error.message : 'Join failed.';
}

/** The tutor has not pressed start yet: a link arrival waits and tries again. */
export function isNotStarted(error: unknown): boolean {
  return error instanceof JoinError && error.code === 'session-not-started';
}

/**
 * No answer that says anything about the session: the request never arrived
 * (fetch rejects with a TypeError), a server fault, or a rate limit.
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof JoinError) return error.status >= 500 || error.status === 429;
  return error instanceof TypeError;
}
