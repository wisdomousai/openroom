import type { DeckDesign, SlidePalette } from './deck-design.js';
import { validateOutline } from './outline.js';

export interface BrandKitDocument { name: string; design: DeckDesign }
export interface BrandKit extends BrandKitDocument { id: string; spaceId: string; revision: number; trashed: boolean }
export interface ContrastIssue { label: string; ratio: number; minimum: number }

/** WCAG relative luminance and contrast, computed without rounding the threshold. */
export function colorContrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const full = hex.length === 4 ? hex.slice(1).split('').map((value) => value + value).join('') : hex.slice(1);
    const channels = [0, 2, 4].map((at) => {
      const srgb = parseInt(full.slice(at, at + 2), 16) / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Palette checks cover text and chart marks against both authored base surfaces. */
export function brandPaletteIssues(palette: SlidePalette): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  const foregrounds = [
    { label: 'Text', color: palette.foreground, minimum: 4.5 },
    { label: 'Secondary text', color: palette.muted, minimum: 4.5 },
    { label: 'Accent', color: palette.accent, minimum: 4.5 },
    ...palette.charts.map((color, index) => ({ label: `Chart color ${index + 1}`, color, minimum: 3 })),
  ];
  for (const foreground of foregrounds) {
    for (const [label, color] of [['slide', palette.background], ['card', palette.surface]] as const) {
      const ratio = colorContrast(foreground.color, color);
      if (!Number.isFinite(ratio) || ratio < foreground.minimum) issues.push({ label: `${foreground.label} on ${label}`, ratio, minimum: foreground.minimum });
    }
  }
  return issues;
}

export function validateBrandKit(value: unknown): { ok: true; document: BrandKitDocument } | { ok: false; error: string; issues?: ContrastIssue[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'invalid-brand-kit' };
  const raw = value as Record<string, unknown>;
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 120 || !raw.design) return { ok: false, error: 'invalid-brand-kit' };
  const parsed = validateOutline({ version: 1, meta: { title: 'Brand kit' }, interactions: [], steps: [{ id: 'preview', kind: 'title', title: 'Brand kit' }], design: raw.design });
  if (!parsed.ok || !parsed.outline.design) return { ok: false, error: 'invalid-brand-design' };
  const design = parsed.outline.design;
  // A reusable cloud kit must not point at a private file on the author’s computer.
  for (const master of design.masters) {
    for (const image of [master.logo, master.background?.kind === 'image' ? master.background : undefined]) {
      if (image?.resourceId || image?.url?.startsWith('https://local.openroom.invalid/')) return { ok: false, error: 'brand-image-needs-upload' };
    }
  }
  const issues = brandPaletteIssues(design.theme.colors);
  for (const master of design.masters) {
    if (master.theme) issues.push(...brandPaletteIssues(master.theme.colors).map((issue) => ({ ...issue, label: `${master.name}: ${issue.label}` })));
  }
  if (issues.length) return { ok: false, error: 'brand-palette-contrast', issues };
  return { ok: true, document: { name: raw.name.trim(), design: structuredClone(design) } };
}
