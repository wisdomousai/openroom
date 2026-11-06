import { JoinError } from '@openroom/sdk';

/**
 * Join failures the participant can act on, keyed by the server's stable
 * error code. An ended session and a mistyped code share one line on purpose:
 * the join form must not tell which codes exist.
 */
const MESSAGES: Record<string, string> = {
  'session-full': 'This session is full.',
  'session-not-found': 'This session has ended, or the code is wrong. Check it with your tutor.',
  'session-not-started': 'Your tutor has not started the session yet.',
  'context-link-required': 'Open the personal link your tutor sent you to come back to the lesson.',
  'context-link-invalid': 'This link no longer works. Ask your tutor for a new one.',
  'invalid-context-link': 'This link no longer works. Ask your tutor for a new one.',
};

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
