import { JoinError } from '@openroom/sdk';
import { describe, expect, it } from 'vitest';

import { isNotStarted, joinErrorMessage } from './join-error';

describe('join error message', () => {
  it('states a full session plainly, whatever the server wording', () => {
    expect(joinErrorMessage(new JoinError('Could not join session (409)', 409, 'session-full'))).toBe('This session is full.');
  });

  it('gives an ended session and a wrong code the same line, never a bare status', () => {
    const ended = joinErrorMessage(new JoinError('Could not join session (404)', 404, 'session-not-found'));
    expect(ended).toBe('This session has ended, or the code is wrong. Check it with your tutor.');
    expect(ended).not.toContain('404');
  });

  it('tells a learner without a working link what to do next', () => {
    expect(
      joinErrorMessage(
        new JoinError('This session is only open to people with an access link.', 403, 'context-link-required'),
      ),
    ).toBe('Open the personal link your tutor sent you to come back to the lesson.');
    expect(
      joinErrorMessage(new JoinError('That access link is not valid for this session.', 403, 'context-link-invalid')),
    ).toBe('This link no longer works. Ask your tutor for a new one.');
  });

  it('keeps the server message for every other join failure', () => {
    expect(joinErrorMessage(new JoinError('That handle is not in this session.', 404, 'handle-not-found'))).toBe('That handle is not in this session.');
    expect(joinErrorMessage('offline')).toBe('Join failed.');
  });

  it('recognises only the not-started answer as a reason to wait', () => {
    expect(isNotStarted(new JoinError('The tutor has not started the session.', 409, 'session-not-started'))).toBe(true);
    expect(isNotStarted(new JoinError('Could not join session (409)', 409, 'session-full'))).toBe(false);
    expect(isNotStarted(new Error('offline'))).toBe(false);
  });
});
