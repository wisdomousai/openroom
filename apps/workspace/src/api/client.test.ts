/**
 * The worker answers failures with a code. What reaches the tutor, in the
 * workspace and in the editor's media dialogs, is a sentence; the code stays
 * on `ApiError.code` for callers that branch on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, NETWORK_ERROR, OFFLINE_MESSAGE, request, responseError } from './client';

afterEach(() => { vi.unstubAllGlobals(); });

describe('API errors', () => {
  it('turns a string code into a sentence and keeps the code', () => {
    const error = responseError(503, { error: 'stock-unconfigured' });
    expect(error.message).toBe('Stock photos are not set up for this workspace.');
    expect(error.code).toBe('stock-unconfigured');
    // The editor's audio pane branches on this code for its own wording.
    expect(responseError(415, { error: 'unsupported-media-type' }).code).toBe('unsupported-media-type');
  });

  it('never prints a code the table does not name', () => {
    const error = responseError(404, { error: 'learner-not-found' });
    expect(error.message).toBe('This item no longer exists or is not shared with you.');
    expect(error.message).not.toContain('-');
    expect(responseError(500, null).message).toBe('OpenRoom could not finish this. Try again.');
  });

  it('keeps a message that is already a sentence, and codes screens still match', () => {
    const sentence = 'This context is in the trash. Restore it before sharing anything.';
    expect(responseError(409, { error: sentence }).message).toBe(sentence);
    expect(responseError(403, { error: 'continuity-required' }).message).toBe('continuity-required');
  });

  it('reports an unreachable worker as offline, not as a server failure', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const failure = await request('/api/tutoring/stock').catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 0, code: NETWORK_ERROR, message: OFFLINE_MESSAGE });
  });
});
