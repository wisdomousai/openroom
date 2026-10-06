import { describe, expect, it } from 'vitest';

import {
  compileSimpleSession,
  isSimpleSession,
  parseSession,
  validateSession,
} from '../src/index.js';

describe('SimpleSession', () => {
  it('detects simple vs full sessions', () => {
    expect(isSimpleSession({ title: 't', questions: [{ prompt: 'p', options: ['a', 'b'] }] })).toBe(
      true,
    );
    expect(
      isSimpleSession({
        version: 1,
        meta: { title: 't' },
        interactions: [{ id: 'q', type: 'qna', prompt: 'p' }],
      }),
    ).toBe(false);
  });

  it('compiles choice / scale / text', () => {
    const result = compileSimpleSession({
      title: 'Check-in',
      questions: [
        { prompt: 'How clear?', options: ['Clear', 'Fuzzy', 'Lost'], correct: 'Clear' },
        { prompt: 'Energy', type: 'scale', min: 1, max: 5 },
        { prompt: 'One word', type: 'text' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.version).toBe(1);
    expect(result.session.meta.title).toBe('Check-in');
    expect(result.session.interactions).toHaveLength(3);
    const choice = result.session.interactions[0];
    expect(choice?.type).toBe('choice');
    if (choice?.type === 'choice') {
      expect(choice.options.map((o) => o.label)).toEqual(['Clear', 'Fuzzy', 'Lost']);
      expect(choice.options[0]?.correct).toBe(true);
    }
  });

  it('validateSession accepts SimpleSession end-to-end', () => {
    const result = validateSession({
      title: 'Quick',
      questions: [{ prompt: 'Pick one', options: ['A', 'B'] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.interactions[0]?.type).toBe('choice');
  });

  it('parseSession accepts simple YAML', () => {
    const result = parseSession(`title: Quick
questions:
  - prompt: Pick
    options: [Yes, No]
`);
    expect(result.ok).toBe(true);
  });

  it('rejects unknown simple fields with a clear path', () => {
    const result = compileSimpleSession({
      title: 't',
      questions: [{ prompt: 'p', options: ['a', 'b'], peerInstruction: true }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toContain('peerInstruction');
  });

  it('rejects ranking in the thin dialect', () => {
    const result = compileSimpleSession({
      title: 't',
      questions: [{ prompt: 'Order', type: 'ranking' }],
    });
    expect(result.ok).toBe(false);
  });

  it('truncates long prompts to valid kebab ids (no trailing dash)', () => {
    const result = validateSession({
      title: 'Long',
      questions: [
        {
          prompt: 'What is the one thing you want answered today about the syllabus?',
          options: ['A', 'B'],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.session.interactions[0]?.id ?? '';
    expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(id.endsWith('-')).toBe(false);
  });
});
