import type { Interaction } from './types.js';
import { textAnswerMatches } from './text-match.js';
import type { HomeworkQuizType } from './homework.js';

export type HomeworkPracticeInteraction = Extract<Interaction, { type: HomeworkQuizType }>;
export type HomeworkPracticeAnswer =
  | { kind: 'choice'; optionIds: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'fill-the-gaps'; gaps: Record<string, string> }
  | { kind: 'match'; pairs: Record<string, string> }
  | { kind: 'ranking'; order: string[] };

export interface HomeworkAssessment {
  complete: boolean;
  result: 'correct' | 'incorrect' | 'self-check';
  answers: string[];
}

/** Narrow untrusted learner input before grading or retaining it. */
export function parseHomeworkPracticeAnswer(interaction: HomeworkPracticeInteraction, value: unknown): HomeworkPracticeAnswer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const strings = (input: unknown): input is string[] => Array.isArray(input) && input.length <= 100 && input.every((item) => typeof item === 'string' && item.length <= 100) && new Set(input).size === input.length;
  const pairs = (input: unknown, keys: string[], maxLength: number): input is Record<string, string> => Boolean(input && typeof input === 'object' && !Array.isArray(input) && Object.entries(input).every(([key, item]) => keys.includes(key) && typeof item === 'string' && item.length <= maxLength));
  let answer: HomeworkPracticeAnswer | null = null;
  if (interaction.type === 'choice' && row.kind === 'choice' && strings(row.optionIds)) answer = { kind: 'choice', optionIds: [...row.optionIds].sort() };
  if (interaction.type === 'text' && row.kind === 'text' && typeof row.text === 'string') answer = { kind: 'text', text: row.text };
  if (interaction.type === 'fill-the-gaps' && row.kind === 'fill-the-gaps' && pairs(row.gaps, interaction.gaps.map((gap) => gap.id), 200)) answer = { kind: 'fill-the-gaps', gaps: row.gaps };
  if (interaction.type === 'match' && row.kind === 'match' && pairs(row.pairs, interaction.left.map((left) => left.id), 100)) answer = { kind: 'match', pairs: row.pairs };
  if (interaction.type === 'ranking' && row.kind === 'ranking' && strings(row.order)) answer = { kind: 'ranking', order: row.order };
  return answer && JSON.stringify(answer).length <= 20_000 && assessHomework(interaction, answer).complete ? answer : null;
}

/** Practice is formative. An activity without a key invites self-reflection. */
export function assessHomework(interaction: HomeworkPracticeInteraction, answer: HomeworkPracticeAnswer): HomeworkAssessment {
  const incomplete: HomeworkAssessment = { complete: false, result: 'self-check', answers: [] };
  const result = (complete: boolean, correct: boolean | null, answers: string[]): HomeworkAssessment => ({ complete, result: correct === null ? 'self-check' : correct ? 'correct' : 'incorrect', answers });
  if (interaction.type === 'choice' && answer.kind === 'choice') {
    const selected = new Set(answer.optionIds);
    const complete = selected.size > 0 && (interaction.multiple === true || selected.size === 1) && [...selected].every((id) => interaction.options.some((option) => option.id === id));
    const correct = interaction.options.filter((option) => option.correct);
    return result(complete, correct.length === 0 ? null : complete && correct.length === selected.size && correct.every((option) => selected.has(option.id)), correct.map((option) => option.label));
  }
  if (interaction.type === 'text' && answer.kind === 'text') {
    const complete = answer.text.trim().length > 0 && answer.text.length <= (interaction.maxLength ?? 200);
    return result(complete, interaction.correctAnswers?.length ? complete && textAnswerMatches(answer.text, interaction.correctAnswers, interaction.match) : null, interaction.correctAnswers ?? []);
  }
  if (interaction.type === 'fill-the-gaps' && answer.kind === 'fill-the-gaps') {
    const complete = interaction.gaps.every((gap) => (answer.gaps[gap.id] ?? '').trim().length > 0);
    const correct = complete && interaction.gaps.every((gap) => textAnswerMatches(answer.gaps[gap.id] ?? '', gap.answers, interaction.match));
    return result(complete, correct, interaction.gaps.map((gap, index) => `${index + 1}. ${gap.answers.join(' / ')}`));
  }
  if (interaction.type === 'match' && answer.kind === 'match') {
    const complete = interaction.left.every((left) => interaction.right.some((right) => right.id === answer.pairs[left.id]));
    return result(complete, complete && interaction.left.every((left) => answer.pairs[left.id] === interaction.correct[left.id]), interaction.left.map((left) => `${left.label} — ${interaction.right.find((right) => right.id === interaction.correct[left.id])?.label ?? ''}`));
  }
  if (interaction.type === 'ranking' && answer.kind === 'ranking') {
    const complete = answer.order.length === interaction.options.length && new Set(answer.order).size === interaction.options.length && answer.order.every((id) => interaction.options.some((option) => option.id === id));
    return result(complete, interaction.correctOrder?.length ? complete && interaction.correctOrder.every((id, index) => answer.order[index] === id) : null, (interaction.correctOrder ?? []).map((id, index) => `${index + 1}. ${interaction.options.find((option) => option.id === id)?.label ?? ''}`));
  }
  return incomplete;
}

export function initialHomeworkAnswer(interaction: HomeworkPracticeInteraction): HomeworkPracticeAnswer {
  switch (interaction.type) {
    case 'choice': return { kind: 'choice', optionIds: [] };
    case 'text': return { kind: 'text', text: '' };
    case 'fill-the-gaps': return { kind: 'fill-the-gaps', gaps: {} };
    case 'match': return { kind: 'match', pairs: {} };
    case 'ranking': return { kind: 'ranking', order: interaction.options.map((option) => option.id) };
  }
}
