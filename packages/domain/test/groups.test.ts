import { describe, expect, it } from 'vitest';
import { createSession } from '../src/create-session.js';
import { applyCommand } from '../src/apply-command.js';
import { participantSnapshot, hostSnapshot, stageSnapshot } from '../src/snapshots.js';
import { purgeBallots } from '../src/purge.js';
import type { Command, SessionState } from '../src/types.js';
import { WORKSHOP_SEQUENCES } from '@openroom/schema';

function send(state: SessionState, command: Command, participantId?: string) {
  return applyCommand(state, { idempotencyKey: 'test', command,
    actor: participantId ? { role: 'participant', participantId } : { role: 'host', facilitatorId: 'creator' } }, 100);
}
function ok(state: SessionState, command: Command, participantId?: string) {
  const result = send(state, command, participantId);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.state;
}
const answer = (id = 'team', text = 'Choose a small pilot', groupId = id === 'team' ? 'north' : undefined): Command => ({ command: 'answer.submit', interactionId: id, answer: { kind: 'text', text }, ...(groupId ? { groupId } : {}) });
const group = (spokespersonId: string | null = 'p1', name = 'North'): Command => ({ command: 'group.set', group: { id: 'north', name, memberIds: ['p1', 'p2'], spokespersonId } });
function setup() {
  let state = createSession({ version: 1, meta: { title: 'Workshop' },
    defaults: { resultVisibility: 'hidden-until-close' }, interactions: [
      { id: 'team', type: 'text', prompt: 'Your decision?', responseMode: 'group' },
      { id: 'solo', type: 'text', prompt: 'Your next step?' },
    ] }, 'ABC123', 0);
  state.participants = { p1: { joinedAt: 1, handle: 'Ada' }, p2: { joinedAt: 2, handle: 'Ben' }, p3: { joinedAt: 3, handle: 'Cleo' } };
  state = ok(state, group());
  state = ok(state, { command: 'session.start' });
  return ok(state, { command: 'interaction.open', interactionId: 'team' });
}

