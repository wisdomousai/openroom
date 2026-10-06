/**
 * Optional countdown timer. Session `timerSec` arms `closesAt` on open as an
 * advisory window. Zero never closes answering; the teacher closes.
 */
import { describe, expect, it } from 'vitest';

import { applyCommand } from '../src/apply-command.js';
import { hostSnapshot, participantSnapshot, stageSnapshot } from '../src/snapshots.js';
import { env, liveSession, sessionWithOpen, run } from './helpers.js';

describe('optional countdown timer (timerSec → closesAt)', () => {
  it('arms closesAt from timerSec on interaction.open', () => {
    const now = 1_000_000;
    let state = liveSession({
      version: 1,
      meta: { title: 'Timer' },
      interactions: [
        {
          id: 'timed',
          type: 'choice',
          prompt: 'Quick poll',
          timerSec: 30,
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
      ],
    });
    state = run(state, env({ command: 'interaction.open', interactionId: 'timed' }), now);
    expect(state.interactions.timed?.closesAt).toBe(now + 30_000);
    expect(state.interactions.timed?.openedAt).toBe(now);
  });

  it('does not arm closesAt when timerSec is omitted', () => {
    const state = sessionWithOpen('mood');
    expect(state.interactions.mood?.closesAt).toBeUndefined();
  });

  it('clears closesAt on interaction.close', () => {
    const now = 2_000_000;
    let state = liveSession({
      version: 1,
      meta: { title: 'Timer' },
      interactions: [
        {
          id: 'timed',
          type: 'scale',
          prompt: 'Rate',
          min: 1,
          max: 5,
          timerSec: 60,
        },
      ],
    });
    state = run(state, env({ command: 'interaction.open', interactionId: 'timed' }), now);
    expect(state.interactions.timed?.closesAt).toBeDefined();
    state = run(state, env({ command: 'interaction.close', interactionId: 'timed' }), now + 5_000);
    expect(state.interactions.timed?.closesAt).toBeUndefined();
    expect(state.interactions.timed?.status).toBe('closed');
  });

  it('arms a fresh closesAt on session.advance', () => {
    const now = 3_000_000;
    let state = liveSession({
      version: 1,
      meta: { title: 'Advance timer' },
      interactions: [
        { id: 'first', type: 'qna', prompt: 'Ask' },
        {
          id: 'second',
          type: 'choice',
          prompt: 'Timed',
          timerSec: 15,
          options: [
            { id: 'y', label: 'Yes' },
            { id: 'n', label: 'No' },
          ],
        },
      ],
    });
    state = run(state, env({ command: 'session.advance' }), now);
    expect(state.activeInteractionId).toBe('first');
    expect(state.interactions.first?.closesAt).toBeUndefined();
    state = run(state, env({ command: 'session.advance' }), now + 1_000);
    expect(state.activeInteractionId).toBe('second');
    expect(state.interactions.second?.closesAt).toBe(now + 1_000 + 15_000);
  });

  it('exposes closesAt on host, stage, and participant snapshots while open', () => {
    const now = 4_000_000;
    let state = liveSession({
      version: 1,
      meta: { title: 'Snap' },
      interactions: [
        {
          id: 'timed',
          type: 'text',
          prompt: 'Say something',
          timerSec: 45,
        },
      ],
    });
    state = run(state, env({ command: 'interaction.open', interactionId: 'timed' }), now);
    const closesAt = now + 45_000;

    const host = hostSnapshot(state);
    expect(host.interactions.find((i) => i.id === 'timed')?.closesAt).toBe(closesAt);

    const stage = stageSnapshot(state);
    expect(stage.closesAt).toBe(closesAt);

    const participant = participantSnapshot(state, 'p1');
    expect(participant.closesAt).toBe(closesAt);

    state = run(state, env({ command: 'interaction.close', interactionId: 'timed' }), now + 1);
    expect(stageSnapshot(state).closesAt).toBeUndefined();
    expect(participantSnapshot(state, 'p1').closesAt).toBeUndefined();
  });

  it('re-arms closesAt on peer-instruction revote', () => {
    const now = 5_000_000;
    let state = liveSession({
      version: 1,
      meta: { title: 'PI timer' },
      interactions: [
        {
          id: 'pi',
          type: 'choice',
          prompt: 'Peer',
          peerInstruction: true,
          timerSec: 20,
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
      ],
    });
    state = run(state, env({ command: 'interaction.open', interactionId: 'pi' }), now);
    expect(state.interactions.pi?.closesAt).toBe(now + 20_000);
    state = run(state, env({ command: 'interaction.close', interactionId: 'pi' }), now + 10_000);
    expect(state.interactions.pi?.closesAt).toBeUndefined();
    state = run(state, env({ command: 'interaction.revote', interactionId: 'pi' }), now + 20_000);
    expect(state.interactions.pi?.status).toBe('open');
    expect(state.interactions.pi?.round).toBe(2);
    expect(state.interactions.pi?.closesAt).toBe(now + 20_000 + 20_000);
  });
});

describe('timerSec does not affect applyCommand without a timer', () => {
  it('manual close still works on untimed interactions', () => {
    let state = sessionWithOpen('mood');
    const result = applyCommand(
      state,
      env({ command: 'interaction.close', interactionId: 'mood' }),
      Date.now(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.interactions.mood?.status).toBe('closed');
      expect(result.state.interactions.mood?.closesAt).toBeUndefined();
    }
  });
});
