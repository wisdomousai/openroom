import { ensureQna, sessionOf, sortedQuestions, type SessionState } from '@openroom/domain';
import type { SavedQuestionResult, SavedResults } from '@openroom/schema';

/** Capture labels with their answers: subsequent deck edits cannot relabel old results. */
export function savedResults(input: SessionState): SavedResults {
  const state = ensureQna(input), session = sessionOf(state);
  const questions = session.interactions.map((item): SavedQuestionResult => {
    const aggregate = state.interactions[item.id]?.aggregate;
    const result: SavedQuestionResult = { prompt: item.prompt, measure: 'Responses', rows: [], entries: [] };
    if (!aggregate) return result;
    if (aggregate.kind === 'choice' && item.type === 'choice') result.rows = item.options.map(({ id, label }) => ({ label, value: aggregate.counts[id] ?? 0 }));
    else if (aggregate.kind === 'ranking' && item.type === 'ranking') {
      result.measure = 'Points';
      result.rows = item.options.map(({ id, label }) => ({ label, value: aggregate.scores[id] ?? 0 })).sort((a, b) => b.value - a.value);
    } else if (aggregate.kind === 'scale') result.rows = Object.entries(aggregate.counts).map(([label, value]) => ({ label, value })).sort((a, b) => Number(a.label) - Number(b.label));
    else if (aggregate.kind === 'numeric') {
      result.measure = 'Summary';
      result.rows = [...(aggregate.mean === null ? [] : [{ label: 'Mean', value: aggregate.mean }]), ...(aggregate.median === null ? [] : [{ label: 'Median', value: aggregate.median }])];
    } else if (aggregate.kind === 'text' || aggregate.kind === 'qna') result.entries = aggregate.entries.filter((entry) => !entry.hidden).map((entry) => entry.text);
    else if (aggregate.kind === 'fill-the-gaps' && item.type === 'fill-the-gaps') {
      result.prompt = item.prompt.replace(/\{\{([^}]+)\}\}/g, (_match, id: string) => `____ (${item.gaps.findIndex((gap) => gap.id === id) + 1})`);
      for (const [index, gap] of item.gaps.entries()) {
        const counts = new Map<string, number>();
        for (const entry of aggregate.entries) if (!entry.hidden && entry.gaps[gap.id] !== undefined) counts.set(entry.gaps[gap.id]!, (counts.get(entry.gaps[gap.id]!) ?? 0) + 1);
        for (const [answer, value] of counts) result.rows.push({ label: `Blank ${index + 1}: ${answer}`, value });
      }
    } else if (aggregate.kind === 'match' && item.type === 'match') {
      for (const left of item.left) for (const right of item.right) {
        const value = aggregate.pairs[left.id]?.[right.id] ?? 0;
        if (value) result.rows.push({ label: `${left.label} → ${right.label}`, value });
      }
    }
    if ('dontKnow' in aggregate && aggregate.dontKnow) result.rows.push({ label: "I don't know", value: aggregate.dontKnow });
    return result;
  });
  const audience = sortedQuestions(state.qna).filter((question) => !question.hidden).map((question) => question.text);
  if (audience.length) questions.push({ prompt: 'Audience questions', measure: 'Responses', rows: [], entries: audience });
  return { title: session.meta.title, questions };
}
