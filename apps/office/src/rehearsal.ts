import { applyCommand, createSession, stageWireSnapshot, type Command, type SessionState, type AnswerInput } from '@openroom/domain';
import { resolveRevealOrder, type Interaction, type Outline } from '@openroom/schema';
import type { StageSnapshot } from '@openroom/sdk';

/** Pure local state. These commands never use an API or a real participant identity. */
export function rehearse(outline: Outline, stepId: string, now = Date.now()): SessionState {
  const step = outline.steps.find((item) => item.id === stepId);
  if (!step) throw new Error('Choose a saved OpenRoom slide before rehearsing.');
  const content = structuredClone(outline);
  // A detail slide embedded on its own is a normal top-level slide here.
  delete content.steps.find((item) => item.id === stepId)!.breakoutOf;
  return rehearsalCommand(createSession(content, 'REHEARSAL', now), { command: 'session.start', cursor: { stepId, shown: resolveRevealOrder(step, outline.interactions).length } }, now);
}

export function rehearsalCommand(state: SessionState, command: Command, now = Date.now()): SessionState {
  const result = applyCommand(state, { idempotencyKey: 'local-rehearsal', actor: { role: 'host', facilitatorId: state.facilitation.presenterId }, command }, now);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

function sampleAnswer(interaction: Interaction, index: number): AnswerInput {
  switch (interaction.type) {
    case 'choice': return { kind: 'choice', optionIds: [interaction.options[index % interaction.options.length]!.id] };
    case 'scale': return { kind: 'scale', value: interaction.min + index % (interaction.max - interaction.min + 1) };
    case 'numeric': return { kind: 'numeric', value: 10 + index * 5 };
    case 'text': return { kind: 'text', text: `Sample response ${index + 1}`.slice(0, interaction.maxLength ?? 300) };
    case 'qna': return { kind: 'qna', text: `Sample question ${index + 1}` };
    case 'ranking': return { kind: 'ranking', optionIds: [...interaction.options.slice(index % interaction.options.length), ...interaction.options.slice(0, index % interaction.options.length)].map((item) => item.id) };
    case 'fill-the-gaps': return { kind: 'fill-the-gaps', gaps: Object.fromEntries(interaction.gaps.map((gap) => [gap.id, index % 2 === 0 ? gap.answers[0]! : 'sample'])) };
    case 'match': return { kind: 'match', pairs: Object.fromEntries(interaction.left.map((item, i) => [item.id, interaction.right[(i + index) % interaction.right.length]!.id])) };
  }
}

export function addRehearsalAnswers(input: SessionState, now = Date.now()): SessionState {
  const interaction = input.outline.content.interactions.find((item) => item.id === input.activeInteractionId);
  if (!interaction) return input;
  let state = input;
  for (let index = 0; index < 3; index++) {
    const participantId = `rehearsal-${index}`;
    state = { ...state, participants: { ...state.participants, [participantId]: { joinedAt: now } } };
    if (interaction.responseMode === 'group') state = rehearsalCommand(state, { command: 'group.set', group: { id: `sample-${index}`, name: `Sample group ${index + 1}`, memberIds: [participantId], spokespersonId: participantId } }, now);
    const result = applyCommand(state, { idempotencyKey: `sample-${index}`, actor: { role: 'participant', participantId }, command: { command: 'answer.submit', interactionId: interaction.id, answer: sampleAnswer(interaction, index), ...(interaction.responseMode === 'group' ? { groupId: `sample-${index}` } : {}) } }, now);
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  }
  return state;
}

/** Always project through the audience allowlist, including before results are revealed. */
export function rehearsalSnapshot(state: SessionState): StageSnapshot {
  return stageWireSnapshot(state) as unknown as StageSnapshot;
}
