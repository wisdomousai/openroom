import { describe, expect, it } from 'vitest';

import { resolveMode, swatchColors } from '../src/theme-provider.js';

describe('theme helpers', () => {
  it('collapses the system mode setting against the OS preference', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
    expect(resolveMode('light', true)).toBe('light');
  });

  it('builds a swatch row from the theme tokens', () => {
    const swatches = swatchColors('sherbet', 'light');
    expect(swatches).toHaveLength(6);
    for (const colour of swatches) expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
    expect(swatchColors('sherbet', 'dark')).not.toEqual(swatches);
  });
});
