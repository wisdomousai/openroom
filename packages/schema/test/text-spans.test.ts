import { describe, expect, it } from 'vitest';

import { validateOutline, type Outline } from '../src/index.js';

const outline: Outline = {
  version: 1,
  meta: { title: 'Formatting' },
  steps: [
    {
      id: 'canvas',
      kind: 'blank',
      elements: [
        {
          id: 'box',
          type: 'text',
          text: 'Le passé composé',
          box: { x: 10, y: 10, w: 40, h: 12 },
        },
      ],
    },
  ],
  interactions: [
    {
      id: 'check',
      type: 'choice',
      prompt: 'Choose.',
      options: [
        { id: 'a', label: 'A', correct: true },
        { id: 'b', label: 'B' },
      ],
    },
  ],
};

function withTextElement(element: Record<string, unknown>): unknown {
  return {
    ...outline,
    steps: [{ ...outline.steps[0], elements: [element] }],
  };
}

const styled = {
  id: 'box',
  type: 'text',
  text: 'Le passé composé',
  align: 'center',
  box: { x: 10, y: 10, w: 40, h: 12 },
  spans: [
    { text: 'Le ', size: 150, color: '#0F6CBD' },
    { text: 'passé', bold: true, italic: true, underline: true, family: 'serif' },
    { text: ' composé', size: 75 },
  ],
};

describe('text element spans', () => {
  it('accepts styled spans that concatenate exactly to text', () => {
    const result = validateOutline(withTextElement(styled));
    expect(result.ok).toBe(true);
  });

  it('still accepts a bare-text element without spans', () => {
    const result = validateOutline(outline);
    expect(result.ok).toBe(true);
  });

  it('rejects spans whose concatenation drifts from text', () => {
    const drifted = {
      ...styled,
      text: 'Le passe compose',
    };
    const result = validateOutline(withTextElement(drifted));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path.endsWith('/spans'))).toBe(true);
    }
  });

  it('rejects an empty span', () => {
    const emptied = {
      ...styled,
      spans: [...styled.spans.slice(0, -1), { text: '' }],
    };
    const result = validateOutline(withTextElement(emptied));
    expect(result.ok).toBe(false);
  });

  it('rejects an out-of-range span size', () => {
    const huge = {
      ...styled,
      spans: [{ ...styled.spans[0], size: 401 }],
    };
    expect(validateOutline(withTextElement(huge)).ok).toBe(false);
  });

  it('rejects a non-hex span color', () => {
    const named = {
      ...styled,
      spans: [{ ...styled.spans[0], color: 'red' }],
    };
    expect(validateOutline(withTextElement(named)).ok).toBe(false);
  });

  it('rejects an unknown font family token', () => {
    const comicSans = {
      ...styled,
      spans: [{ ...styled.spans[0], family: 'comic-sans' }],
    };
    expect(validateOutline(withTextElement(comicSans)).ok).toBe(false);
  });

  it('rejects an unknown alignment', () => {
    const justified = { ...styled, align: 'justify' };
    expect(validateOutline(withTextElement(justified)).ok).toBe(false);
  });
});
