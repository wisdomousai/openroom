import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseSession, type Session } from '@openroom/schema';
import { describe, expect, it } from 'vitest';

import { applyCommand } from '../src/apply-command.js';
import { createSession } from '../src/create-session.js';
import { isKnownTheme, SESSION_THEME_IDS } from '../src/types.js';
import type { Aggregate, Command, CommandEnvelope, SessionState } from '../src/types.js';

/**
 * Property-style fuzz test (plain code, no fast-check dependency): 1000 iterations
 * of random valid-shaped command sequences against the seg-camp reference session,
 * with a seeded PRNG so a failure is reproducible from the logged seed.
 *
 * Invariants checked after every single `applyCommand` call:
 *  1. revision is monotonic non-decreasing, and strictly +1 whenever the command
 *     actually produced an effect (`effects.length > 0`).
 *  2. for every interaction, aggregate "total" includes don't-know ballots and
 *     equals the number of recorded ballots of that interaction.
 *  3. `JSON.parse(JSON.stringify(state))` deep-equals `state` (pure JSON, no
 *     loss of information — the DO persists exactly this).
 *  4. `applyCommand` never throws; on invalid input it returns an error object.
 */

const examplesDir = fileURLToPath(new URL('../../../examples/', import.meta.url));

function loadSession(name: string): Session {
  const parsed = parseSession(readFileSync(`${examplesDir}${name}`, 'utf8'));
  if (!parsed.ok) {
    throw new Error(`fixture ${name} failed to parse: ${JSON.stringify(parsed.errors)}`);
  }
  return parsed.session;
}

const segCampSession = loadSession('seg-camp.yaml');
/** Extra sessions so the ranking primitive and the revote command are fuzzed too. */
const extraSessions: { name: string; session: Session }[] = [
  { name: 'ranking.yaml', session: loadSession('ranking.yaml') },
  { name: 'peer-instruction.yaml', session: loadSession('peer-instruction.yaml') },
];

