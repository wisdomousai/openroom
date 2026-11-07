import { describe, expect, it } from 'vitest';

import { slideLabel } from './slide-label';

describe('slideLabel', () => {
  const interactions = [
    { id: 'q1', prompt: 'Quelle est la priorité de Samira ?' },
    { id: 'q2', prompt: "J'{{g1}} raté le train." },
    { id: 'q3', prompt: 'word '.repeat(40) },
  ];

  it('names an untitled question by its prompt, gaps drawn as blanks', () => {
    expect(slideLabel({ id: 's1', kind: 'interaction', interactionId: 'q1' }, interactions)).toBe(
      'Quelle est la priorité de Samira ?',
    );
    expect(slideLabel({ id: 's2', kind: 'interaction', interactionId: 'q2' }, interactions)).toBe(
      "J'____ raté le train.",
    );
  });

  it('keeps an authored title and shortens a long prompt', () => {
    expect(
      slideLabel({ id: 's1', kind: 'interaction', interactionId: 'q1', title: 'Warm-up' }, interactions),
    ).toBe('Warm-up');
    const long = slideLabel({ id: 's3', kind: 'interaction', interactionId: 'q3' }, interactions);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('…')).toBe(true);
  });

  it('names a freeform slide by what is on it, as the deck editor rail does', () => {
    const reading = { type: 'html', html: '<h1>Le passé composé</h1>', markdown: '# Le passé composé\n\nAvec être…' };
    expect(slideLabel({ id: 'b1', kind: 'blank', elements: [reading] })).toBe('Le passé composé');
    expect(slideLabel({ id: 'b2', kind: 'blank', elements: [{ type: 'html', html: '<svg viewBox="0 0 10 10"></svg>' }] })).toBe('Drawing');
    expect(slideLabel({ id: 'b3', kind: 'blank', elements: [{ type: 'image', alt: '' }] })).toBe('Empty slide');
    expect(slideLabel({ id: 'b4', kind: 'blank' })).toBe('Empty slide');
  });
});
