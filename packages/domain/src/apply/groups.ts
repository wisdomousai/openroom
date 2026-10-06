import type { ApplyResult, Command, SessionGroup, SessionState } from '../types.js';
import { commit, fail, noop } from './helpers.js';

/** Group membership grants no credentials: only a host can assign joined participants. */
export function applyGroupCommands(state: SessionState, command: Command): ApplyResult | undefined {
  if (command.command === 'group.remove') {
    if (typeof command.groupId !== 'string' || !Object.hasOwn(state.groups ?? {}, command.groupId)) return noop(state);
    const group = state.groups?.[command.groupId];
    if (!group || group.removed) return noop(state);
    return commit({ ...state, groups: { ...state.groups,
      [group.id]: { ...group, memberIds: [], spokespersonId: null, removed: true } } });
  }
  if (command.command !== 'group.set') return undefined;
  const group = command.group;
  if (!group || typeof group.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(group.id) ||
      typeof group.name !== 'string' || !group.name.trim() || group.name.trim().length > 80 ||
      !Array.isArray(group.memberIds) || group.memberIds.length > 500 ||
      group.memberIds.some((id) => typeof id !== 'string' || !Object.hasOwn(state.participants, id)) ||
      new Set(group.memberIds).size !== group.memberIds.length ||
      (group.spokespersonId !== null && !group.memberIds.includes(group.spokespersonId))) {
    return fail('E_INVALID_ANSWER', 'Choose a group name, joined participants, and a spokesperson from that group.');
  }
  const existing = Object.hasOwn(state.groups ?? {}, group.id) ? state.groups![group.id] : undefined;
  if (existing?.removed) return fail('E_INVALID_TRANSITION', 'Create a new group with a new id.');
  if (!existing && Object.keys(state.groups ?? {}).length >= 100) {
    return fail('E_INVALID_TRANSITION', 'This session already has 100 groups.');
  }
  const groups: Record<string, SessionGroup> = {};
  // Moving a member is atomic; a displaced spokesperson must be deliberately reassigned.
  for (const [id, previous] of Object.entries(state.groups ?? {})) {
    const memberIds = previous.memberIds.filter((member) => !group.memberIds.includes(member));
    groups[id] = { ...previous, memberIds,
      spokespersonId: previous.spokespersonId && memberIds.includes(previous.spokespersonId) ? previous.spokespersonId : null };
  }
  groups[group.id] = { id: group.id, name: group.name.trim(), memberIds: [...group.memberIds], spokespersonId: group.spokespersonId };
  return commit({ ...state, groups });
}
