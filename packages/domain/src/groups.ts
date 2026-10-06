import type { SessionGroup, SessionState } from './types.js';

export function participantGroup(state: SessionState, participantId: string): SessionGroup | undefined {
  return Object.values(state.groups ?? {}).find((group) => !group.removed && group.memberIds.includes(participantId));
}

export function groupBallotKey(groupId: string): string {
  return `group:${groupId}`;
}

export function expectedAnswerCount(state: SessionState): number {
  const active = state.activeInteractionId;
  const question = state.outline.content.interactions.find((item) => item.id === active);
  if (question?.responseMode !== 'group') return Object.keys(state.participants).length;
  const seats = new Set(Object.values(state.groups ?? {}).filter((group) => !group.removed && group.memberIds.length).map((group) => groupBallotKey(group.id)));
  for (const key of Object.keys(active ? state.interactions[active]?.ballots ?? {} : {})) seats.add(key);
  return seats.size;
}

export function participantLabel(state: SessionState, participantId: string): string {
  return state.participants[participantId]?.handle ?? `Participant ${Object.keys(state.participants).indexOf(participantId) + 1}`;
}
