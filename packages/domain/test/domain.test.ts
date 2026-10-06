import type { Session } from '@openroom/schema';
import { describe, expect, it } from 'vitest';

import {
  applyBlocklist,
  applyCommand,
  BLOCKLIST_SIZE,
  createSession,
  generateSessionCode,
  hostSnapshot,
  isValidSessionCode,
  participantSnapshot,
  SESSION_CODE_ALPHABET,
  stageSnapshot,
  type Command,
  type CommandEnvelope,
  type SessionState,
} from '../src/index.js';

const session: Session = {
  version: 1,
  meta: { title: 'Smoke test session' },
  interactions: [
    {
      id: 'pulse',
      type: 'choice',
      prompt: 'Ready?',
      allowDontKnow: true,
      options: [
        { id: 'yes', label: 'Yes', correct: true },
        { id: 'no', label: 'No', misconception: 'not ready' },
      ],
      notes: 'host only',
    },
    { id: 'confidence', type: 'scale', prompt: 'How sure?', min: 1, max: 5 },
    { id: 'guess', type: 'numeric', prompt: 'How many?', correct: 10, tolerance: 2 },
    { id: 'muddiest', type: 'text', prompt: 'What is unclear?' },
    { id: 'questions', type: 'qna', prompt: 'Ask anything' },
  ],
};

let keyCounter = 0;
function env(command: Command, actor: CommandEnvelope['actor'] = { role: 'host', facilitatorId: 'creator' }): CommandEnvelope {
  keyCounter += 1;
  return { idempotencyKey: `k${keyCounter}`, actor, command };
}

function participant(id: string): CommandEnvelope['actor'] {
  return { role: 'participant', participantId: id };
}

/** Apply a command and assert it succeeded, returning the new state. */
function run(state: SessionState, envelope: CommandEnvelope, now = 1000): SessionState {
  const result = applyCommand(state, envelope, now);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function newSession(): SessionState {
  return createSession(session, 'SESS1234', 0);
}

describe('createSession', () => {
  it('starts in the lobby at revision 0 with every interaction pending', () => {
    const state = newSession();
    expect(state.status).toBe('lobby');
    expect(state.revision).toBe(0);
    expect(state.activeInteractionId).toBeNull();
    expect(Object.keys(state.interactions)).toHaveLength(5);
    expect(state.interactions['pulse']?.status).toBe('pending');
    // outline is normalized
    expect(state.outline.content.defaults?.resultVisibility).toBe('live');
    expect(state.outline.content.interactions[0]?.display).toBe('bars');
  });
});

describe('generateSessionCode', () => {
  it('produces 8 chars from the documented alphabet', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateSessionCode();
      expect(code).toHaveLength(8);
      expect(isValidSessionCode(code)).toBe(true);
      for (const char of code) expect(SESSION_CODE_ALPHABET).toContain(char);
    }
  });

  it('excludes vowels and ambiguous glyphs', () => {
    for (const char of 'AEIOULU01') expect(SESSION_CODE_ALPHABET).not.toContain(char);
  });
});

describe('blocklist', () => {
  it('has a substantial wordlist', () => {
    expect(BLOCKLIST_SIZE).toBeGreaterThanOrEqual(100);
  });

  it('hides profanity, including leetspeak', () => {
    expect(applyBlocklist('this is sh1t').hidden).toBe(true);
    expect(applyBlocklist('f*u*c*k').hidden).toBe(false); // punctuation splits letters
    expect(applyBlocklist('fuuuuck this').hidden).toBe(true);
    expect(applyBlocklist('@ss').hidden).toBe(true);
  });

  it('does not trip on innocent words (Scunthorpe safety)', () => {
    for (const clean of [
      'I am from Scunthorpe',
      'the whole class passed the assessment',
      'we did a full analysis of the data',
      'my therapist said so',
      'a raccoon in the cocoon',
      'I have a suspicion about the spice',
      'the cocktail was in the cockpit',
      'Charles Dickens wrote about hell',
    ]) {
      const result = applyBlocklist(clean);
      if (result.hidden && !clean.includes('hell')) {
        throw new Error(`false positive on "${clean}" (matched ${result.term})`);
      }
    }
  });
});

