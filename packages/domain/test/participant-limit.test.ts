import { describe, expect, it } from 'vitest';
import { FREE_SESSION_PARTICIPANT_LIMIT } from '@openroom/schema';

import { createSession, participantLimitReached } from '../src/create-session.js';
import { applyCommand } from '../src/apply-command.js';
import { hostSnapshot, stageSnapshot } from '../src/snapshots.js';
import { hostWireSnapshot } from '../src/wire-snapshots.js';
import type { Command, SessionState } from '../src/types.js';

const outline = {
  version: 1 as const,
  meta: { title: 'All hands' },
  interactions: [{ id: 'q', type: 'choice' as const, prompt: 'Pick', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }],
};

function admit(state: SessionState, count: number): SessionState {
  const participants = { ...state.participants };
  for (let i = Object.keys(participants).length; i < count; i++) participants[`p${i}`] = { joinedAt: i };
  return { ...state, participants };
}

function host(state: SessionState, command: Command): SessionState {
  const result = applyCommand(state, { idempotencyKey: command.command, command, actor: { role: 'host', facilitatorId: 'creator' } }, 1);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.state;
}

describe('participant limit', () => {
  it('admits up to the limit and reports full only at it', () => {
    const state = createSession(outline, 'ABCD2345', 0, { participantLimit: FREE_SESSION_PARTICIPANT_LIMIT });
    expect(participantLimitReached(admit(state, FREE_SESSION_PARTICIPANT_LIMIT - 1))).toBe(false);
    expect(participantLimitReached(admit(state, FREE_SESSION_PARTICIPANT_LIMIT))).toBe(true);
  });

  it('never fills a session created without a limit', () => {
    const state = admit(createSession(outline, 'ABCD2345', 0), 500);
    expect(participantLimitReached(state)).toBe(false);
    expect(hostSnapshot(state).participantLimit).toBeUndefined();
    expect('participantLimit' in hostWireSnapshot(state)).toBe(false);
  });

  it('keeps the limit through the session lifecycle and shows it to the host only', () => {
    let state = createSession(outline, 'ABCD2345', 0, { participantLimit: 50 });
    for (const command of [{ command: 'session.start' }, { command: 'interaction.open', interactionId: 'q' }, { command: 'session.freeze' }] as Command[]) {
      state = host(state, command);
    }
    expect(state.participantLimit).toBe(50);
    expect(hostWireSnapshot(state).participantLimit).toBe(50);
    expect('participantLimit' in stageSnapshot(state)).toBe(false);
  });
});
