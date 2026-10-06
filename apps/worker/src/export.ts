/**
 * Host-only session exports.
 *
 * `json` and aggregate `csv` are the free teaching files (counts).
 * `ballots` is the per-person file — gated by `rawExport` or a roster session.
 */

import {
  ensureQna,
  sessionOf,
  sortedQuestions,
  type Aggregate,
  type Ballot,
  type SessionState,
} from '@openroom/domain';
import { savedResults } from './saved-results.js';

export type ExportFormat = 'json' | 'csv' | 'ballots';

export function parseExportFormat(raw: string | null): ExportFormat {
  if (raw === 'json' || raw === 'ballots') return raw;
  return 'csv';
}

function answerText(ballot: Ballot): string {
  switch (ballot.kind) {
    case 'choice':
      return ballot.optionIds.join('|');
    case 'scale':
    case 'numeric':
      return String(ballot.value);
    case 'text':
    case 'qna':
      return ballot.text;
    case 'ranking':
      // Best first; the separator matches the CSV's existing multi-value style.
      return ballot.optionIds.join('|');
    case 'fill-the-gaps':
      return Object.entries(ballot.gaps)
        .map(([id, text]) => `${id}=${text}`)
        .join('|');
    case 'match':
      return Object.entries(ballot.pairs)
        .map(([left, right]) => `${left}=${right}`)
        .join('|');
    case 'dont-know':
      return "I don't know";
    default: {
      const never: never = ballot;
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

/** Per-ballot CSV. Prefer the name `exportBallotsCsv` at call sites. */
export function exportBallotsCsv(input: SessionState): string {
  const state = ensureQna(input);
  // Pseudonymous sessions carry a session-local handle per participant; identified
  // sessions carry the context display name in the same slot. Anonymous sessions keep
  // the original 5-column contract.
  const withHandles = sessionOf(state).defaults.identityMode !== 'anonymous' || sessionOf(state).interactions.some((item) => item.responseMode === 'group');
  const lines = [
    withHandles
      ? 'interactionId,prompt,participantId,handle,answer,hidden'
      : 'interactionId,prompt,participantId,answer,hidden',
  ];
  for (const interaction of sessionOf(state).interactions) {
    const runtime = state.interactions[interaction.id];
    if (runtime === undefined) continue;
    for (const [participantId, ballot] of Object.entries(runtime.ballots)) {
      const hidden =
        (ballot.kind === 'text' || ballot.kind === 'qna') && ballot.hidden ? 'true' : 'false';
      lines.push(
        [
          csvCell(interaction.id),
          csvCell(interaction.prompt),
          csvCell(participantId),
          ...(withHandles ? [csvCell(runtime.groupNames?.[participantId] ?? state.participants[participantId]?.handle ?? '')] : []),
          csvCell(answerText(ballot)),
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
        ...(withHandles
          ? [csvCell(state.participants[question.participantId]?.handle ?? '')]
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

export function exportJson(input: SessionState): unknown {
  const state = ensureQna(input);
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
