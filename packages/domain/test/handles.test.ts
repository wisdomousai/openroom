import { describe, expect, it } from 'vitest';

import { generateHandle } from '../src/index.js';

describe('generateHandle', () => {
  it('produces an "Adjective Animal 1234" recovery handle', () => {
    const handle = generateHandle(new Set());
    expect(handle).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{4}$/);
  });

  it('never returns a taken handle, even under collision pressure', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const handle = generateHandle(taken);
      expect(taken.has(handle)).toBe(false);
      taken.add(handle);
    }
  });

  it('keeps producing unique recovery handles at classroom scale', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 3000; i += 1) taken.add(generateHandle(taken));
    expect([...taken].every((h) => / \d{4,}$/.test(h))).toBe(true);
    expect(taken.size).toBe(3000);
  });
});
