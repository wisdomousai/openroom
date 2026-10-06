import { describe, expect, it } from 'vitest';

import { normalizeSession, validateSession, SESSION_THEME_IDS, type Session } from '../src/index.js';

/**
 * Normalization defaults: resultVisibility live, allowAnswerChange
 * true, per-type default display (CONTRACTS.md normalizeSession + display table).
 */

function session(interactions: Session['interactions']): Session {
  return { version: 1, meta: { title: 't' }, interactions };
}

describe('normalizeSession defaults', () => {
  it('defaults.resultVisibility -> live when omitted', () => {
    const normalized = normalizeSession(session([{ id: 'q', type: 'qna', prompt: 'p' }]));
    expect(normalized.defaults.resultVisibility).toBe('live');
  });

  it('defaults.allowAnswerChange -> true when omitted', () => {
    const normalized = normalizeSession(session([{ id: 'q', type: 'qna', prompt: 'p' }]));
    expect(normalized.defaults.allowAnswerChange).toBe(true);
  });

  it('defaults.identityMode -> pseudonymous when omitted', () => {
    const normalized = normalizeSession(session([{ id: 'q', type: 'qna', prompt: 'p' }]));
    expect(normalized.defaults.identityMode).toBe('pseudonymous');
  });

  it('an explicit defaults.identityMode: anonymous preserves the old behavior', () => {
    const base = session([{ id: 'q', type: 'qna', prompt: 'p' }]);
    const normalized = normalizeSession({ ...base, defaults: { identityMode: 'anonymous' } });
    expect(normalized.defaults.identityMode).toBe('anonymous');
  });

  it("defaults.theme -> 'default' when omitted", () => {
    const normalized = normalizeSession(session([{ id: 'q', type: 'qna', prompt: 'p' }]));
    expect(normalized.defaults.theme).toBe('default');
  });

  it('qna -> { enabled: false, maxLength: 300 } when omitted', () => {
    const normalized = normalizeSession(session([{ id: 'q', type: 'qna', prompt: 'p' }]));
    expect(normalized.qna).toEqual({ enabled: false, maxLength: 300 });
  });

  it('an explicit qna config survives normalization and fills maxLength', () => {
    const base = session([{ id: 'q', type: 'qna', prompt: 'p' }]);
    expect(normalizeSession({ ...base, qna: { enabled: true } }).qna).toEqual({
      enabled: true,
      maxLength: 300,
    });
    expect(normalizeSession({ ...base, qna: { enabled: true, maxLength: 140 } }).qna).toEqual({
      enabled: true,
      maxLength: 140,
    });
  });

  it('an explicit defaults.theme survives normalization', () => {
    for (const theme of SESSION_THEME_IDS) {
      const normalized = normalizeSession({
        version: 1,
        meta: { title: 't' },
        defaults: { theme },
        interactions: [{ id: 'q', type: 'qna', prompt: 'p' }],
      });
      expect(normalized.defaults.theme).toBe(theme);
    }
  });

  it('every built-in theme id validates in defaults.theme, unknown ids do not', () => {
    for (const theme of SESSION_THEME_IDS) {
      const result = validateSession({
        version: 1,
        meta: { title: 't' },
        defaults: { theme },
        interactions: [{ id: 'q', type: 'qna', prompt: 'p' }],
      });
      expect(result.ok, `theme ${theme}`).toBe(true);
    }
    const bad = validateSession({
      version: 1,
      meta: { title: 't' },
      defaults: { theme: 'neon' },
      interactions: [{ id: 'q', type: 'qna', prompt: 'p' }],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.some((e) => e.path === '/defaults/theme')).toBe(true);
  });

  it('explicit session defaults are preserved, not overwritten', () => {
    const p: Session = {
      version: 1,
      meta: { title: 't' },
      defaults: { resultVisibility: 'live', allowAnswerChange: false },
      interactions: [{ id: 'q', type: 'qna', prompt: 'p' }],
    };
    const normalized = normalizeSession(p);
    expect(normalized.defaults.resultVisibility).toBe('live');
    expect(normalized.defaults.allowAnswerChange).toBe(false);
  });

  it('interaction-level resultVisibility/allowAnswerChange fall back to session defaults', () => {
    const p: Session = {
      version: 1,
      meta: { title: 't' },
      defaults: { resultVisibility: 'live', allowAnswerChange: false },
      interactions: [{ id: 'q', type: 'qna', prompt: 'p' }],
    };
    const normalized = normalizeSession(p);
    expect(normalized.interactions[0]!.resultVisibility).toBe('live');
    expect(normalized.interactions[0]!.allowAnswerChange).toBe(false);
  });

  it('interaction-level overrides win over session defaults', () => {
    const p: Session = {
      version: 1,
      meta: { title: 't' },
      defaults: { resultVisibility: 'live' },
      interactions: [
        { id: 'q', type: 'qna', prompt: 'p', resultVisibility: 'hidden-until-close' },
      ],
    };
    const normalized = normalizeSession(p);
    expect(normalized.interactions[0]!.resultVisibility).toBe('hidden-until-close');
  });

  it('allowDontKnow defaults to false', () => {
    const normalized = normalizeSession(session([{ id: 'q', type: 'qna', prompt: 'p' }]));
    expect(normalized.interactions[0]!.allowDontKnow).toBe(false);
  });

  describe('per-type default display', () => {
    it('choice -> bars', () => {
      const normalized = normalizeSession(
        session([
          {
            id: 'q',
            type: 'choice',
            prompt: 'p',
            options: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
            ],
          },
        ]),
      );
      expect(normalized.interactions[0]!.display).toBe('bars');
    });

    it('scale -> dots', () => {
      const normalized = normalizeSession(
        session([{ id: 'q', type: 'scale', prompt: 'p', min: 1, max: 5 }]),
      );
      expect(normalized.interactions[0]!.display).toBe('dots');
    });

    it('numeric -> histogram', () => {
      const normalized = normalizeSession(session([{ id: 'q', type: 'numeric', prompt: 'p' }]));
      expect(normalized.interactions[0]!.display).toBe('histogram');
    });

    it('text -> list', () => {
      const normalized = normalizeSession(session([{ id: 'q', type: 'text', prompt: 'p' }]));
      expect(normalized.interactions[0]!.display).toBe('list');
    });

    it('qna -> list', () => {
      const normalized = normalizeSession(session([{ id: 'q', type: 'qna', prompt: 'p' }]));
      expect(normalized.interactions[0]!.display).toBe('list');
    });

    it('explicit non-default display is preserved', () => {
      const normalized = normalizeSession(
        session([
          {
            id: 'q',
            type: 'choice',
            prompt: 'p',
            display: 'donut',
            options: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
            ],
          },
        ]),
      );
      expect(normalized.interactions[0]!.display).toBe('donut');
    });
  });

  it('choice.multiple defaults to false; text.maxLength defaults to 200', () => {
    const normalized = normalizeSession(
      session([
        {
          id: 'c',
          type: 'choice',
          prompt: 'p',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
        { id: 't', type: 'text', prompt: 'p' },
      ]),
    );
    const choice = normalized.interactions[0];
    const text = normalized.interactions[1];
    if (choice?.type === 'choice') expect(choice.multiple).toBe(false);
    if (text?.type === 'text') expect(text.maxLength).toBe(200);
  });

  it('ranking -> ordered-bars display, options copied', () => {
    const normalized = normalizeSession(
      session([
        {
          id: 'r',
          type: 'ranking',
          prompt: 'Order these',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
      ]),
    );
    const ranking = normalized.interactions[0];
    expect(ranking!.display).toBe('ordered-bars');
    if (ranking?.type === 'ranking') expect(ranking.options).toHaveLength(2);
  });

  it('choice.peerInstruction defaults to false and is preserved when set', () => {
    const normalized = normalizeSession(
      session([
        {
          id: 'a',
          type: 'choice',
          prompt: 'p',
          options: [
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' },
          ],
        },
        {
          id: 'b',
          type: 'choice',
          prompt: 'p',
          peerInstruction: true,
          options: [
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' },
          ],
        },
      ]),
    );
    const plain = normalized.interactions[0];
    const pi = normalized.interactions[1];
    if (plain?.type === 'choice') expect(plain.peerInstruction).toBe(false);
    if (pi?.type === 'choice') expect(pi.peerInstruction).toBe(true);
  });

  it('is pure: does not mutate the input session', () => {
    const p = session([{ id: 'q', type: 'qna', prompt: 'p' }]);
    const copy = structuredClone(p);
    normalizeSession(p);
    expect(p).toEqual(copy);
  });
});