/** Deterministic, seeded PRNG (mulberry32) — no external dependency. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick from empty array');
  return item;
}

const PARTICIPANT_POOL = Array.from({ length: 8 }, (_, i) => `p${i}`);
const THEME_POOL = [...SESSION_THEME_IDS];

function randomAnswerFor(
  rng: () => number,
  interaction: Session['interactions'][number],
): Command | null {
  // Occasionally send a dont-know when it's allowed.
  if (interaction.allowDontKnow && rng() < 0.15) {
    return { command: 'answer.submit', interactionId: interaction.id, answer: { kind: 'dont-know' } };
  }
  switch (interaction.type) {
    case 'choice': {
      const options = interaction.options;
      const optionIds = interaction.multiple
        ? options.filter(() => rng() < 0.5).map((o) => o.id)
        : [pick(rng, options).id];
      if (optionIds.length === 0) optionIds.push(pick(rng, options).id);
      return {
        command: 'answer.submit',
        interactionId: interaction.id,
        answer: { kind: 'choice', optionIds },
      };
    }
    case 'scale': {
      const value = interaction.min + Math.floor(rng() * (interaction.max - interaction.min + 1));
      return { command: 'answer.submit', interactionId: interaction.id, answer: { kind: 'scale', value } };
    }
    case 'numeric': {
      const value = Math.round((rng() - 0.3) * 200);
      return { command: 'answer.submit', interactionId: interaction.id, answer: { kind: 'numeric', value } };
    }
    case 'text': {
      const text = `fuzz-${Math.floor(rng() * 1_000_000)}`;
      return { command: 'answer.submit', interactionId: interaction.id, answer: { kind: 'text', text } };
    }
    case 'qna': {
      const text = `question-${Math.floor(rng() * 1_000_000)}?`;
      return { command: 'answer.submit', interactionId: interaction.id, answer: { kind: 'qna', text } };
    }
    case 'ranking': {
      // Mostly complete permutations (accepted) with the occasional truncated
      // or duplicated list, which must be rejected rather than stored.
      const ids = interaction.options.map((o) => o.id);
      for (let i = ids.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const a = ids[i] as string;
        ids[i] = ids[j] as string;
        ids[j] = a;
      }
      const optionIds = rng() < 0.15 ? ids.slice(0, Math.max(1, ids.length - 1)) : ids;
      return {
        command: 'answer.submit',
        interactionId: interaction.id,
        answer: { kind: 'ranking', optionIds },
      };
    }
    default:
      return null;
  }
}

function randomCommand(
  rng: () => number,
  state: SessionState,
  session: Session = segCampSession,
): CommandEnvelope {
  const interactionIds = session.interactions.map((i) => i.id);
  const activeId = state.activeInteractionId;
  const roll = rng();
  let command: Command;

  if (roll < 0.05) {
    command = { command: 'session.start' };
  } else if (roll < 0.08) {
    command = { command: 'session.end' };
  } else if (roll < 0.12) {
    command = { command: 'session.freeze' };
  } else if (roll < 0.16) {
    command = { command: 'session.unfreeze' };
  } else if (roll < 0.3) {
    command = { command: 'interaction.open', interactionId: pick(rng, interactionIds) };
  } else if (roll < 0.4) {
    command = { command: 'interaction.close', interactionId: pick(rng, interactionIds) };
  } else if (roll < 0.47) {
    command = { command: 'interaction.reveal', interactionId: pick(rng, interactionIds) };
  } else if (roll < 0.5) {
    command = { command: 'interaction.revote', interactionId: pick(rng, interactionIds) };
  } else if (roll < 0.55) {
    command = { command: 'session.advance' };
  } else if (roll < 0.58) {
    // Live theme switching is part of the command surface: mostly valid ids,
    // occasionally a bogus one that must be rejected rather than stored.
    const theme = rng() < 0.2 ? `bogus-${Math.floor(rng() * 100)}` : pick(rng, THEME_POOL);
    command = { command: 'session.theme', theme };
  } else if (roll < 0.62 && activeId !== null) {
    command = {
      command: 'qna.vote',
      interactionId: 'open-questions',
      targetParticipantId: pick(rng, PARTICIPANT_POOL),
    };
  } else {
    const interaction = pick(rng, session.interactions);
    const answerCommand = randomAnswerFor(rng, interaction);
    command = answerCommand ?? { command: 'session.advance' };
  }

  const isParticipantCommand = command.command === 'answer.submit' || command.command === 'qna.vote';
  const actor: CommandEnvelope['actor'] = isParticipantCommand
    ? { role: 'participant', participantId: pick(rng, PARTICIPANT_POOL) }
    : { role: 'host', facilitatorId: 'creator' };

  return {
    idempotencyKey: `fuzz-${Math.floor(rng() * 1e9)}`,
    actor,
    command,
  };
}

/** Ranking scores must always be the Borda pool implied by the scored (non-don't-know) ballots. */
function checkRankingInvariant(state: SessionState, interactionId: string): void {
  const runtime = state.interactions[interactionId];
  if (runtime === undefined || runtime.aggregate.kind !== 'ranking') return;
  const scoreSum = Object.values(runtime.aggregate.scores).reduce((a, b) => a + b, 0);
  const k = Object.keys(runtime.aggregate.scores).length;
  const scored = runtime.aggregate.total - runtime.aggregate.dontKnow;
  expect(scoreSum).toBe((scored * k * (k + 1)) / 2);
  for (const value of Object.values(runtime.aggregate.avgRank)) {
    if (scored === 0) expect(value).toBeNull();
    else {
      expect(value).not.toBeNull();
      expect(value as number).toBeGreaterThanOrEqual(1);
      expect(value as number).toBeLessThanOrEqual(k);
    }
  }
}

function aggregateTotal(aggregate: Aggregate): number {
  return aggregate.total;
}

