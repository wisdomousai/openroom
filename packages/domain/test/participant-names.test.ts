import { describe, expect, it } from 'vitest';

import { generateParticipantName } from '../src/index.js';

describe('generateParticipantName', () => {
  it('produces an "Adjective Animal 1234" recovery name', () => {
    const name = generateParticipantName(new Set());
    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{4}$/);
  });

  it('never returns a taken name, even under collision pressure', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const name = generateParticipantName(taken);
      expect(taken.has(name)).toBe(false);
      taken.add(name);
    }
  });

  it('keeps producing unique recovery names at classroom scale', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 3000; i += 1) taken.add(generateParticipantName(taken));
    expect([...taken].every((h) => / \d{4,}$/.test(h))).toBe(true);
    expect(taken.size).toBe(3000);
  });
});
