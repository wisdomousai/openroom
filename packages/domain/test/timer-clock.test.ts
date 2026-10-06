import type { Outline } from '@openroom/schema';
import { describe, expect, it } from 'vitest';

import { applyCommand } from '../src/apply-command.js';
import { createSession } from '../src/create-session.js';
import { hostSnapshot, participantSnapshot, stageSnapshot } from '../src/snapshots.js';
import { env, expectError, fixtureSpec, participant, run } from './helpers.js';

const outline: Outline = {
  version: 1,
  meta: { title: 'Clock outline' },
  steps: [
    { id: 'think', kind: 'timer', title: 'Think', seconds: 120, persist: true },
    { id: 'note', kind: 'title', title: 'Next' },
    { id: 'ephemeral', kind: 'timer', title: 'Flash', seconds: 30, persist: false },
  ],
  interactions: fixtureSpec.interactions,
};

function clockRoom() {
  return createSession(outline, 'CLOCK0001', 0, { outlineVersion: 1 });
}

function liveClockRoom() {
  return run(clockRoom(), env({ command: 'session.start' }));
}

describe('timer.* clock', () => {
  it('does not start when landing on a timer slide', () => {
    const state = liveClockRoom();
    expect(state.outline?.currentStepIndex).toBe(0);
    expect(state.clock).toBeUndefined();
  });

  it('starts from the authored duration and never rewrites the outline', () => {
    const now = 10_000;
    const state = run(liveClockRoom(), env({ command: 'timer.start' }), now);
    expect(state.clock).toEqual({
      stepId: 'think',
      authoredSec: 120,
      remainingSecAt: now,
      remainingSec: 120,
      running: true,
      placement: 'slide',
    });
    expect(state.outline?.content.steps[0]).toMatchObject({ id: 'think', seconds: 120 });
  });

  it('pauses at the remaining-at-timestamp value', () => {
    const now = 20_000;
    let state = run(liveClockRoom(), env({ command: 'timer.start' }), now);
    state = run(state, env({ command: 'timer.pause' }), now + 15_000);
    expect(state.clock?.running).toBe(false);
    expect(state.clock?.remainingSec).toBe(105);
    expect(state.clock?.remainingSecAt).toBe(now + 15_000);
  });

  it('reset returns to authored duration, stopped', () => {
    const now = 30_000;
    let state = run(liveClockRoom(), env({ command: 'timer.start' }), now);
    state = run(state, env({ command: 'timer.adjust', seconds: -20 }), now + 1_000);
    state = run(state, env({ command: 'timer.reset' }), now + 2_000);
    expect(state.clock).toMatchObject({
      authoredSec: 120,
      remainingSec: 120,
      running: false,
    });
    expect((state.outline?.content.steps[0] as { seconds: number }).seconds).toBe(120);
  });

  it('adjust applies a signed seconds delta', () => {
    const now = 40_000;
    let state = run(liveClockRoom(), env({ command: 'timer.start' }), now);
    state = run(state, env({ command: 'timer.adjust', seconds: 60 }), now + 5_000);
    expect(state.clock?.remainingSec).toBe(175);
    state = run(state, env({ command: 'timer.adjust', seconds: -10 }), now + 5_000);
    expect(state.clock?.remainingSec).toBe(165);
  });

  it('survives navigation when persist is true, flipping to the corner', () => {
    const now = 50_000;
    let state = run(liveClockRoom(), env({ command: 'timer.start' }), now);
    state = run(state, env({ command: 'outline.next' }), now + 10_000);
    expect(state.outline?.currentStepIndex).toBe(1);
    expect(state.clock).toMatchObject({
      stepId: 'think',
      running: true,
      placement: 'corner',
      remainingSec: 110,
    });
  });

  it('drops the clock when persist is false and the teacher leaves', () => {
    let state = liveClockRoom();
    state = run(state, env({ command: 'outline.goto', stepId: 'ephemeral' }));
    state = run(state, env({ command: 'timer.start' }), 60_000);
    expect(state.clock?.stepId).toBe('ephemeral');
    state = run(state, env({ command: 'outline.goto', stepId: 'note' }), 61_000);
    expect(state.clock).toBeUndefined();
  });

  it('projects the clock onto host, stage, and participant snapshots', () => {
    const state = run(liveClockRoom(), env({ command: 'timer.start' }), 70_000);
    expect(hostSnapshot(state).clock?.stepId).toBe('think');
    expect(stageSnapshot(state).clock?.running).toBe(true);
    expect(participantSnapshot(state, 'p1').clock?.authoredSec).toBe(120);
  });

  it('is host-only and a no-op when already running', () => {
    const state = run(liveClockRoom(), env({ command: 'timer.start' }), 80_000);
    expectError(state, env({ command: 'timer.start' }, participant('p1')), 'E_FORBIDDEN');
    const again = applyCommand(state, env({ command: 'timer.start' }), 81_000);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.revision).toBe(state.revision);
    expect(again.effects).toEqual([]);
  });
});