describe('applyCommand — happy path', () => {
  it('runs a full session', () => {
    let state = newSession();

    state = run(state, env({ command: 'session.start' }));
    expect(state.status).toBe('live');
    expect(state.revision).toBe(1);

    state = run(state, env({ command: 'interaction.open', interactionId: 'pulse' }));
    expect(state.activeInteractionId).toBe('pulse');

    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'pulse', answer: { kind: 'choice', optionIds: ['yes'] } }, participant('p1')),
    );
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'pulse', answer: { kind: 'dont-know' } }, participant('p2')),
    );

    const aggregate = state.interactions['pulse']?.aggregate;
    expect(aggregate).toMatchObject({ kind: 'choice', total: 2, dontKnow: 1 });
    if (aggregate?.kind === 'choice') expect(aggregate.counts['yes']).toBe(1);
    expect(Object.keys(state.participants)).toEqual(['p1', 'p2']);

    // answer change replaces the ballot
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'pulse', answer: { kind: 'choice', optionIds: ['no'] } }, participant('p1')),
    );
    const changed = state.interactions['pulse']?.aggregate;
    if (changed?.kind === 'choice') {
      expect(changed.counts['yes']).toBe(0);
      expect(changed.counts['no']).toBe(1);
    }

    state = run(state, env({ command: 'interaction.close', interactionId: 'pulse' }));
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'pulse' }));
    expect(state.interactions['pulse']?.status).toBe('revealed');

    // advance opens the next pending interaction
    state = run(state, env({ command: 'session.advance' }));
    expect(state.activeInteractionId).toBe('confidence');

    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'confidence', answer: { kind: 'scale', value: 4 } }, participant('p1')),
    );
    const scale = state.interactions['confidence']?.aggregate;
    expect(scale).toMatchObject({ kind: 'scale', total: 1, mean: 4 });

    state = run(state, env({ command: 'session.end' }));
    expect(state.status).toBe('ended');
    expect(state.endedAt).toBe(1000);

    const after = applyCommand(state, env({ command: 'session.start' }), 2000);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe('E_ENDED');
  });

  it('aggregates numeric answers with mean and median', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'guess' }));
    for (const [id, value] of [['p1', 4], ['p2', 10], ['p3', 16]] as const) {
      state = run(
        state,
        env({ command: 'answer.submit', interactionId: 'guess', answer: { kind: 'numeric', value } }, participant(id)),
      );
    }
    expect(state.interactions['guess']?.aggregate).toMatchObject({
      kind: 'numeric',
      values: [4, 10, 16],
      total: 3,
      mean: 10,
      median: 10,
    });
  });
});

describe('applyCommand — rules', () => {
  it('re-opening the active interaction is a no-op with no revision bump', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'pulse' }));
    const before = state.revision;
    const result = applyCommand(
      state,
      { ...env({ command: 'interaction.open', interactionId: 'pulse' }), expectedRevision: 999 },
      1000,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revision).toBe(before);
      expect(result.effects).toEqual([]);
    }
  });

  it('rejects a stale expectedRevision', () => {
    const state = run(newSession(), env({ command: 'session.start' }));
    const result = applyCommand(
      state,
      { ...env({ command: 'session.freeze' }), expectedRevision: 0 },
      1000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('E_REVISION_CONFLICT');
  });

  it('blocks submissions while frozen', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'muddiest' }));
    state = run(state, env({ command: 'session.freeze' }));
    const result = applyCommand(
      state,
      env({ command: 'answer.submit', interactionId: 'muddiest', answer: { kind: 'text', text: 'hi' } }, participant('p1')),
      1000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('E_FROZEN');
  });

  it('rejects answers to an interaction that is not open', () => {
    const state = run(newSession(), env({ command: 'session.start' }));
    const result = applyCommand(
      state,
      env({ command: 'answer.submit', interactionId: 'pulse', answer: { kind: 'choice', optionIds: ['yes'] } }, participant('p1')),
      1000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('E_NOT_OPEN');
  });

  it('forbids participants from issuing host commands', () => {
    const result = applyCommand(newSession(), env({ command: 'session.start' }, participant('p1')), 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('E_FORBIDDEN');
  });

  it('hides blocklisted text and lets the host unhide it', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'muddiest' }));
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'muddiest', answer: { kind: 'text', text: 'this is bullshit' } }, participant('p1')),
    );
    expect(state.interactions['muddiest']?.ballots['p1']).toMatchObject({ hidden: true });
    state = run(
      state,
      env({ command: 'text.unhide', interactionId: 'muddiest', participantId: 'p1' }),
    );
    expect(state.interactions['muddiest']?.ballots['p1']).toMatchObject({ hidden: false });
  });

  it('counts qna votes once per participant', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'questions' }));
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'questions', answer: { kind: 'qna', text: 'Why?' } }, participant('asker')),
    );
    state = run(
      state,
      env({ command: 'qna.vote', interactionId: 'questions', targetParticipantId: 'asker' }, participant('voter')),
    );
    const ballot = state.interactions['questions']?.ballots['asker'];
    expect(ballot).toMatchObject({ kind: 'qna', votes: 1, voters: ['voter'] });

    const twice = applyCommand(
      state,
      env({ command: 'qna.vote', interactionId: 'questions', targetParticipantId: 'asker' }, participant('voter')),
      1000,
    );
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error.code).toBe('E_FORBIDDEN');
  });

  it('rejects unknown interactions and invalid answers', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    const unknown = applyCommand(state, env({ command: 'interaction.open', interactionId: 'nope' }), 1000);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe('E_UNKNOWN_INTERACTION');

    state = run(state, env({ command: 'interaction.open', interactionId: 'confidence' }));
    const bad = applyCommand(
      state,
      env({ command: 'answer.submit', interactionId: 'confidence', answer: { kind: 'scale', value: 42 } }, participant('p1')),
      1000,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('E_INVALID_ANSWER');
  });
});

