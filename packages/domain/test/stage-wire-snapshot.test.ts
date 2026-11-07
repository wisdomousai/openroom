import type { Outline } from '@openroom/schema';
import { describe, expect, it } from 'vitest';

import { createSession } from '../src/create-session.js';
import { stageWireSnapshot } from '../src/wire-snapshots.js';
import { env, run } from './helpers.js';

const outline = (identityMode: 'identified' | 'nickname'): Outline => ({
  version: 1,
  meta: { title: 'Travel' },
  defaults: { identityMode },
  steps: [{ id: 'check', kind: 'interaction', interactionId: 'q' }],
  interactions: [
    { id: 'q', type: 'choice', prompt: 'Pick', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
  ],
});

/**
 * The Stage hides the join code and QR of an identified session, so it has to
 * be told the regime. The flag is the only identity fact it gets: the learner's
 * name stays off the stage feed.
 */
describe('stage wire snapshot identity', () => {
  it('tells the stage an identified session is identified, without the learner name', () => {
    let state = createSession(outline('identified'), 'LIVE0001', 0, { outlineVersion: 1 });
    state = run(state, env({ command: 'session.start' }));
    state = { ...state, participants: { lea: { joinedAt: 0, name: 'Léa' } } };
    const wire = stageWireSnapshot(state) as Record<string, unknown>;
    expect(wire.identityMode).toBe('identified');
    expect(JSON.stringify(wire)).not.toContain('Léa');
  });

  it('reports a classroom session as not identified', () => {
    let state = createSession(outline('nickname'), 'LIVE0002', 0, { outlineVersion: 1 });
    state = run(state, env({ command: 'session.start' }));
    expect((stageWireSnapshot(state) as Record<string, unknown>).identityMode).not.toBe('identified');
  });
});
