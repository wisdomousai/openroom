import type { NormalizedInteraction } from '@openroom/schema';

import type { Aggregate, Ballot } from './types.js';

/** The zero aggregate for an interaction that has no ballots yet. */
export function emptyAggregate(interaction: NormalizedInteraction): Aggregate {
  switch (interaction.type) {
    case 'choice': {
      const counts: Record<string, number> = {};
      for (const option of interaction.options) counts[option.id] = 0;
      return { kind: 'choice', counts, total: 0, dontKnow: 0 };
    }
    case 'scale': {
      const counts: Record<number, number> = {};
      for (let value = interaction.min; value <= interaction.max; value += 1) counts[value] = 0;
      return { kind: 'scale', counts, total: 0, mean: null, dontKnow: 0 };
    }
    case 'numeric':
      return { kind: 'numeric', values: [], total: 0, mean: null, median: null, dontKnow: 0 };
    case 'text':
      return { kind: 'text', entries: [], total: 0 };
    case 'qna':
      return { kind: 'qna', entries: [], total: 0 };
    case 'ranking': {
      const scores: Record<string, number> = {};
      const avgRank: Record<string, number | null> = {};
      for (const option of interaction.options) {
        scores[option.id] = 0;
        avgRank[option.id] = null;
      }
      return { kind: 'ranking', scores, avgRank, total: 0, dontKnow: 0 };
    }
    case 'fill-the-gaps':
      return { kind: 'fill-the-gaps', entries: [], total: 0, dontKnow: 0 };
    case 'match': {
      const pairs: Record<string, Record<string, number>> = {};
      for (const item of interaction.left) pairs[item.id] = {};
      return { kind: 'match', pairs, entries: [], total: 0, dontKnow: 0 };
    }
    default: {
      const never: never = interaction;
      throw new Error(`unknown interaction type: ${JSON.stringify(never)}`);
    }
  }
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return (((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

/**
 * Recompute an interaction's aggregate from its ballots. Deterministic: given
 * the same ballot map (insertion order included) the output is byte-identical.
 *
 * "I don't know" is its own bar: counted in `dontKnow` *and* in `total`, and
 * named in the written summary. Means, medians and ranking averages still use
 * only the scored ballots so a don't-know never moves the math.
 */
export function computeAggregate(
  interaction: NormalizedInteraction,
  ballots: Record<string, Ballot>,
): Aggregate {
  const base = emptyAggregate(interaction);
  const entries = Object.entries(ballots);

  switch (base.kind) {
    case 'choice': {
      let scored = 0;
      let dontKnow = 0;
      for (const [, ballot] of entries) {
        if (ballot.kind === 'dont-know') {
          dontKnow += 1;
          continue;
        }
        if (ballot.kind !== 'choice') continue;
        scored += 1;
        for (const optionId of ballot.optionIds) {
          base.counts[optionId] = (base.counts[optionId] ?? 0) + 1;
        }
      }
      return { ...base, total: scored + dontKnow, dontKnow };
    }
    case 'scale': {
      const values: number[] = [];
      let dontKnow = 0;
      for (const [, ballot] of entries) {
        if (ballot.kind === 'dont-know') {
          dontKnow += 1;
          continue;
        }
        if (ballot.kind !== 'scale') continue;
        values.push(ballot.value);
        base.counts[ballot.value] = (base.counts[ballot.value] ?? 0) + 1;
      }
      return { ...base, total: values.length + dontKnow, mean: mean(values), dontKnow };
    }
    case 'numeric': {
      const values: number[] = [];
      let dontKnow = 0;
      for (const [, ballot] of entries) {
        if (ballot.kind === 'dont-know') {
          dontKnow += 1;
          continue;
        }
        if (ballot.kind !== 'numeric') continue;
        values.push(ballot.value);
      }
      values.sort((a, b) => a - b);
      return {
        kind: 'numeric',
        values,
        total: values.length + dontKnow,
        mean: mean(values),
        median: median(values),
        dontKnow,
      };
    }
    case 'text': {
      const list: { participantId: string; text: string; hidden: boolean }[] = [];
      for (const [participantId, ballot] of entries) {
        if (ballot.kind !== 'text') continue;
        list.push({ participantId, text: ballot.text, hidden: ballot.hidden });
      }
      return { kind: 'text', entries: list, total: list.length };
    }
    case 'qna': {
      const list: {
        participantId: string;
        text: string;
        hidden: boolean;
        votes: number;
      }[] = [];
      for (const [participantId, ballot] of entries) {
        if (ballot.kind !== 'qna') continue;
        list.push({
          participantId,
          text: ballot.text,
          hidden: ballot.hidden,
          votes: ballot.votes,
        });
      }
      // Most-voted first; ties broken by participantId for determinism.
      list.sort((a, b) =>
        b.votes === a.votes ? a.participantId.localeCompare(b.participantId) : b.votes - a.votes,
      );
      return { kind: 'qna', entries: list, total: list.length };
    }
    case 'ranking': {
      if (interaction.type !== 'ranking') return base;
      const optionIds = interaction.options.map((option) => option.id);
      const k = optionIds.length;
      const rankSums: Record<string, number> = {};
      for (const id of optionIds) rankSums[id] = 0;
      let scored = 0;
      let dontKnow = 0;
      for (const [, ballot] of entries) {
        if (ballot.kind === 'dont-know') {
          dontKnow += 1;
          continue;
        }
        if (ballot.kind !== 'ranking') continue;
        scored += 1;
        ballot.optionIds.forEach((id, position) => {
          if (!(id in base.scores)) return;
          // Borda: first place (position 0) is worth k points, last is worth 1.
          base.scores[id] = (base.scores[id] ?? 0) + (k - position);
          rankSums[id] = (rankSums[id] ?? 0) + position + 1;
        });
      }
      const avgRank: Record<string, number | null> = {};
      for (const id of optionIds) {
        avgRank[id] = scored === 0 ? null : (rankSums[id] ?? 0) / scored;
      }
      return { kind: 'ranking', scores: base.scores, avgRank, total: scored + dontKnow, dontKnow };
    }
    case 'fill-the-gaps': {
      const list: { participantId: string; gaps: Record<string, string>; hidden: boolean }[] = [];
      let dontKnow = 0;
      for (const [participantId, ballot] of entries) {
        if (ballot.kind === 'dont-know') {
          dontKnow += 1;
          continue;
        }
        if (ballot.kind !== 'fill-the-gaps') continue;
        list.push({ participantId, gaps: { ...ballot.gaps }, hidden: ballot.hidden });
      }
      return { kind: 'fill-the-gaps', entries: list, total: list.length + dontKnow, dontKnow };
    }
    case 'match': {
      if (interaction.type !== 'match') return base;
      const pairs: Record<string, Record<string, number>> = {};
      for (const item of interaction.left) pairs[item.id] = {};
      const list: { participantId: string; pairs: Record<string, string> }[] = [];
      let dontKnow = 0;
      for (const [participantId, ballot] of entries) {
        if (ballot.kind === 'dont-know') {
          dontKnow += 1;
          continue;
        }
        if (ballot.kind !== 'match') continue;
        list.push({ participantId, pairs: { ...ballot.pairs } });
        for (const [leftId, rightId] of Object.entries(ballot.pairs)) {
          const row = pairs[leftId] ?? (pairs[leftId] = {});
          row[rightId] = (row[rightId] ?? 0) + 1;
        }
      }
      return { kind: 'match', pairs, entries: list, total: list.length + dontKnow, dontKnow };
    }
    default: {
      const never: never = base;
      throw new Error(`unknown aggregate kind: ${JSON.stringify(never)}`);
    }
  }
}
