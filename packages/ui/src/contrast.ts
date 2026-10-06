/**
 * WCAG 2.1 relative luminance and contrast ratio, for `#rgb` / `#rrggbb` hex.
 *
 * Shipped (not test-only) so a future Pro branding editor can reject an accent
 * that would make its own label unreadable — the same check the built-in themes
 * are held to.
 */

/** WCAG AA minimum for normal-size body text. */
export const AA_CONTRAST = 4.5;
/** WCAG AA minimum for large text (>=18.66px bold or >=24px). */
export const AA_LARGE_CONTRAST = 3;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb` or `#rrggbb` into 0-255 channels. Throws on anything else. */
export function parseHex(hex: string): Rgb {
  const value = hex.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short !== null) {
    const [, r, g, b] = short as unknown as [string, string, string, string];
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (long === null) throw new Error(`not a hex colour: ${hex}`);
  const [, r, g, b] = long as unknown as [string, string, string, string];
  return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16) };
}

function channelLuminance(channel8: number): number {
  const c = channel8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

/** WCAG contrast ratio between two opaque hex colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** True when the pair clears WCAG AA for normal-size text. */
export function meetsAA(a: string, b: string): boolean {
  return contrastRatio(a, b) >= AA_CONTRAST;
}
