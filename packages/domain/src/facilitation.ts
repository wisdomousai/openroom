import type { ApplyResult, Command, SessionFacilitator, SessionState } from './types.js';
import { commit, fail, noop } from './apply/helpers.js';

/** The control plane verifies current account/space access before registering a seat. */
export function registerFacilitator(state: SessionState, facilitator: SessionFacilitator): ApplyResult {
  if (state.status === 'ended') return fail('E_ENDED', 'The session has ended.');
  if (!facilitator || typeof facilitator.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(facilitator.id) ||
      typeof facilitator.name !== 'string' || !facilitator.name.trim() || facilitator.name.length > 200 ||
      typeof facilitator.canRecover !== 'boolean') return fail('E_INVALID_ANSWER', 'Invalid facilitator.');
  const existing = Object.hasOwn(state.facilitation.facilitators, facilitator.id) ? state.facilitation.facilitators[facilitator.id] : undefined;
  if (!existing && Object.keys(state.facilitation.facilitators).length >= 50) return fail('E_FORBIDDEN', 'This session already has 50 facilitators.');
  const next = { id: facilitator.id, name: facilitator.name.trim(), canRecover: facilitator.canRecover };
  if (existing?.name === next.name && existing.canRecover === next.canRecover) return noop(state);
  return commit({ ...state, facilitation: { ...state.facilitation, facilitators: { ...state.facilitation.facilitators, [next.id]: next } } });
}

/** Co-facilitators may moderate and organize groups without changing what is presented. */
export const MODERATOR_COMMANDS: ReadonlySet<Command['command']> = new Set([
  'text.hide', 'text.unhide', 'qna.hide', 'qna.unhide', 'group.set', 'group.remove',
]);

export function facilitatorCanCommand(state: SessionState, facilitatorId: string, command: Command): boolean {
  const facilitator = Object.hasOwn(state.facilitation.facilitators, facilitatorId) ? state.facilitation.facilitators[facilitatorId] : undefined;
  if (!facilitator) return false;
  if (command.command === 'presentation.recover') return facilitator.canRecover;
  return state.facilitation.presenterId === facilitatorId || MODERATOR_COMMANDS.has(command.command);
}

export function applyFacilitationCommand(state: SessionState, command: Command, facilitatorId: string): ApplyResult | undefined {
  if (command.command !== 'presentation.handoff' && command.command !== 'presentation.recover') return undefined;
  const nextId = command.command === 'presentation.handoff' ? command.facilitatorId : facilitatorId;
  if (typeof nextId !== 'string' || !Object.hasOwn(state.facilitation.facilitators, nextId)) {
    return fail('E_FORBIDDEN', 'Choose a facilitator who has joined this session.');
  }
  if (nextId === state.facilitation.presenterId) return noop(state);
  return commit({ ...state, facilitation: { ...state.facilitation, presenterId: nextId } });
}