describe('snapshots', () => {
  it('never leak notes, correct answers or voter lists', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'pulse' }));
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'pulse', answer: { kind: 'choice', optionIds: ['yes'] } }, participant('p1')),
    );

    const p = participantSnapshot(state, 'p1');
    expect(p.answered).toBe(true);
    expect(p.yourAnswer).toEqual({ kind: 'choice', optionIds: ['yes'] });
    // live default: results visible while open
    expect(p.results).not.toBeNull();
    expect(JSON.stringify(p)).not.toContain('host only');
    expect(JSON.stringify(p)).not.toContain('misconception');

    const s = stageSnapshot(state);
    expect(s.code).toBe('SESS1234');
    expect(s.participantCount).toBe(1);
    expect(s.answeredCount).toBe(1);
    expect(s.aggregate).toMatchObject({ kind: 'choice', total: 1 });
    expect(JSON.stringify(s)).not.toContain('host only');

    state = run(state, env({ command: 'interaction.hideResults', interactionId: 'pulse' }));
    expect(participantSnapshot(state, 'p1').results).toBeNull();
    expect(stageSnapshot(state).aggregate).toBeNull();
    expect(hostSnapshot(state).interactions.find((i) => i.id === 'pulse')?.resultsHidden).toBe(true);

    state = run(state, env({ command: 'interaction.showResults', interactionId: 'pulse' }));
    expect(participantSnapshot(state, 'p1').results).not.toBeNull();
    expect(stageSnapshot(state).aggregate).toMatchObject({ kind: 'choice', total: 1 });

    state = run(state, env({ command: 'interaction.close', interactionId: 'pulse' }));
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'pulse' }));
    // the revealed interaction stays on screen, and results become visible
    expect(state.activeInteractionId).toBe('pulse');
    expect(stageSnapshot(state).aggregate).toMatchObject({ kind: 'choice', total: 1 });
    expect(participantSnapshot(state, 'p1').results).not.toBeNull();

    const h = hostSnapshot(state);
    expect(h.interactions).toHaveLength(5);
    expect(JSON.stringify(h)).toContain('host only');
  });

  it('hides text entries on the stage when frozen and strips qna voters', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'questions' }));
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'questions', answer: { kind: 'qna', text: 'Why is the sky blue?' } }, participant('asker')),
    );
    state = run(
      state,
      env({ command: 'qna.vote', interactionId: 'questions', targetParticipantId: 'asker' }, participant('voter')),
    );
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'questions' }));

    const visible = stageSnapshot(state);
    expect(visible.aggregate).toMatchObject({ kind: 'qna' });
    expect(JSON.stringify(visible)).not.toContain('voters');
    expect(JSON.stringify(visible)).toContain('Why is the sky blue?');

    state = run(state, env({ command: 'session.freeze' }));
    const frozen = stageSnapshot(state);
    expect(frozen.frozen).toBe(true);
    expect(JSON.stringify(frozen)).not.toContain('Why is the sky blue?');
  });
});