describe('property fuzz — seg-camp.yaml, seeded PRNG, 1000 iterations', () => {
  it('holds every invariant across many random seeds and command sequences', () => {
    const SEEDS = 5;
    const ITERATIONS_PER_SEED = 200; // 5 seeds * 200 = 1000 total applyCommand calls
    for (let seedIndex = 0; seedIndex < SEEDS; seedIndex += 1) {
      const seed = 1_000_003 * (seedIndex + 1);
      const rng = mulberry32(seed);
      let state = createSession(segCampSession, `FUZZROOM${seedIndex}`, 0);
      let lastRevision = state.revision;

      for (let i = 0; i < ITERATIONS_PER_SEED; i += 1) {
        const envelope = randomCommand(rng, state);
        const now = 1000 + i;

        let result;
        try {
          result = applyCommand(state, envelope, now);
        } catch (err) {
          throw new Error(
            `applyCommand threw (seed=${seed}, iter=${i}, command=${JSON.stringify(envelope)}): ${String(err)}`,
          );
        }

        // Invariant: applyCommand is total — it always returns, never throws
        // (already enforced by the try/catch above not firing).
        expect(result).toBeDefined();

        if (!result.ok) {
          // errors must be well-formed and must not have mutated state
          expect(typeof result.error.code).toBe('string');
          expect(typeof result.error.message).toBe('string');
          continue;
        }

        const next = result.state;

        // Invariant 1: revision monotonic non-decreasing, strictly +1 on real effects.
        expect(next.revision).toBeGreaterThanOrEqual(lastRevision);
        if (result.effects.length > 0) {
          expect(next.revision).toBe(lastRevision + 1);
        } else {
          expect(next.revision).toBe(lastRevision);
        }
        lastRevision = next.revision;

        // Invariant 2b: ranking scores/avgRank stay internally consistent.
        for (const interaction of segCampSession.interactions) {
          checkRankingInvariant(next, interaction.id);
        }

        // Invariant 2: aggregate total === ballot count (don't-know included).
        for (const interaction of segCampSession.interactions) {
          const runtime = next.interactions[interaction.id];
          if (runtime === undefined) continue;
          const ballotCount = Object.keys(runtime.ballots).length;
          if (
            runtime.aggregate.kind === 'choice' ||
            runtime.aggregate.kind === 'scale' ||
            runtime.aggregate.kind === 'numeric' ||
            runtime.aggregate.kind === 'ranking'
          ) {
            expect(aggregateTotal(runtime.aggregate)).toBe(ballotCount);
          } else {
            // text/qna: one entry per ballot of that kind, dont-know never applies
            expect(aggregateTotal(runtime.aggregate)).toBe(ballotCount);
          }
        }

        // Invariant 2c: the session theme is always one of the known ids — a
        // rejected `session.theme` must never leave a bogus id behind.
        expect(isKnownTheme(next.theme), `theme "${next.theme}"`).toBe(true);

        // Invariant 3: JSON roundtrip of state is lossless.
        const roundTripped = JSON.parse(JSON.stringify(next)) as SessionState;
        expect(roundTripped).toEqual(next);

        state = next;
      }
    }
  });
});

describe('property fuzz — ranking and peer-instruction sessions', () => {
  it.each(extraSessions)('holds every invariant for $name', ({ name, session }) => {
    for (let seedIndex = 0; seedIndex < 3; seedIndex += 1) {
      const seed = 7_654_321 * (seedIndex + 1);
      const rng = mulberry32(seed);
      let state = createSession(session, `FZROOM${seedIndex}`, 0);
      let lastRevision = state.revision;

      for (let i = 0; i < 200; i += 1) {
        const envelope = randomCommand(rng, state, session);
        let result;
        try {
          result = applyCommand(state, envelope, 1000 + i);
        } catch (err) {
          throw new Error(
            `applyCommand threw (${name}, seed=${seed}, iter=${i}, command=${JSON.stringify(envelope)}): ${String(err)}`,
          );
        }
        if (!result.ok) {
          expect(typeof result.error.code).toBe('string');
          continue;
        }
        const next = result.state;

        // Revision discipline is identical for the new commands.
        if (result.effects.length > 0) expect(next.revision).toBe(lastRevision + 1);
        else expect(next.revision).toBe(lastRevision);
        lastRevision = next.revision;

        for (const interaction of session.interactions) {
          const runtime = next.interactions[interaction.id];
          if (runtime === undefined) continue;
          checkRankingInvariant(next, interaction.id);

          // A round-2 interaction always carries an archive, and never the
          // other way round; the archive itself is immutable once written.
          if (runtime.round === 2) expect(runtime.round1).toBeDefined();
          if (runtime.round1 !== undefined) expect(runtime.round).toBe(2);
        }

        expect(JSON.parse(JSON.stringify(next))).toEqual(next);
        state = next;
      }
    }
  });
});
