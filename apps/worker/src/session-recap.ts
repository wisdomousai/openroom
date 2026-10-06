import { ensureQna, sessionOf, sortedQuestions, type SessionState } from '@openroom/domain';
import { parseRecapSelection, type RecapCandidates, type RecapResult, type SessionRecap } from '@openroom/schema';
import { json } from './session-do/http.js';

/** Explicit projection. Never spread an aggregate, ballot, interaction, or question. */
export function recapCandidates(input: SessionState): RecapCandidates {
  const state = ensureQna(input);
  const candidates: RecapCandidates = { revision: state.revision, title: sessionOf(state).meta.title, results: [], discussion: [], questions: [] };
  for (const [index, interaction] of sessionOf(state).interactions.entries()) {
    const aggregate = state.interactions[interaction.id]?.aggregate;
    if (!aggregate || aggregate.total === 0) continue;
    const result: RecapResult & { id: string } = { id: `r${index}`, prompt: interaction.prompt, responses: aggregate.total, unit: interaction.responseMode === 'group' ? 'group responses' : 'responses', measure: 'Responses', rows: [] };
    if (aggregate.kind === 'choice' && interaction.type === 'choice') {
      result.rows = interaction.options.map((option) => ({ label: option.label, value: aggregate.counts[option.id] ?? 0 }));
    } else if (aggregate.kind === 'scale') {
      result.rows = Object.entries(aggregate.counts).map(([label, value]) => ({ label, value })).sort((a, b) => Number(a.label) - Number(b.label));
    } else if (aggregate.kind === 'numeric') {
      result.measure = 'Summary';
      result.rows = [ ...(aggregate.mean === null ? [] : [{ label: 'Mean', value: aggregate.mean }]), ...(aggregate.median === null ? [] : [{ label: 'Median', value: aggregate.median }]) ];
    } else if (aggregate.kind === 'ranking' && interaction.type === 'ranking') {
      result.measure = 'Points';
      result.rows = interaction.options.map((option) => ({ label: option.label, value: aggregate.scores[option.id] ?? 0 })).sort((a, b) => b.value - a.value);
    } else if (aggregate.kind === 'text' || aggregate.kind === 'qna') {
      for (const [entryIndex, entry] of aggregate.entries.entries()) {
        if (!entry.hidden) (aggregate.kind === 'text' ? candidates.discussion : candidates.questions).push({ id: `${aggregate.kind === 'text' ? 'd' : 'q'}${index}-${entryIndex}`, prompt: interaction.prompt, text: entry.text });
      }
      continue;
    } else continue;
    if ('dontKnow' in aggregate && aggregate.dontKnow > 0) result.rows.push({ label: "I don't know", value: aggregate.dontKnow });
    candidates.results.push(result);
  }
  for (const [index, question] of sortedQuestions(state.qna).entries()) {
    if (!question.hidden) candidates.questions.push({ id: `q${index}`, prompt: 'Audience Q&A', text: question.text });
  }
  return candidates;
}

export function selectedRecap(state: SessionState, body: unknown): Response {
  const selection = parseRecapSelection(body);
  if (!selection) return json({ error: 'invalid-recap-selection' }, 422);
  if (selection.revision !== state.revision) return json({ error: 'recap-source-changed' }, 409);
  const candidates = recapCandidates(state);
  if (!selection.resultIds.every((id) => candidates.results.some((row) => row.id === id)) || !selection.discussionIds.every((id) => candidates.discussion.some((row) => row.id === id)) || !selection.questionIds.every((id) => candidates.questions.some((row) => row.id === id))) return json({ error: 'recap-selection-unavailable' }, 422);
  if (!selection.resultIds.length && !selection.discussionIds.length && !selection.questionIds.length && !selection.discussion && !selection.followUp) return json({ error: 'recap-empty' }, 422);
  const recap: SessionRecap = {
    title: selection.title,
    results: candidates.results.filter((item) => selection.resultIds.includes(item.id)).map((item) => ({ prompt: item.prompt, responses: item.responses, unit: item.unit, measure: item.measure, rows: item.rows.map((row) => ({ label: row.label, value: row.value })) })),
    discussionPoints: candidates.discussion.filter((item) => selection.discussionIds.includes(item.id)).map((item) => ({ prompt: item.prompt, text: item.text })),
    questions: candidates.questions.filter((item) => selection.questionIds.includes(item.id)).map((item) => ({ prompt: item.prompt, text: item.text })),
    discussion: selection.discussion, followUp: selection.followUp,
  };
  return json(recap);
}

/** Bound the stream before parsing; content-length alone is not a trusted limit. */
export async function readRecapBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let text = '', size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 96 * 1024) { await reader.cancel(); return null; }
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch { return null; }
  finally { reader.releaseLock(); }
}
