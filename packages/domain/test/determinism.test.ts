import { describe, expect, it } from 'vitest';

import { applyCommand } from '../src/apply-command.js';
import { env, sessionWithOpen, participant, run } from './helpers.js';

describe('determinism', () => {
  it('same state + same envelope + same now => identical result, run twice', () => {
    const state = sessionWithOpen('mood');
    const envelope = env(
      { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 3 } },
      participant('p1'),
    );
    const now = 123456;
    const first = applyCommand(state, envelope, now);
    const second = applyCommand(state, envelope, now);
    expect(second).toEqual(first);
  });

  it('is true for error results too', () => {
    const state = sessionWithOpen('mood');
    const envelope = env(
      { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 999 } },
      participant('p1'),
    );
    const first = applyCommand(state, envelope, 1);
    const second = applyCommand(state, envelope, 1);
    expect(second).toEqual(first);
    expect(first.ok).toBe(false);
  });

  it('is true for host commands (interaction.open)', () => {
    const state = sessionWithOpen('mood');
    const envelope = env({ command: 'interaction.close', interactionId: 'mood' });
    const now = 999;
    const first = applyCommand(state, envelope, now);
    const second = applyCommand(state, envelope, now);
    expect(second).toEqual(first);
  });

  it('is true for ranking submissions', () => {
    const state = sessionWithOpen('priority');
    const envelope = env(
      {
        command: 'answer.submit',
        interactionId: 'priority',
        answer: { kind: 'ranking', optionIds: ['gamma', 'alpha', 'beta'] },
      },
      participant('p1'),
    );
    const first = applyCommand(state, envelope, 42);
    const second = applyCommand(state, envelope, 42);
    expect(second).toEqual(first);
  });

  it('is true for interaction.revote', () => {
    const closed = run(
      sessionWithOpen('pi-vote'),
      env({ command: 'interaction.close', interactionId: 'pi-vote' }),
    );
    const envelope = env({ command: 'interaction.revote', interactionId: 'pi-vote' });
    const first = applyCommand(closed, envelope, 77);
    const second = applyCommand(closed, envelope, 77);
    expect(second).toEqual(first);
  });

  it('the input state object is never mutated (referential purity)', () => {
    const state = sessionWithOpen('mood');
    const before = structuredClone(state);
    applyCommand(
      state,
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 3 } },
        participant('p1'),
      ),
      1,
    );
    expect(state).toEqual(before);
  });
});
