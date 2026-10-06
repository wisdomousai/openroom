import { JoinError } from '@openroom/sdk';
import { describe, expect, it } from 'vitest';

import { joinErrorMessage } from './join-error';

describe('join error message', () => {
  it('states a full session plainly, whatever the server wording', () => {
    expect(joinErrorMessage(new JoinError('Could not join session (409)', 409, 'session-full'))).toBe('This session is full.');
  });

  it('keeps the server message for every other join failure', () => {
    expect(joinErrorMessage(new JoinError('That handle is not in this session.', 404, 'handle-not-found'))).toBe('That handle is not in this session.');
    expect(joinErrorMessage('offline')).toBe('Join failed.');
  });
});
