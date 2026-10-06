/**
 * `purgeBallots` — the pure half of PRD DATA-04 retention.
 *
 * What must survive a purge: aggregates (counts, means, the wording of text and
 * Q&A entries). What must not: ballots, participant records, and the link from
 * an entry back to the person who wrote it.
 */
import { describe, expect, it } from 'vitest';

import { purgeBallots } from '../src/index.js';
import type { SessionState } from '../src/types.js';
import { env, sessionWithOpen, participant, run } from './helpers.js';

/** A finished session with answers on a choice, a scale, a text and a Q&A interaction. */
function answeredRoom(): SessionState {
  let state = sessionWithOpen('single-choice');
  state = run(
    state,
    env(
      { command: 'answer.submit', interactionId: 'single-choice', answer: { kind: 'choice', optionIds: ['yes'] } },
      participant('p1'),
    ),
  );
  state = run(
    state,
    env(
      { command: 'answer.submit', interactionId: 'single-choice', answer: { kind: 'choice', optionIds: ['no'] } },
      participant('p2'),
    ),
  );

  state = run(state, env({ command: 'interaction.open', interactionId: 'mood' }));
  state = run(
    state,
    env({ command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 4 } }, participant('p1')),
  );

  state = run(state, env({ command: 'interaction.open', interactionId: 'reflection' }));
  state = run(
    state,
    env(
      { command: 'answer.submit', interactionId: 'reflection', answer: { kind: 'text', text: 'more coffee' } },
      participant('p1'),
    ),
  );
  state = run(
    state,
    env(
      { command: 'answer.submit', interactionId: 'reflection', answer: { kind: 'text', text: 'less talking' } },
      participant('p2'),
    ),
  );

  state = run(state, env({ command: 'interaction.open', interactionId: 'ask' }));
  state = run(
    state,
    env({ command: 'answer.submit', interactionId: 'ask', answer: { kind: 'qna', text: 'Why now?' } }, participant('p1')),
  );
  state = run(
    state,
    env({ command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'p1' }, participant('p2')),
  );

  return run(state, env({ command: 'session.end' }));
}

describe('purgeBallots', () => {
  it('removes every ballot from every interaction', () => {
    const purged = purgeBallots(answeredRoom(), 5000);
    for (const runtime of Object.values(purged.interactions)) {
      expect(runtime.ballots).toEqual({});
    }
  });

  it('drops session-local handles along with the participants map', () => {
    const ended = answeredRoom();
    ended.participants['p1'] = { joinedAt: 0, handle: 'Amber Fox' };
    const purged = purgeBallots(ended, 5000);
    expect(purged.participants).toEqual({});
    expect(JSON.stringify(purged)).not.toContain('Amber Fox');
  });

  it('leaves numeric aggregates untouched', () => {
    const ended = answeredRoom();
    const purged = purgeBallots(ended, 5000);
    expect(purged.interactions['single-choice']!.aggregate).toEqual(
      ended.interactions['single-choice']!.aggregate,
    );
    expect(purged.interactions['mood']!.aggregate).toEqual(ended.interactions['mood']!.aggregate);
  });

  it('anonymizes text entries but preserves their content and hidden flag', () => {
    const purged = purgeBallots(answeredRoom(), 5000);
    const aggregate = purged.interactions['reflection']!.aggregate;
    expect(aggregate.kind).toBe('text');
    if (aggregate.kind !== 'text') throw new Error('expected a text aggregate');
    expect(aggregate.total).toBe(2);
    expect(aggregate.entries.map((entry) => entry.text).sort()).toEqual([
      'less talking',
      'more coffee',
    ]);
    expect(aggregate.entries.map((entry) => entry.participantId)).toEqual(['purged-1', 'purged-2']);
    expect(aggregate.entries.every((entry) => entry.hidden === false)).toBe(true);
  });

  it('anonymizes Q&A entries while keeping their vote counts', () => {
    const purged = purgeBallots(answeredRoom(), 5000);
    const aggregate = purged.interactions['ask']!.aggregate;
    if (aggregate.kind !== 'qna') throw new Error('expected a qna aggregate');
    expect(aggregate.entries).toEqual([
      { participantId: 'purged-1', text: 'Why now?', hidden: false, votes: 1 },
    ]);
  });

  it('empties the participant roster', () => {
    const ended = answeredRoom();
    expect(Object.keys(ended.participants).length).toBeGreaterThan(0);
    const purged = purgeBallots(ended, 5000);
    expect(Object.keys(purged.participants)).toHaveLength(0);
  });

  it('bumps the revision exactly once and stamps purgedAt', () => {
    const ended = answeredRoom();
    const purged = purgeBallots(ended, 5000);
    expect(purged.revision).toBe(ended.revision + 1);
    expect(purged.purgedAt).toBe(5000);
    expect(purged.endedAt).toBe(ended.endedAt);
  });

  it('is idempotent: a second purge returns the same object', () => {
    const once = purgeBallots(answeredRoom(), 5000);
    const twice = purgeBallots(once, 9000);
    expect(twice).toBe(once);
    expect(twice.purgedAt).toBe(5000);
    expect(twice.revision).toBe(once.revision);
  });

  it('is a no-op on a session that has not ended — the purge is time-triggered, never racing a live session', () => {
    const live = sessionWithOpen('reflection');
    const purged = purgeBallots(live, 5000);
    expect(purged).toBe(live);
    expect(purged.purgedAt).toBeUndefined();
  });

  it('survives a JSON roundtrip unchanged', () => {
    const purged = purgeBallots(answeredRoom(), 5000);
    expect(JSON.parse(JSON.stringify(purged))).toEqual(purged);
  });

  it('does not mutate the input state', () => {
    const ended = answeredRoom();
    const before = JSON.parse(JSON.stringify(ended)) as SessionState;
    purgeBallots(ended, 5000);
    expect(ended).toEqual(before);
  });
});
