import { describe, expect, it } from 'vitest';
import {
  normalizeDisplayOptions,
  validateDisplayOptionsShape,
  DISPLAY_OPTION_KEYS_FOR,
} from '../src/display-options.js';
import { normalizeSession, validateSession } from '../src/index.js';

describe('displayOptions', () => {
  it('rejects unknown keys and bad types', () => {
    const issues = validateDisplayOptionsShape({
      // @ts-expect-error intentional unknown
      glitter: true,
      showPercent: 'yes' as unknown as boolean,
      innerHole: 2,
    });
    expect(issues.some((i) => i.key === 'glitter')).toBe(true);
    expect(issues.some((i) => i.key === 'showPercent')).toBe(true);
    expect(issues.some((i) => i.key === 'innerHole')).toBe(true);
  });

  it('strips irrelevant keys and fills defaults for bars', () => {
    const normalized = normalizeDisplayOptions('bars', {
      orientation: 'vertical',
      maxWords: 20,
      showPercent: false,
    });
    expect(normalized?.orientation).toBe('vertical');
    expect(normalized?.showPercent).toBe(false);
    expect(normalized?.showCount).toBe(true);
    expect(normalized).not.toHaveProperty('maxWords');
  });

  it('fills donut hole default and pie hole 0', () => {
    expect(normalizeDisplayOptions('donut', undefined)?.innerHole).toBe(0.55);
    expect(normalizeDisplayOptions('pie', undefined)?.innerHole).toBe(0);
  });

  it('every display has a key list', () => {
    for (const display of Object.keys(DISPLAY_OPTION_KEYS_FOR)) {
      expect(DISPLAY_OPTION_KEYS_FOR[display as keyof typeof DISPLAY_OPTION_KEYS_FOR].length).toBeGreaterThan(0);
    }
  });

  it('normalizeSession materializes displayOptions', () => {
    const session = normalizeSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'q',
          type: 'choice',
          prompt: 'p',
          display: 'columns',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
      ],
    });
    expect(session.interactions[0]!.display).toBe('columns');
    expect(session.interactions[0]!.displayOptions.sortBy).toBe('order');
  });

  it('accepts columns/pie/radial and scale bars', () => {
    const ok = validateSession({
      version: 1,
      meta: { title: 't' },
      interactions: [
        {
          id: 'c',
          type: 'choice',
          prompt: 'p',
          display: 'pie',
          displayOptions: { innerHole: 0.2, colorMode: 'mono' },
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
        { id: 's', type: 'scale', prompt: 'r', min: 1, max: 5, display: 'bars' },
      ],
    });
    expect(ok.ok).toBe(true);
  });
});
