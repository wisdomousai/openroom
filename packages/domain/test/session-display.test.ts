import { describe, expect, it } from 'vitest';

import { applyCommand } from '../src/apply-command.js';
import { hostSnapshot, participantSnapshot, stageSnapshot } from '../src/snapshots.js';
import { env, expectError, sessionWithOpen, participant, run } from './helpers.js';

describe('session.display override', () => {
  it('overrides the authored display without dirtying the session', () => {
    let state = sessionWithOpen('single-choice');
    expect(state.outline.content.interactions.find((row) => row.id === 'single-choice')?.display).toBe(
      'bars',
    );
    state = run(state, env({ command: 'session.display', display: 'pie' }));
    expect(state.interactions['single-choice']?.displayOverride).toBe('pie');
    expect(state.outline.content.interactions.find((row) => row.id === 'single-choice')?.display).toBe(
      'bars',
    );
    expect(participantSnapshot(state, 'p1').interaction?.display).toBe('pie');
    expect(stageSnapshot(state).interaction?.display).toBe('pie');
    expect(hostSnapshot(state).interactions.find((row) => row.id === 'single-choice')?.display).toBe(
      'pie',
    );
  });

  it('rejects a display the interaction type cannot fill', () => {
    const state = sessionWithOpen('single-choice');
    expectError(state, env({ command: 'session.display', display: 'wordcloud' }), 'E_INVALID_DISPLAY');
    expect(state.interactions['single-choice']?.displayOverride).toBeUndefined();
  });

  it('is host-only and a no-op when the override is already set', () => {
    const state = run(sessionWithOpen('single-choice'), env({ command: 'session.display', display: 'tally' }));
    expectError(
      state,
      env({ command: 'session.display', display: 'pie' }, participant('p1')),
      'E_FORBIDDEN',
    );
    const again = applyCommand(state, env({ command: 'session.display', display: 'tally' }), 2000);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.revision).toBe(state.revision);
  });
});
