import { describe, expect, it } from 'vitest';

import {
  ErrorCodes,
  parseSession,
  validateSession,
  validateOutline,
  type Session,
} from '../src/index.js';

/**
 * One purpose-built bad session per stable error code (CONTRACTS.md validator API).
 * Every assertion also checks that `path` is a JSON pointer (starts with `/`).
 */

function expectPointerPath(path: string): void {
  expect(path.startsWith('/')).toBe(true);
}

describe('validation matrix — every stable error code', () => {
  it('E_PARSE: unparsable YAML/JSON text', () => {
    const result = parseSession('{ not: [valid', 'json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe(ErrorCodes.E_PARSE);
    expectPointerPath(result.errors[0]!.path);
  });

  it('E_PARSE: empty document', () => {
    const result = parseSession('', 'yaml');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe(ErrorCodes.E_PARSE);
  });

  it('E_SCHEMA: structurally invalid session (missing required fields, wrong types)', () => {
    const result = validateSession({ version: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_SCHEMA)).toBe(true);
    for (const e of result.errors) expectPointerPath(e.path);
  });

  it('E_SCHEMA: wrong version const', () => {
    const result = validateSession({
      version: 2,
      meta: { title: 't' },
      interactions: [{ id: 'a', type: 'qna', prompt: 'p' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_SCHEMA)).toBe(true);
  });

  it('identityMode: the four known modes accepted, unknown modes rejected', () => {
    const base = {
      version: 1,
      meta: { title: 't' },
      interactions: [{ id: 'a', type: 'qna', prompt: 'p' }],
    };
    for (const identityMode of ['anonymous', 'pseudonymous', 'identified', 'roster']) {
      expect(validateSession({ ...base, defaults: { identityMode } }).ok).toBe(true);
    }
    const bad = validateSession({ ...base, defaults: { identityMode: 'named' } });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.some((e) => e.code === ErrorCodes.E_SCHEMA)).toBe(true);
  });

  it('E_SCHEMA: unknown top-level property rejected (additionalProperties: false)', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [{ id: 'a', type: 'qna', prompt: 'p' }],
      bogus: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_SCHEMA && e.path === '/bogus')).toBe(
      true,
    );
  });

  it('timerSec: accepted in 1–7200; rejected outside range', () => {
    const base = {
      version: 1 as const,
      meta: { title: 't' },
      interactions: [
        {
          id: 'a',
          type: 'choice' as const,
          prompt: 'p',
          options: [
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' },
          ],
        },
      ],
    };
    expect(validateSession({ ...base, interactions: [{ ...base.interactions[0]!, timerSec: 30 }] }).ok).toBe(
      true,
    );
    expect(validateSession({ ...base, interactions: [{ ...base.interactions[0]!, timerSec: 0 }] }).ok).toBe(
      false,
    );
    expect(
      validateSession({ ...base, interactions: [{ ...base.interactions[0]!, timerSec: 7201 }] }).ok,
    ).toBe(false);
  });

  it('session qna: valid config accepted; bad maxLength and unknown keys rejected', () => {
    const base = {
      version: 1,
      meta: { title: 't' },
      interactions: [{ id: 'a', type: 'qna', prompt: 'p' }],
    };
    expect(validateSession({ ...base, qna: { enabled: true, maxLength: 200 } }).ok).toBe(true);

    const badMax = validateSession({ ...base, qna: { enabled: true, maxLength: 501 } });
    expect(badMax.ok).toBe(false);
    if (!badMax.ok) {
      expect(badMax.errors.some((e) => e.code === ErrorCodes.E_SCHEMA)).toBe(true);
    }

    const unknownKey = validateSession({ ...base, qna: { enabled: true, moderated: true } });
    expect(unknownKey.ok).toBe(false);
    if (!unknownKey.ok) {
      expect(unknownKey.errors.some((e) => e.code === ErrorCodes.E_SCHEMA)).toBe(true);
    }
  });

  it('E_DUPLICATE_ID: two interactions share an id', () => {
    const interaction: Session['interactions'][number] = {
      id: 'dupe',
      type: 'qna',
      prompt: 'Ask anything',
    };
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [interaction, interaction],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_DUPLICATE_ID);
    expect(err).toBeDefined();
    expect(err!.path).toBe('/interactions/1/id');
    expectPointerPath(err!.path);
  });

  it('E_DUPLICATE_ID: two options share an id within a choice interaction', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'choice',
          prompt: 'Pick',
          options: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'A again' },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_DUPLICATE_ID);
    expect(err).toBeDefined();
    expect(err!.path).toBe('/interactions/0/options/1/id');
  });

  it('E_DISPLAY_MISMATCH: display style not valid for the interaction type', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [{ id: 'q1', type: 'scale', prompt: 'Rate', min: 1, max: 5, display: 'donut' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_DISPLAY_MISMATCH);
    expect(err).toBeDefined();
    expect(err!.path).toBe('/interactions/0/display');
  });

  it('E_TOLERANCE_WITHOUT_CORRECT: numeric tolerance set without correct', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [{ id: 'q1', type: 'numeric', prompt: 'Guess', tolerance: 3 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_TOLERANCE_WITHOUT_CORRECT);
    expect(err).toBeDefined();
    expect(err!.path).toBe('/interactions/0/tolerance');
  });

  it('E_OPTION_COUNT: too few options (< 2)', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        { id: 'q1', type: 'choice', prompt: 'Pick', options: [{ id: 'a', label: 'A' }] },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_OPTION_COUNT);
    expect(err).toBeDefined();
    expect(err!.path).toBe('/interactions/0/options');
  });

  it('E_OPTION_COUNT: too many options (> 10)', () => {
    const options = Array.from({ length: 11 }, (_, i) => ({ id: `o${i}`, label: `Option ${i}` }));
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [{ id: 'q1', type: 'choice', prompt: 'Pick', options }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_OPTION_COUNT);
    expect(err).toBeDefined();
  });

  it('every emitted error has a JSON-pointer path (all codes, aggregated)', () => {
    // A single session tripping several semantic checks at once — paths must always
    // be valid JSON pointers even when many errors are reported together.
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        { id: 'dup', type: 'qna', prompt: 'p' },
        { id: 'dup', type: 'qna', prompt: 'p' },
        { id: 'q3', type: 'numeric', prompt: 'p', tolerance: 1 },
        {
          id: 'q4',
          type: 'choice',
          prompt: 'p',
          display: 'histogram',
          options: [{ id: 'a', label: 'A' }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    for (const e of result.errors) {
      expectPointerPath(e.path);
      expect(typeof e.code).toBe('string');
      expect(typeof e.message).toBe('string');
    }
  });

  it('E_UNKNOWN_KIND: outline step names no branch of the step union', () => {
    const result = validateOutline({
      version: 1,
      meta: { title: 't' },
      steps: [{ id: 's1', kind: 'exercise', prompt: 'p' }],
      interactions: [
        {
          id: 'q1',
          type: 'choice',
          prompt: 'p',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Reported alone: the union cannot be checked until `kind` picks a branch.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe(ErrorCodes.E_UNKNOWN_KIND);
    expectPointerPath(result.errors[0]!.path);
  });
});

describe('ranking interactions', () => {
  function rankingSession(options: { id: string; label: string }[], extra: object = {}): unknown {
    return {
      version: 1,
      meta: { title: 't' },
      interactions: [
        { id: 'rank', type: 'ranking', prompt: 'Order these', options, ...extra },
      ],
    };
  }

  it('accepts a well-formed ranking (2-6 options, ordered-bars display)', () => {
    const result = validateSession(
      rankingSession(
        [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        { display: 'ordered-bars' },
      ),
    );
    expect(result.ok).toBe(true);
  });

  it('E_OPTION_COUNT: fewer than 2 options', () => {
    const result = validateSession(rankingSession([{ id: 'a', label: 'A' }]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_OPTION_COUNT);
    expect(err).toBeDefined();
    expect(err!.path).toBe('/interactions/0/options');
  });

  it('E_OPTION_COUNT: more than 6 options', () => {
    const options = Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, label: `O${i}` }));
    const result = validateSession(rankingSession(options));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_OPTION_COUNT)).toBe(true);
  });

  it('E_DUPLICATE_ID: two ranking options share an id', () => {
    const result = validateSession(
      rankingSession([
        { id: 'a', label: 'A' },
        { id: 'a', label: 'A again' },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_DUPLICATE_ID);
    expect(err).toBeDefined();
    expect(err!.path).toBe('/interactions/0/options/1/id');
  });

  it('E_DISPLAY_MISMATCH: a choice display on a ranking', () => {
    const result = validateSession(
      rankingSession(
        [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        { display: 'donut' },
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_DISPLAY_MISMATCH);
    expect(err).toBeDefined();
    expect(err!.path).toBe('/interactions/0/display');
  });

  it('E_SCHEMA: ranking options may not carry correctness metadata', () => {
    const result = validateSession(
      rankingSession([
        { id: 'a', label: 'A', correct: true } as { id: string; label: string },
        { id: 'b', label: 'B' },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_SCHEMA)).toBe(true);
  });

  it('accepts ranking correctOrder that permutes every option id', () => {
    const result = validateSession(
      rankingSession(
        [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        { correctOrder: ['c', 'a', 'b'] },
      ),
    );
    expect(result.ok).toBe(true);
  });

  it('E_CORRECT_ORDER: wrong length', () => {
    const result = validateSession(
      rankingSession(
        [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        { correctOrder: ['a', 'b', 'a'] },
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_CORRECT_ORDER)).toBe(true);
  });

  it('E_CORRECT_ORDER: unknown option id', () => {
    const result = validateSession(
      rankingSession(
        [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        { correctOrder: ['a', 'z'] },
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_CORRECT_ORDER)).toBe(true);
  });

  it('E_CORRECT_ORDER: duplicate option id', () => {
    const result = validateSession(
      rankingSession(
        [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        { correctOrder: ['a', 'a'] },
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_CORRECT_ORDER)).toBe(true);
  });

  it('accepts text correctAnswers', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q',
          type: 'text',
          prompt: 'Capital?',
          correctAnswers: ['Paris', 'City of Light'],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('E_DISPLAY_MISMATCH: ordered-bars on a choice interaction', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q',
          type: 'choice',
          prompt: 'Pick',
          display: 'ordered-bars',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_DISPLAY_MISMATCH)).toBe(true);
  });
});

describe('peerInstruction configuration', () => {
  const options = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ];

  it('accepts peerInstruction on a single-select choice', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        { id: 'vote', type: 'choice', prompt: 'Pick', options, peerInstruction: true },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('accepts peerInstruction: false anywhere (it is simply off)', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [{ id: 'q', type: 'qna', prompt: 'Ask', peerInstruction: false }],
    });
    expect(result.ok).toBe(true);
  });

  it('E_PEER_INSTRUCTION_CONFIG: peerInstruction on a multi-select choice', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'vote',
          type: 'choice',
          prompt: 'Pick',
          options,
          multiple: true,
          peerInstruction: true,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_PEER_INSTRUCTION_CONFIG);
    expect(err).toBeDefined();
    expect(err!.path).toBe('/interactions/0/peerInstruction');
    expectPointerPath(err!.path);
  });

  it.each(['scale', 'numeric', 'text', 'qna', 'ranking'])(
    'E_PEER_INSTRUCTION_CONFIG: peerInstruction on a %s interaction',
    (type) => {
      const extra =
        type === 'scale'
          ? { min: 1, max: 5 }
          : type === 'ranking'
            ? { options }
            : {};
      const result = validateSession({
        version: 1,
        meta: { title: 't' },
        interactions: [{ id: 'x', type, prompt: 'p', peerInstruction: true, ...extra }],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const err = result.errors.find((e) => e.code === ErrorCodes.E_PEER_INSTRUCTION_CONFIG);
      expect(err).toBeDefined();
      expect(err!.path).toBe('/interactions/0/peerInstruction');
    },
  );
});

describe('fill-the-gaps / match structural rules', () => {
  it('E_FILL_THE_GAPS_GAPS: a gap has no placeholder in the prompt', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'fill-the-gaps',
          prompt: "J'{{g1}} raté le train.",
          gaps: [
            { id: 'g1', answers: ['ai'] },
            { id: 'g2', answers: ['suis'] },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_FILL_THE_GAPS_GAPS);
    expect(err).toBeDefined();
    expectPointerPath(err!.path);
  });

  it('E_FILL_THE_GAPS_GAPS: the prompt references a gap the interaction does not have', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'fill-the-gaps',
          prompt: "J'{{g1}} raté le {{g2}}.",
          gaps: [{ id: 'g1', answers: ['ai'] }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_FILL_THE_GAPS_GAPS)).toBe(true);
  });

  // A repeated placeholder has as many matches as a two-gap prompt, so a
  // count-only check would accept a sentence with two inputs writing one key.
  it('E_FILL_THE_GAPS_GAPS: the same placeholder twice is not two gaps', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'fill-the-gaps',
          prompt: '{{g1}} raté, {{g1}} attendu.',
          gaps: [
            { id: 'g1', answers: ["J'ai"] },
            { id: 'g2', answers: ["j'ai"] },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_FILL_THE_GAPS_GAPS);
    expect(err).toBeDefined();
    expect(err!.path).toBe('/interactions/0/prompt');
  });

  it('fill-the-gaps: a prompt whose placeholders match its gaps exactly validates', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'fill-the-gaps',
          prompt: "J'{{g1}} raté le {{g2}}.",
          gaps: [
            { id: 'g1', answers: ['ai'] },
            { id: 'g2', answers: ['train'] },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('E_FILL_THE_GAPS_DISTRACTOR: a distractor repeats an accepted answer', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'fill-the-gaps',
          prompt: "J'{{g1}} raté le train.",
          gaps: [{ id: 'g1', answers: ['ai'], distractors: ['AI'] }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_FILL_THE_GAPS_DISTRACTOR)).toBe(true);
  });

  it.each(['gaps', 'bank'] as const)('a single gap supports %s display without extra words', (display) => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'fill-the-gaps',
          display,
          prompt: "J'{{g1}} raté le train.",
          gaps: [{ id: 'g1', answers: ['ai'] }],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('E_FILL_THE_GAPS_CHOICES: choices display without distractors', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'fill-the-gaps',
          display: 'choices',
          prompt: "J'{{g1}} raté le train.",
          gaps: [{ id: 'g1', answers: ['ai'] }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_FILL_THE_GAPS_CHOICES)).toBe(true);
  });

  it('fill-the-gaps: choices display with distractors validates', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'fill-the-gaps',
          display: 'choices',
          prompt: "J'{{g1}} raté le train.",
          gaps: [{ id: 'g1', answers: ['ai'], distractors: ['suis', 'es'] }],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('fill-the-gaps: bank display with extras validates', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'fill-the-gaps',
          display: 'bank',
          prompt: "J'{{g1}} raté le train.",
          gaps: [{ id: 'g1', answers: ['ai'] }],
          bank: ['suis', 'es'],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('E_MATCH_PAIRS: correct does not pair every left item', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'match',
          prompt: 'Match them',
          left: [
            { id: 'l1', label: 'le quai' },
            { id: 'l2', label: 'le billet' },
            { id: 'l3', label: "l'horaire" },
          ],
          right: [
            { id: 'r1', label: 'the platform' },
            { id: 'r2', label: 'the ticket' },
            { id: 'r3', label: 'the timetable' },
          ],
          correct: { l1: 'r1', l2: 'r2' },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_MATCH_PAIRS);
    expect(err).toBeDefined();
    expect(err!.path).toBe('/interactions/0/correct');
  });

  it('E_MATCH_PAIRS: one right item is paired twice', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'match',
          prompt: 'Match them',
          left: [
            { id: 'l1', label: 'le quai' },
            { id: 'l2', label: 'le billet' },
          ],
          right: [
            { id: 'r1', label: 'the platform' },
            { id: 'r2', label: 'the ticket' },
          ],
          correct: { l1: 'r1', l2: 'r1' },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.code === ErrorCodes.E_MATCH_PAIRS);
    expect(err).toBeDefined();
    expectPointerPath(err!.path);
  });

  it('E_MATCH_PAIRS: the two columns have different lengths', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'match',
          prompt: 'Match them',
          left: [
            { id: 'l1', label: 'le quai' },
            { id: 'l2', label: 'le billet' },
          ],
          right: [
            { id: 'r1', label: 'the platform' },
            { id: 'r2', label: 'the ticket' },
            { id: 'r3', label: 'the timetable' },
          ],
          correct: { l1: 'r1', l2: 'r2' },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === ErrorCodes.E_MATCH_PAIRS)).toBe(true);
  });
});
