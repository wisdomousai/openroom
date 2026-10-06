/**
 * The ambient layer's compositions, one per theme.
 *
 * Kept in its own module, free of `three` and `@react-three/fiber`, for two
 * reasons: the table is the design decision and deserves to be readable on its
 * own, and a test can assert that the five themes stay visibly different
 * without dragging a WebGL renderer into the test run.
 *
 * Everything here obeys the flat contract (PRODUCT.md, Brand Commitments):
 * shapes are hard-edged, fills are whole theme colours, and there is no knob in
 * this table for opacity, blur, glow or falloff — those are not expressible.
 */

export type ShapeKind = 'square' | 'triangle' | 'hexagon' | 'rule';

export interface Recipe {
  kind: ShapeKind;
  /** Solid fill, or hollow — a colour plate with the background punched out. */
  solid: boolean;
  count: number;
  /** Size range in world units. */
  min: number;
  max: number;
  /** Radians per second at rest. Zero keeps the shape axis-aligned. */
  spin: number;
  /** World units per second at rest. */
  drift: number;
  /** Drift direction in radians. 0 is right, π/2 is up. */
  heading: number;
  /** Outline weight for a hollow shape, as a fraction of its size. */
  weight: number;
  /** How many of the five chart hues this composition uses. */
  hues: number;
}

/**
 * The themes differ in shape, in filled versus hollow, in density and in how
 * much they turn — the same axes they already differ on in the charts, so the
 * backdrop reads as part of the theme rather than as one screensaver in five
 * palettes.
 *
 * `projector` is listed for completeness only: `shouldRenderAmbient()` mutes
 * the layer for that theme, so the scene module is never even downloaded there.
 */
export const RECIPES: Record<string, Recipe> = {
  // A quiet upright lattice of hollow squares. Nothing turns.
  default: {
    kind: 'square',
    solid: false,
    count: 9,
    min: 0.7,
    max: 2.1,
    spin: 0,
    drift: 0.13,
    heading: Math.PI / 2,
    weight: 0.035,
    hues: 3,
  },
  // Ruled chalk lines sliding sideways across the board.
  chalkboard: {
    kind: 'rule',
    solid: true,
    count: 10,
    min: 3.4,
    max: 9,
    spin: 0,
    drift: 0.16,
    heading: 0,
    weight: 0,
    hues: 2,
  },
  // Hollow hexagons turning slowly, like watermarks in the sheet.
  paper: {
    kind: 'hexagon',
    solid: false,
    count: 8,
    min: 1.3,
    max: 3.4,
    spin: 0.035,
    drift: 0.07,
    heading: 1.95,
    weight: 0.05,
    hues: 3,
  },
  // High-contrast blocks. Never rendered — the projector theme mutes the layer.
  projector: {
    kind: 'square',
    solid: true,
    count: 5,
    min: 1,
    max: 2,
    spin: 0,
    drift: 0.06,
    heading: Math.PI / 2,
    weight: 0,
    hues: 2,
  },
  // Solid triangles, all five hues, tumbling and busier than the rest.
  sherbet: {
    kind: 'triangle',
    solid: true,
    count: 17,
    min: 0.6,
    max: 2.2,
    spin: 0.14,
    drift: 0.24,
    heading: 1.25,
    weight: 0,
    hues: 5,
  },
};

/** An unknown theme id from the wire falls back to the default composition. */
export function recipeFor(themeId: string): Recipe {
  return RECIPES[themeId] ?? (RECIPES['default'] as Recipe);
}

/**
 * A small deterministic generator. The composition must be *composed* — the
 * same theme on the same projector lays out the same way every time, so a
 * host who switches themes and back does not get a different session.
 */
export function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function seedOf(themeId: string): number {
  let h = 2166136261;
  for (let i = 0; i < themeId.length; i++) {
    h = Math.imul(h ^ themeId.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export interface Item {
  x: number;
  y: number;
  size: number;
  rotation: number;
  /** Signed spin multiplier, so half the shapes turn the other way. */
  turn: number;
  /** Drift multiplier: not every shape moves at the same speed. */
  pace: number;
  hue: number;
}

export function layout(
  recipe: Recipe,
  themeId: string,
  width: number,
  height: number,
): Item[] {
  const random = lcg(seedOf(themeId));
  const items: Item[] = [];
  for (let i = 0; i < recipe.count; i++) {
    const size = recipe.min + random() * (recipe.max - recipe.min);
    items.push({
      x: (random() - 0.5) * (width + recipe.max * 2),
      y: (random() - 0.5) * (height + recipe.max * 2),
      size,
      rotation: recipe.spin === 0 ? 0 : random() * Math.PI * 2,
      turn: random() < 0.5 ? -1 : 1,
      pace: 0.55 + random() * 0.9,
      hue: i % recipe.hues,
    });
  }
  return items;
}

/** Keep a coordinate inside a centred span, so shapes re-enter the far edge. */
export function wrap(value: number, span: number): number {
  const half = span / 2;
  return ((((value + half) % span) + span) % span) - half;
}
