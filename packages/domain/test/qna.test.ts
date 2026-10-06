import { describe, expect, it } from 'vitest';

import { createSession, ensureQna, hostSnapshot, participantSnapshot, stageSnapshot } from '../src/index.js';
import { apply, env, fixtureSpec, sessionWithOpen, participant, run } from './helpers.js';

describe('ensureQna', () => {
  it('fills missing qna from the outline default', () => {
    const base = createSession(fixtureSpec, 'LEGACY1', 0);
    const { qna: _dropped, ...withoutQna } = base;
    const hydrated = ensureQna(withoutQna as typeof base);
    expect(hydrated.outline.content.interactions.map((row) => row.id)).toEqual(
      fixtureSpec.interactions.map((row) => row.id),
    );
    expect(hydrated.qna).toEqual({ enabled: false, stage: { mode: 'off' }, questions: {} });
  });
});

describe('Q&A — voting', () => {
  it('a vote increments the target ballot votes and adds the voter to the ledger', () => {
    let state = sessionWithOpen('ask');
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'ask', answer: { kind: 'qna', text: 'Why?' } }, participant('asker')),
    );
    state = run(
      state,
      env({ command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'asker' }, participant('voter')),
    );
    const ballot = state.interactions['ask']!.ballots['asker'];
    expect(ballot).toMatchObject({ kind: 'qna', votes: 1, voters: ['voter'] });
  });

  it('a double-vote by the same participant is rejected or a no-op — either way votes never reach 2', () => {
    let state = sessionWithOpen('ask');
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'ask', answer: { kind: 'qna', text: 'Why?' } }, participant('asker')),
    );
    state = run(
      state,
      env({ command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'asker' }, participant('voter')),
    );
    const secondVote = apply(
      state,
      env({ command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'asker' }, participant('voter')),
    );
    const finalState = secondVote.ok ? secondVote.state : state;
    const ballot = finalState.interactions['ask']!.ballots['asker'];
    if (ballot?.kind !== 'qna') throw new Error('expected qna ballot');
    expect(ballot.votes).toBe(1);
    expect(ballot.voters.filter((v) => v === 'voter')).toHaveLength(1);
    // This implementation rejects the repeat outright rather than silently no-op'ing.
    expect(secondVote.ok).toBe(false);
    if (!secondVote.ok) expect(secondVote.error.code).toBe('E_FORBIDDEN');
  });

  it('votes survive a question edit (resubmitting the same question text or a new one)', () => {
    let state = sessionWithOpen('ask');
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'ask', answer: { kind: 'qna', text: 'Original question?' } }, participant('asker')),
    );
    state = run(
      state,
      env({ command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'asker' }, participant('v1')),
    );
    state = run(
      state,
      env({ command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'asker' }, participant('v2')),
    );
    // asker edits their own question
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'ask', answer: { kind: 'qna', text: 'Edited question?' } }, participant('asker')),
    );
    const ballot = state.interactions['ask']!.ballots['asker'];
    if (ballot?.kind !== 'qna') throw new Error('expected qna ballot');
    expect(ballot.text).toBe('Edited question?');
    expect(ballot.votes).toBe(2);
    expect(ballot.voters.sort()).toEqual(['v1', 'v2']);
  });

  it('voters are never present in participant or stage snapshots', () => {
    let state = sessionWithOpen('ask');
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'ask', answer: { kind: 'qna', text: 'Why is the sky blue?' } }, participant('asker')),
    );
    state = run(
      state,
      env({ command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'asker' }, participant('voter-one')),
    );
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'ask' }));

    const p = participantSnapshot(state, 'asker');
    const s = stageSnapshot(state);
    expect(JSON.stringify(p)).not.toContain('voter-one');
    expect(JSON.stringify(p)).not.toContain('"voters"');
    expect(JSON.stringify(s)).not.toContain('voter-one');
    expect(JSON.stringify(s)).not.toContain('"voters"');

    // but the host CAN see the voter ledger (host tooling / moderation)
    const h = hostSnapshot(state);
    expect(JSON.stringify(h)).toContain('voter-one');
  });
});
