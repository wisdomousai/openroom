import { describe, expect, it } from 'vitest';
import { applyCommand, createSession, registerFacilitator, type Command, type SessionState } from '../src/index.js';
import { fixtureSpec } from './helpers.js';

function apply(state: SessionState, id: string, command: Command) {
  return applyCommand(state, { actor: { role: 'host', facilitatorId: id }, idempotencyKey: crypto.randomUUID(), command }, 1000);
}

describe('facilitator authority', () => {
  it('retains the presentation and answers through handoff, restricts helpers and allows creator recovery', () => {
    let state = createSession(fixtureSpec, '123456', 1);
    const registered = registerFacilitator(state, { id: 'helper', name: 'Helper', canRecover: false });
    if (!registered.ok) throw new Error('Registration failed');
    state = registered.state;
    expect(state.facilitation.presenterId).toBe('creator');
    expect(apply(state, 'helper', { command: 'session.start' })).toMatchObject({ ok: false, error: { code: 'E_FORBIDDEN' } });
    const started = apply(state, 'creator', { command: 'session.start' });
    if (!started.ok) throw new Error('Start failed');
    state = started.state;
    const handed = apply(state, 'creator', { command: 'presentation.handoff', facilitatorId: 'helper' });
    if (!handed.ok) throw new Error('Handoff failed');
    expect(handed.state.outline).toEqual(state.outline);
    expect(handed.state.interactions).toEqual(state.interactions);
    expect(handed.state.facilitation.presenterId).toBe('helper');
    expect(apply(handed.state, 'creator', { command: 'outline.next' })).toMatchObject({ ok: false, error: { code: 'E_FORBIDDEN' } });
    expect(apply(handed.state, 'helper', { command: 'presentation.recover' })).toMatchObject({ ok: false, error: { code: 'E_FORBIDDEN' } });
    const recovered = apply(handed.state, 'creator', { command: 'presentation.recover' });
    expect(recovered).toMatchObject({ ok: true, state: { facilitation: { presenterId: 'creator' } } });
  });

  it('rejects unregistered and participant impersonation, but permits helper group management', () => {
    const initial = createSession(fixtureSpec, '654321', 1);
    const registered = registerFacilitator(initial, { id: 'helper', name: 'Helper', canRecover: false });
    if (!registered.ok) throw new Error('Registration failed');
    const state = registered.state;
    expect(apply(state, 'absent', { command: 'group.remove', groupId: 'g' })).toMatchObject({ ok: false, error: { code: 'E_FORBIDDEN' } });
    expect(apply(state, 'creator', { command: 'presentation.handoff', facilitatorId: 'absent' })).toMatchObject({ ok: false, error: { code: 'E_FORBIDDEN' } });
    expect(apply(state, 'helper', { command: 'group.set', group: { id: 'g', name: 'Team', memberIds: [], spokespersonId: null } })).toMatchObject({ ok: true });
    expect(applyCommand(state, { actor: { role: 'participant', facilitatorId: 'creator' }, idempotencyKey: 'forged', command: { command: 'presentation.recover' } }, 1000)).toMatchObject({ ok: false, error: { code: 'E_FORBIDDEN' } });
  });
});
