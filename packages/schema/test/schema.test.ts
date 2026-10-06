import { describe, expect, it } from 'vitest';

import {
  ErrorCodes,
  displaysFor,
  normalizeSession,
  parseSession,
  participantView,
  sessionSchema,
  validateSession,
  type Session,
} from '../src/index.js';

const minimalSession: Session = {
  version: 1,
  meta: { title: 'Minimal' },
  interactions: [
    {
      id: 'warm-up',
      type: 'choice',
      prompt: 'Ready?',
      options: [
        { id: 'yes', label: 'Yes', correct: true },
        { id: 'no', label: 'No', misconception: 'Needs coffee' },
      ],
    },
  ],
};

function codes(result: ReturnType<typeof validateSession>): string[] {
  return result.ok ? [] : result.errors.map((e) => e.code);
}

describe('sessionSchema', () => {
  it('is a draft 2020-12 schema with a stable $id', () => {
    expect(sessionSchema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(sessionSchema['$id']).toBe('https://openroom.app/schema/session.schema.json');
  });
});

describe('validateSession', () => {
  it('accepts a minimal session', () => {
    const result = validateSession(minimalSession);
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object with E_SCHEMA', () => {
    expect(codes(validateSession(42))).toContain(ErrorCodes.E_SCHEMA);
  });

  it('reports missing required fields with a JSON pointer path', () => {
    const result = validateSession({ version: 1, interactions: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path === '/meta')).toBe(true);
  });

  it('reports duplicate interaction ids', () => {
    const session = {
      ...minimalSession,
      interactions: [minimalSession.interactions[0]!, minimalSession.interactions[0]!],
    };
    const result = validateSession(session);
    expect(codes(result)).toContain(ErrorCodes.E_DUPLICATE_ID);
    if (!result.ok) {
      expect(result.errors[0]!.path).toBe('/interactions/1/id');
    }
  });

  it('reports a display style that does not match the type', () => {
    const result = validateSession({
      ...minimalSession,
      interactions: [{ ...minimalSession.interactions[0]!, display: 'histogram' }],
    });
    expect(codes(result)).toContain(ErrorCodes.E_DISPLAY_MISMATCH);
  });

  it('rejects a word cloud on a choice and a scale display on text', () => {
    expect(
      codes(
        validateSession({
          ...minimalSession,
          interactions: [{ ...minimalSession.interactions[0]!, display: 'wordcloud' }],
        }),
      ),
    ).toContain(ErrorCodes.E_DISPLAY_MISMATCH);
    expect(
      codes(
        validateSession({
          version: 1,
          meta: { title: 't' },
          interactions: [{ id: 'open', type: 'text', prompt: 'Say something', display: 'scale' }],
        }),
      ),
    ).toContain(ErrorCodes.E_DISPLAY_MISMATCH);
  });

  it('accepts the new picker displays that fit the type', () => {
    expect(
      validateSession({
        ...minimalSession,
        interactions: [{ ...minimalSession.interactions[0]!, display: 'tally' }],
      }).ok,
    ).toBe(true);
    expect(
      validateSession({
        version: 1,
        meta: { title: 't' },
        interactions: [{ id: 'open', type: 'text', prompt: 'Say something', display: 'wordcloud' }],
      }).ok,
    ).toBe(true);
    expect(
      validateSession({
        version: 1,
        meta: { title: 't' },
        interactions: [{ id: 'mood', type: 'scale', prompt: 'Rate', min: 1, max: 5, display: 'scale' }],
      }).ok,
    ).toBe(true);
  });

  it('reports tolerance without correct', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [{ id: 'est', type: 'numeric', prompt: 'How many?', tolerance: 5 }],
    });
    expect(codes(result)).toContain(ErrorCodes.E_TOLERANCE_WITHOUT_CORRECT);
  });

  it('reports an out-of-range option count', () => {
    const result = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        { id: 'one', type: 'choice', prompt: 'Pick', options: [{ id: 'a', label: 'A' }] },
      ],
    });
    expect(codes(result)).toContain(ErrorCodes.E_OPTION_COUNT);
  });
});

describe('displaysFor', () => {
  it('lists only displays the type can fill', () => {
    expect(displaysFor('choice')).toContain('bars');
    expect(displaysFor('choice')).toContain('tally');
    expect(displaysFor('choice')).not.toContain('wordcloud');
    expect(displaysFor('text')).toContain('wordcloud');
    expect(displaysFor('text')).not.toContain('tally');
    expect(displaysFor('scale')).toContain('scale');
    expect(displaysFor('ranking')).toContain('rank');
  });
});

describe('parseSession', () => {
  it('parses YAML', () => {
    const result = parseSession(`
version: 1
meta:
  title: YAML session
interactions:
  - id: mood
    type: scale
    prompt: How confident are you?
    min: 1
    max: 5
`);
    expect(result.ok).toBe(true);
  });

  it('parses JSON', () => {
    const result = parseSession(JSON.stringify(minimalSession), 'json');
    expect(result.ok).toBe(true);
  });

  it('returns E_PARSE for garbage', () => {
    const result = parseSession('{ this is: not: valid', 'json');
    expect(codes(result)).toEqual([ErrorCodes.E_PARSE]);
  });
});

describe('normalizeSession', () => {
  it('fills every default', () => {
    const normalized = normalizeSession(minimalSession);
    expect(normalized.defaults).toEqual({
      identityMode: 'pseudonymous',
      resultVisibility: 'live',
      allowAnswerChange: true,
      theme: 'default',
    });
    const first = normalized.interactions[0]!;
    expect(first.display).toBe('bars');
    expect(first.allowDontKnow).toBe(false);
    expect(first.allowAnswerChange).toBe(true);
    expect(first.resultVisibility).toBe('live');
  });

  it('does not mutate the input', () => {
    const copy = structuredClone(minimalSession);
    normalizeSession(minimalSession);
    expect(minimalSession).toEqual(copy);
  });
});

describe('participantView', () => {
  it('strips notes, correct, misconception and tolerance', () => {
    const session: Session = {
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q1',
          type: 'choice',
          prompt: 'Pick',
          notes: 'secret',
          options: [
            { id: 'a', label: 'A', correct: true },
            { id: 'b', label: 'B', misconception: 'oops' },
          ],
        },
        { id: 'q2', type: 'numeric', prompt: 'Guess', correct: 10, tolerance: 2, notes: 'shh' },
      ],
    };
    const view = participantView(session, 'q1');
    expect(JSON.stringify(view)).not.toContain('secret');
    expect(JSON.stringify(view)).not.toContain('correct');
    expect(JSON.stringify(view)).not.toContain('misconception');

    const numeric = participantView(session, 'q2');
    expect(JSON.stringify(numeric)).not.toContain('tolerance');
    expect(JSON.stringify(numeric)).not.toContain('shh');
  });

  it('returns null for an unknown id', () => {
    expect(participantView(minimalSession, 'nope')).toBeNull();
  });
});
