import type { Session } from '@openroom/schema';

import { createSession, type ApplyResult } from '../src/index.js';
import { applyCommand } from '../src/apply-command.js';
import type { Command, CommandEnvelope, SessionState } from '../src/types.js';

/**
 * Shared fixture session covering every interaction type plus edge-case flags:
 *  - `single-choice`: default (allowAnswerChange true, single-select, allowDontKnow true)
 *  - `locked-choice`: allowAnswerChange false
 *  - `multi-choice`: multiple: true
 *  - `mood`: scale 1..5
 *  - `guess`: numeric with correct+tolerance
 *  - `reflection`: text, maxLength 20
 *  - `ask`: qna
 *  - `priority`: ranking over 3 options, allowDontKnow true
 *  - `pi-vote`: single-select choice with peerInstruction: true
 */
export const fixtureSpec: Session = {
  version: 1,
  meta: { title: 'Domain test fixture' },
  interactions: [
    {
      id: 'single-choice',
      type: 'choice',
      prompt: 'Pick one',
      allowDontKnow: true,
      options: [
        { id: 'yes', label: 'Yes', correct: true },
        { id: 'no', label: 'No', misconception: 'nope' },
      ],
      notes: 'host only note',
      pedagogy: { explanation: 'because reasons', followUp: 'ask why' },
    },
    {
      id: 'locked-choice',
      type: 'choice',
      prompt: 'Pick one, no takebacks',
      allowAnswerChange: false,
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
    {
      id: 'multi-choice',
      type: 'choice',
      prompt: 'Pick any',
      multiple: true,
      options: [
        { id: 'x', label: 'X' },
        { id: 'y', label: 'Y' },
        { id: 'z', label: 'Z' },
      ],
    },
    {
      id: 'mood',
      type: 'scale',
      prompt: 'How confident?',
      min: 1,
      max: 5,
    },
    {
      id: 'guess',
      type: 'numeric',
      prompt: 'How many?',
      correct: 10,
      tolerance: 2,
      allowDontKnow: true,
    },
    {
      id: 'reflection',
      type: 'text',
      prompt: 'Reflect',
      maxLength: 20,
    },
    {
      id: 'ask',
      type: 'qna',
      prompt: 'Ask anything',
    },
    {
      id: 'priority',
      type: 'ranking',
      prompt: 'Order these',
      allowDontKnow: true,
      options: [
        { id: 'alpha', label: 'Alpha' },
        { id: 'beta', label: 'Beta' },
        { id: 'gamma', label: 'Gamma' },
      ],
    },
    {
      id: 'pi-vote',
      type: 'choice',
      prompt: 'Peer instruction question',
      peerInstruction: true,
      allowDontKnow: true,
      options: [
        { id: 'right', label: 'Right', correct: true },
        { id: 'wrong', label: 'Wrong', misconception: 'the usual one' },
      ],
    },
  ],
};

let keyCounter = 0;

/** Build a fresh CommandEnvelope with a unique idempotency key. */
export function env(
  command: Command,
  actor: CommandEnvelope['actor'] = { role: 'host', facilitatorId: 'creator' },
  expectedRevision?: number,
): CommandEnvelope {
  keyCounter += 1;
  const envelope: CommandEnvelope = { idempotencyKey: `k${keyCounter}`, actor, command };
  if (expectedRevision !== undefined) envelope.expectedRevision = expectedRevision;
  return envelope;
}

export function host(): CommandEnvelope['actor'] {
  return { role: 'host', facilitatorId: 'creator' };
}

export function participant(id: string): CommandEnvelope['actor'] {
  return { role: 'participant', participantId: id };
}

export function stageActor(): CommandEnvelope['actor'] {
  return { role: 'stage' };
}

/** Apply a command and assert it succeeded, returning the new state. */
export function run(state: SessionState, envelope: CommandEnvelope, now = 1000): SessionState {
  const result = applyCommand(state, envelope, now);
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.state;
}

/** Apply a command and assert it failed with a specific error code. */
export function expectError(
  state: SessionState,
  envelope: CommandEnvelope,
  code: string,
  now = 1000,
): void {
  const result = applyCommand(state, envelope, now);
  if (result.ok) {
    throw new Error(`expected error ${code}, got ok (revision ${result.revision})`);
  }
  if (result.error.code !== code) {
    throw new Error(`expected error ${code}, got ${result.error.code}: ${result.error.message}`);
  }
}

export function newSession(session: Session = fixtureSpec): SessionState {
  return createSession(session, 'SESSTEST', 0);
}

/** Session in `live` status with nothing open yet. */
export function liveSession(session: Session = fixtureSpec): SessionState {
  return run(newSession(session), env({ command: 'session.start' }));
}

/** Session in `live` status with the given interaction open. */
export function sessionWithOpen(interactionId: string, session: Session = fixtureSpec): SessionState {
  return run(liveSession(session), env({ command: 'interaction.open', interactionId }));
}

export function apply(state: SessionState, envelope: CommandEnvelope, now = 1000): ApplyResult {
  return applyCommand(state, envelope, now);
}
