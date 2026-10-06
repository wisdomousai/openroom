import type { Aggregate, QnaEntry, TextEntry } from '../types';

export function answeredKey(sessionCode: string): string {
  return `or.qna-answered.${sessionCode}`;
}

export function readAnswered(sessionCode: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(answeredKey(sessionCode));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function stepLabel(step: {
  id: string;
  kind: string;
  title?: string;
  term?: string;
  body?: string;
}): string {
  if (typeof step.title === 'string' && step.title.trim() !== '') return step.title;
  if (step.kind === 'term' && step.term) return step.term;
  if (step.kind === 'statement' && step.body) return step.body;
  if (step.kind === 'timer') return 'Timer';
  if (step.kind === 'join') return 'Join the session';
  if (step.kind === 'blank') return 'Slide';
  if (step.kind === 'interaction') return 'Question';
  return step.kind;
}

export function hasCorrectAnswer(interaction: { type: string } | null | undefined): boolean {
  if (!interaction) return false;
  const ix = interaction as {
    type: string;
    options?: { correct?: boolean }[];
    correct?: number;
    correctAnswers?: string[];
    correctOrder?: string[];
    gaps?: { answers?: string[] }[];
    correctMap?: unknown;
    correctPairs?: unknown;
  };
  if (ix.type === 'choice') return ix.options?.some((o) => o.correct) === true;
  if (ix.type === 'numeric') return typeof ix.correct === 'number';
  if (ix.type === 'text') return (ix.correctAnswers?.length ?? 0) > 0;
  if (ix.type === 'ranking') return (ix.correctOrder?.length ?? 0) > 0;
  if (ix.type === 'fill-the-gaps') return ix.gaps?.some((g) => (g.answers?.length ?? 0) > 0) === true;
  if (ix.type === 'match') return 'correct' in ix && (ix as { correct?: unknown }).correct !== undefined;
  return false;
}

export function entriesOf(aggregate: Aggregate | undefined): (TextEntry | QnaEntry)[] {
  if (!aggregate) return [];
  if (aggregate.kind === 'text' || aggregate.kind === 'qna') return aggregate.entries;
  return [];
}
