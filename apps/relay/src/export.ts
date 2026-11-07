/**
 * Host-only session exports.
 *
 * `json` and aggregate `csv` are the free teaching files (counts).
 * `answers` is the per-person file — gated by `rawExport` or a guest-list session.
 */

import {
  ensureQna,
  sessionOf,
  sortedQuestions,
  type Aggregate,
  type Answer,
  type SessionState,
} from '@openroom/domain';
import { resolveRevealOrder } from '@openroom/schema';
import { savedResults } from './saved-results.js';

export type ExportFormat = 'json' | 'csv' | 'answers';

/** No format means csv; any other unknown value is refused rather than guessed. */
export function parseExportFormat(raw: string | null): ExportFormat | null {
  if (raw === null || raw === '' || raw === 'csv') return 'csv';
  if (raw === 'json' || raw === 'answers') return raw;
  return null;
}

function answerText(answer: Answer): string {
  switch (answer.kind) {
    case 'choice':
      return answer.optionIds.join('|');
    case 'scale':
    case 'numeric':
      return String(answer.value);
    case 'text':
    case 'qna':
      return answer.text;
    case 'ranking':
      // Best first; the separator matches the CSV's existing multi-value style.
      return answer.optionIds.join('|');
    case 'fill-the-gaps':
      return Object.entries(answer.gaps)
        .map(([id, text]) => `${id}=${text}`)
        .join('|');
    case 'match':
      return Object.entries(answer.pairs)
        .map(([left, right]) => `${left}=${right}`)
        .join('|');
    case 'dont-know':
      return "I don't know";
    default: {
      const never: never = answer;
      return String(never);
    }
  }
}

function csvCell(value: string): string {
  // Escape quotes, and defuse spreadsheet formula injection on user text.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function exportAggregateCsv(input: SessionState): string {
  const state = ensureQna(input);
  const lines = ['interactionId,prompt,type,status,total,summary'];
  for (const interaction of sessionOf(state).interactions) {
    const runtime = state.interactions[interaction.id];
    const aggregate = runtime?.aggregate ?? null;
    lines.push(
      [
        csvCell(interaction.id),
        csvCell(interaction.prompt),
        csvCell(interaction.type),
        csvCell(runtime?.status ?? 'pending'),
        csvCell(String(aggregate?.total ?? 0)),
        csvCell(aggregateSummary(aggregate)),
      ].join(','),
    );
  }
  if (state.qna.enabled) {
    const questions = sortedQuestions(state.qna);
    lines.push(
      [
        csvCell('session-qna'),
        csvCell('Audience Q&A'),
        csvCell('qna'),
        csvCell(state.status),
        csvCell(String(questions.length)),
        csvCell(''),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Per-answer CSV. Prefer the name `exportAnswersCsv` at call sites. */
export function exportAnswersCsv(input: SessionState): string {
  const state = ensureQna(input);
  // Nickname sessions carry a session-local name per participant; identified
  // sessions carry the student display name in the same slot. Anonymous sessions keep
  // the original 5-column contract.
  const withNames = sessionOf(state).defaults.identityMode !== 'anonymous' || sessionOf(state).interactions.some((item) => item.responseMode === 'group');
  const lines = [
    withNames
      ? 'interactionId,prompt,participantId,name,answer,hidden'
      : 'interactionId,prompt,participantId,answer,hidden',
  ];
  for (const interaction of sessionOf(state).interactions) {
    const runtime = state.interactions[interaction.id];
    if (runtime === undefined) continue;
    for (const [participantId, answer] of Object.entries(runtime.answers)) {
      const hidden =
        (answer.kind === 'text' || answer.kind === 'qna') && answer.hidden ? 'true' : 'false';
      lines.push(
        [
          csvCell(interaction.id),
          csvCell(interaction.prompt),
          csvCell(participantId),
          ...(withNames ? [csvCell(runtime.groupNames?.[participantId] ?? state.participants[participantId]?.name ?? '')] : []),
          csvCell(answerText(answer)),
          hidden,
        ].join(','),
      );
    }
  }
  // Session Q&A rides the same 5/6-column contract under a reserved id; the
  // vote count is folded into the answer column to keep the header stable.
  for (const question of sortedQuestions(state.qna)) {
    lines.push(
      [
        csvCell('session-qna'),
        csvCell('Audience Q&A'),
        csvCell(question.participantId),
        ...(withNames
          ? [csvCell(state.participants[question.participantId]?.name ?? '')]
          : []),
        csvCell(`${question.text} (${String(question.votes)} votes)`),
        question.hidden ? 'true' : 'false',
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function aggregateSummary(aggregate: Aggregate | null): string {
  if (aggregate === null) return '';
  switch (aggregate.kind) {
    case 'choice':
    case 'scale':
      return Object.entries(aggregate.counts)
        .map(([key, count]) => `${key}:${count}`)
        .join('|');
    case 'numeric':
      return aggregate.mean === null ? '' : `mean=${String(aggregate.mean)}`;
    case 'text':
    case 'qna':
    case 'fill-the-gaps':
    case 'match':
      return `${String(aggregate.total)} entries`;
    case 'ranking':
      return Object.entries(aggregate.scores)
        .map(([key, score]) => `${key}:${score}`)
        .join('|');
    default: {
      const never: never = aggregate;
      return String(never);
    }
  }
}

/**
 * Which slide the room is on and how much of it is revealed. `shownGroups`
 * equals `revealGroups` when the whole step is showing.
 */
function outlinePosition(state: SessionState) {
  const { content, currentStepIndex, shownGroups } = state.outline;
  const step = content.steps[currentStepIndex];
  if (step === undefined) return undefined;
  const revealGroups = resolveRevealOrder(step, content.interactions).length;
  return {
    stepId: step.id,
    stepIndex: currentStepIndex,
    stepCount: content.steps.length,
    kind: step.kind,
    shownGroups: shownGroups ?? revealGroups,
    revealGroups,
  };
}

export function exportJson(input: SessionState): unknown {
  const state = ensureQna(input);
  const position = outlinePosition(state);
  return {
    ...(state.qna.enabled
      ? {
          qna: {
            enabled: true,
            questions: sortedQuestions(state.qna).map((question) => ({
              id: question.id,
              participantId: question.participantId,
              text: question.text,
              votes: question.votes,
              hidden: question.hidden,
              createdAt: question.createdAt,
            })),
          },
        }
      : {}),
    sessionCode: state.code,
    summary: savedResults(state),
    code: state.code,
    status: state.status,
    revision: state.revision,
    meta: sessionOf(state).meta,
    participantCount: Object.keys(state.participants).length,
    ...(position === undefined ? {} : { position }),
    ...(state.endedAt === undefined ? {} : { endedAt: state.endedAt }),
    interactions: sessionOf(state).interactions.map((interaction) => {
      const runtime = state.interactions[interaction.id];
      return {
        id: interaction.id,
        prompt: interaction.prompt,
        type: interaction.type,
        status: runtime?.status ?? 'pending',
        aggregate: runtime?.aggregate ?? null,
        responseMode: interaction.responseMode ?? 'individual',
      };
    }),
  };
}
