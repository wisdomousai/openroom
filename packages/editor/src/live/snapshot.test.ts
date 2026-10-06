import { describe, expect, it } from 'vitest';
import { activeId, answeredOf, counts, optionsOf, railItems, statusOf } from './snapshot';
import type { HostSnapshot, Session } from '../types';

const session: Session = {
  version: 1,
  meta: { title: 'Test' },
  interactions: [
    {
      id: 'q1',
      type: 'choice',
      prompt: 'Pick one',
      options: [
        { id: 'a', label: 'A', correct: true },
        { id: 'b', label: 'B' },
      ],
      notes: 'say hello',
    },
    { id: 'q2', type: 'text', prompt: 'Say something' },
  ],
};

// Shape declared by @openroom/sdk: flat summaries + active interaction.
const sdkShape: HostSnapshot = {
  revision: 7,
  status: 'live',
  code: 'ABCDEFGH',
  joinUrl: '/?code=ABCDEFGH',
  frozen: false,
  participantCount: 12,
  answeredCount: 5,
  activeInteractionId: 'q1',
  interactions: [
    { id: 'q1', type: 'choice', prompt: 'Pick one', status: 'open', answered: 5 },
    { id: 'q2', type: 'text', prompt: 'Say something', status: 'pending', answered: 0 },
  ],
  interaction: { id: 'q1', type: 'choice', prompt: 'Pick one' },
  interactionStatus: 'open',
  aggregate: { kind: 'choice', counts: { a: 3, b: 2 }, total: 5, dontKnow: 0 },
};

// Shape implied by the domain SessionState (record keyed by interaction id).
const recordShape: HostSnapshot = {
  revision: 3,
  status: 'live',
  code: 'ABCDEFGH',
  frozen: true,
  joined: 4,
  activeInteractionId: 'q2',
  interactions: {
    q1: { status: 'revealed', aggregate: { kind: 'choice', counts: { a: 1 }, total: 1, dontKnow: 0 } },
    q2: {
      status: 'open',
      aggregate: { kind: 'text', entries: [{ participantId: 'p1', text: 'hi', hidden: false }], total: 1 },
    },
  },
};

describe('snapshot accessors', () => {
  it('reads the SDK array shape', () => {
    expect(activeId(sdkShape)).toBe('q1');
    expect(statusOf(sdkShape, 'q1')).toBe('open');
    expect(statusOf(sdkShape, 'q2')).toBe('pending');
    expect(answeredOf(sdkShape, 'q1')).toBe(5);
    expect(counts(sdkShape)).toEqual({ joined: 12, answered: 5 });
  });

  it('reads the record shape', () => {
    expect(statusOf(recordShape, 'q1')).toBe('revealed');
    expect(answeredOf(recordShape, 'q2')).toBe(1);
    expect(counts(recordShape).joined).toBe(4);
  });

  it('orders the rail by the session document and keeps notes', () => {
    const items = railItems(sdkShape, session);
    expect(items.map((i) => i.id)).toEqual(['q1', 'q2']);
    expect(items[0]?.notes).toBe('say hello');
    expect(items[0]?.status).toBe('open');
  });

  it('falls back to snapshot summaries with no session document', () => {
    const items = railItems(sdkShape, null);
    expect(items.map((i) => i.status)).toEqual(['open', 'pending']);
  });

  it('resolves choice option labels from the session document', () => {
    expect(optionsOf(sdkShape, session, 'q1')?.[0]?.label).toBe('A');
    expect(optionsOf(sdkShape, null, 'q1')).toBeUndefined();
  });

  it('treats an unknown interaction as pending with no answers', () => {
    expect(statusOf(sdkShape, 'nope')).toBe('pending');
    expect(answeredOf(sdkShape, 'nope')).toBe(0);
  });
});