describe('session-local group responses', () => {
  it('keeps the workshop first vote hidden during discussion and compares both rounds after reveal', () => {
    const sequence = WORKSHOP_SEQUENCES.find((item) => item.id === 'think-discuss-revote')!;
    let state = createSession({ version: 1, meta: { title: sequence.name }, steps: sequence.steps, interactions: sequence.interactions }, 'ABC123', 0);
    state = ok(state, { command: 'session.start' });
    state = ok(state, { command: 'outline.goto', stepId: 'decision' });
    state = ok(state, { command: 'answer.submit', interactionId: 'decision', answer: { kind: 'choice', optionIds: ['promise'] } }, 'p1');
    state = ok(state, { command: 'interaction.close', interactionId: 'decision' });
    expect(stageSnapshot(state).aggregate).toBeNull();
    expect(participantSnapshot(state, 'p1').results).toBeNull();
    state = ok(state, { command: 'interaction.revote', interactionId: 'decision' });
    expect(participantSnapshot(state, 'p1').ownRound1Answer).toEqual({ kind: 'choice', optionIds: ['promise'] });
    state = ok(state, { command: 'answer.submit', interactionId: 'decision', answer: { kind: 'choice', optionIds: ['tradeoffs'] } }, 'p1');
    state = ok(state, { command: 'interaction.close', interactionId: 'decision' });
    state = ok(state, { command: 'interaction.reveal', interactionId: 'decision' });
    expect(stageSnapshot(state)).toMatchObject({ aggregate: { counts: { promise: 0, tradeoffs: 1 } }, round1Aggregate: { counts: { promise: 1, tradeoffs: 0 } } });
  });
  it('requires a host for assignment, joined members and an explicitly selected member spokesperson', () => {
    const state = setup();
    expect(send(state, group(), 'p1')).toMatchObject({ ok: false, error: { code: 'E_FORBIDDEN' } });
    for (const invalid of [null, {}, { id: 'north', name: 'North', memberIds: ['unknown'], spokespersonId: null },
      { id: 'north', name: 'North', memberIds: ['p1'], spokespersonId: 'p3' },
      { id: 'north', name: 'North', memberIds: ['p1', 'p1'], spokespersonId: 'p1' }]) {
      expect(send(state, { command: 'group.set', group: invalid } as Command)).toMatchObject({ ok: false });
    }
    expect(send(ok(state, group(null)), answer(), 'p1')).toMatchObject({ ok: false });
  });

  it('shares only the own-group answer before reveal and rejects forged member or outsider votes', () => {
    const original = setup();
    for (const id of ['p2', 'p3']) expect(send(original, answer(), id)).toMatchObject({ ok: false, error: { code: 'E_FORBIDDEN' } });
    const state = ok(original, answer(), 'p1');
    expect(state.interactions.team!.ballots).toEqual({ 'group:north': { kind: 'text', text: 'Choose a small pilot', hidden: false } });
    for (const id of ['p1', 'p2']) {
      const view = participantSnapshot(state, id);
      expect(view.yourAnswer).toMatchObject({ text: 'Choose a small pilot' });
      expect(view.results).toBeNull();
      expect(view.yourGroup).toEqual({ id: 'north', name: 'North', isSpokesperson: id === 'p1' });
    }
    expect(participantSnapshot(state, 'p3')).toMatchObject({ answered: false, yourAnswer: null, results: null });
    expect(stageSnapshot(state)).toMatchObject({ aggregate: null, answeredCount: 1, participantCount: 3, expectedAnswerCount: 1 });
  });

  it('hands off the same ballot and preserves the recorded group label after a rename', () => {
    let state = ok(setup(), answer(), 'p1');
    state = ok(state, group('p2', 'East'));
    expect(send(state, answer(), 'p1')).toMatchObject({ ok: false });
    state = ok(state, answer('team', 'Test with volunteers'), 'p2');
    expect(state.interactions.team!.aggregate.total).toBe(1);
    expect(hostSnapshot(state).responseNames).toEqual({ 'group:north': 'North' });
    expect(participantSnapshot(state, 'p1').yourAnswer).toMatchObject({ text: 'Test with volunteers' });
    expect(JSON.stringify(state)).not.toContain('Choose a small pilot');
  });

  it('keeps individual questions independent, even for members of the same group', () => {
    let state = ok(setup(), { command: 'interaction.open', interactionId: 'solo' });
    state = ok(state, answer('solo', 'Call a colleague'), 'p1');
    state = ok(state, answer('solo', 'Read the report'), 'p2');
    expect(state.interactions.solo!.aggregate.total).toBe(2);
    expect(participantSnapshot(state, 'p1').yourAnswer).toMatchObject({ text: 'Call a colleague' });
    expect(participantSnapshot(state, 'p2').yourAnswer).toMatchObject({ text: 'Read the report' });
    expect(stageSnapshot(state).expectedAnswerCount).toBe(3);
  });

  it('moves a spokesperson atomically, keeps old ballots and prevents dissolved id reuse', () => {
    let state = ok(setup(), answer(), 'p1');
    state = ok(state, { command: 'group.set', group: { id: 'south', name: 'South', memberIds: ['p1', 'p3'], spokespersonId: 'p1' } });
    expect(state.groups!.north).toMatchObject({ memberIds: ['p2'], spokespersonId: null });
    expect(participantSnapshot(state, 'p1').yourAnswer).toBeNull();
    expect(send(state, answer(), 'p1')).toMatchObject({ ok: false }); // in-flight answer for the previous group
    state = ok(state, answer('team', 'Compare two pilots', 'south'), 'p1');
    state = ok(state, { command: 'group.remove', groupId: 'north' });
    expect(state.interactions.team!.aggregate.total).toBe(2);
    expect(stageSnapshot(state).expectedAnswerCount).toBe(2);
    expect(participantSnapshot(state, 'p2').yourAnswer).toBeNull();
    expect(send(state, group())).toMatchObject({ ok: false });
    expect(hostSnapshot(state).groups.map((g) => g.id)).toEqual(['south']);
  });

  it('honors answer-change, revision, freeze and end gates; purge removes group membership and names', () => {
    let state = setup();
    state.outline.content.interactions[0]!.allowAnswerChange = false;
    state = ok(state, answer(), 'p1');
    state = ok(state, group('p2'));
    expect(send(state, answer(), 'p2')).toMatchObject({ ok: false });
    expect(applyCommand(state, { idempotencyKey: 'stale', command: group(), actor: { role: 'host', facilitatorId: 'creator' }, expectedRevision: 0 }, 200)).toMatchObject({ ok: false, error: { code: 'E_REVISION_CONFLICT' } });
    state = ok(state, { command: 'session.freeze' });
    expect(send(state, answer(), 'p2')).toMatchObject({ ok: false, error: { code: 'E_FROZEN' } });
    state = ok(state, { command: 'session.end' });
    expect(send(state, group())).toMatchObject({ ok: false, error: { code: 'E_ENDED' } });
    const purged = purgeBallots(state, 1000);
    expect(purged.groups).toEqual({});
    expect(purged.interactions.team!.groupNames).toBeUndefined();
    expect(purged.interactions.team!.aggregate).toMatchObject({ total: 1, entries: [{ participantId: 'purged-1' }] });
  });
});
