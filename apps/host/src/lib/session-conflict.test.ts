import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import {
  interactionDiffers,
  keepMyCopyTitle,
  parseVersionConflict,
  restoreInteraction,
} from './session-conflict';
import type { ChoiceInteraction, Session } from '@openroom/editor';

function conflictError(): ApiError {
  return new ApiError(409, 'conflict', 'E_VERSION_CONFLICT', [], {
    ok: false,
    error: {
      code: 'E_VERSION_CONFLICT',
      latestVersion: 4,
      latestAuthor: { id: 'u2', name: 'Anna' },
      latestCreatedAt: 1234,
    },
  });
}

function choice(id: string, prompt: string): ChoiceInteraction {
  return { id, type: 'choice', prompt, options: [{ id: 'a', label: 'A' }] };
}

function sessionDoc(interactions: Session['interactions']): Session {
  return { version: 1, meta: { title: 'T' }, interactions };
}

describe('parseVersionConflict', () => {
  it('extracts the structured 409 payload', () => {
    expect(parseVersionConflict(conflictError())).toEqual({
      latestVersion: 4,
      authorName: 'Anna',
      latestCreatedAt: 1234,
    });
  });

  it('ignores other errors', () => {
    expect(parseVersionConflict(new Error('nope'))).toBeNull();
    expect(parseVersionConflict(new ApiError(422, 'invalid'))).toBeNull();
    expect(parseVersionConflict(new ApiError(409, 'other', 'E_REVISION_CONFLICT'))).toBeNull();
  });
});

describe('keepMyCopyTitle', () => {
  it('appends the suffix', () => {
    expect(keepMyCopyTitle('Bio quiz')).toBe('Bio quiz (local copy)');
  });
  it('falls back for empty titles and respects the 200-char cap', () => {
    expect(keepMyCopyTitle('  ')).toBe('Untitled session (local copy)');
    expect(keepMyCopyTitle('x'.repeat(300)).length).toBe(200);
  });
});

describe('restoreInteraction', () => {
  it('replaces by id in place', () => {
    const current = sessionDoc([choice('q1', 'Old'), choice('q2', 'Keep')]);
    const next = restoreInteraction(current, choice('q1', 'Restored'));
    expect(next.interactions.map((i) => i.prompt)).toEqual(['Restored', 'Keep']);
  });
  it('appends when the id is gone', () => {
    const current = sessionDoc([choice('q2', 'Keep')]);
    const next = restoreInteraction(current, choice('q1', 'Back'));
    expect(next.interactions.map((i) => i.id)).toEqual(['q2', 'q1']);
  });
  it('does not mutate the input session document', () => {
    const current = sessionDoc([choice('q1', 'Old')]);
    restoreInteraction(current, choice('q1', 'New'));
    expect(current.interactions[0]!.prompt).toBe('Old');
  });
});

describe('interactionDiffers', () => {
  it('detects changed, identical, and missing counterparts', () => {
    const current = sessionDoc([choice('q1', 'Now')]);
    expect(interactionDiffers(current, choice('q1', 'Now'))).toBe(false);
    expect(interactionDiffers(current, choice('q1', 'Then'))).toBe(true);
    expect(interactionDiffers(current, choice('q9', 'Gone'))).toBe(true);
  });
});
