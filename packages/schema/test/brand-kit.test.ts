import { describe, expect, it } from 'vitest';
import { brandPaletteIssues, colorContrast, validateBrandKit } from '../src/brand-kit.js';
import { defaultDeckDesign, SLIDE_THEME_FAMILIES } from '../src/deck-design.js';

describe('brand kit contract', () => {
  it('computes contrast without rounding and accepts every built-in palette', () => {
    expect(colorContrast('#000000', '#ffffff')).toBe(21);
    expect(colorContrast('#fff', '#fff')).toBe(1);
    expect(colorContrast('#777777', '#ffffff')).toBeLessThan(4.5);
    for (const family of SLIDE_THEME_FAMILIES) expect(brandPaletteIssues(defaultDeckDesign(family).theme.colors)).toEqual([]);
  });
  it('validates master references and snapshots design without retaining a caller reference', () => {
    const design = defaultDeckDesign('business');
    const result = validateBrandKit({ name: '  Company  ', design });
    expect(result).toMatchObject({ ok: true, document: { name: 'Company' } });
    if (!result.ok) throw new Error('Expected valid kit');
    design.theme.colors.accent = '#000000';
    expect(result.document.design.theme.colors.accent).not.toBe('#000000');
    design.defaultMasterId = 'missing';
    expect(validateBrandKit({ name: 'Company', design })).toMatchObject({ ok: false, error: 'invalid-brand-design' });
  });
  it('rejects unreadable colors, duplicate masters, unsafe URLs and file-local resources', () => {
    const design = defaultDeckDesign();
    design.theme.colors.charts[0] = '#eeeeee';
    expect(validateBrandKit({ name: 'Company', design })).toMatchObject({ ok: false, error: 'brand-palette-contrast' });
    design.theme.colors.charts[0] = '#1765B0';
    design.masters[0]!.logo = { resourceId: crypto.randomUUID(), alt: 'Logo' };
    expect(validateBrandKit({ name: 'Company', design })).toMatchObject({ ok: false, error: 'brand-image-needs-upload' });
    design.masters[0]!.logo = { url: 'javascript:alert(1)', alt: 'Logo' };
    expect(validateBrandKit({ name: 'Company', design })).toMatchObject({ ok: false, error: 'invalid-brand-design' });
    delete design.masters[0]!.logo;
    design.masters.push(structuredClone(design.masters[0]!));
    expect(validateBrandKit({ name: 'Company', design })).toMatchObject({ ok: false, error: 'invalid-brand-design' });
  });
  it('checks a source master palette as well as the deck-wide palette', () => {
    const design = defaultDeckDesign();
    design.masters[0]!.theme = defaultDeckDesign('board').theme;
    expect(validateBrandKit({ name: 'Mixed themes', design }).ok).toBe(true);
    design.masters[0]!.theme.colors.foreground = design.masters[0]!.theme.colors.background;
    expect(validateBrandKit({ name: 'Mixed themes', design })).toMatchObject({ ok: false, error: 'brand-palette-contrast', issues: [expect.objectContaining({ label: expect.stringContaining('Standard:') }), expect.anything()] });
  });
});
