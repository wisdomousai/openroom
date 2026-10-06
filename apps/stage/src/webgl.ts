/**
 * Whether the ambient layer exists at all.
 *
 * Three independent guardrails from the PRD converge on one boolean, so they
 * are decided in one pure function that a test can pin down:
 *
 *  - no WebGL context           → skip the layer entirely; the stage still works
 *  - `prefers-reduced-motion`   → skip it; the composition *is* the drift, and
 *                                 a frozen frame of it is a handful of shapes
 *                                 parked behind the data for no reason
 *  - the `projector` theme      → mute it; that theme exists to be maximally
 *                                 legible on washed-out beamers and an animated
 *                                 backdrop is exactly what ruins it
 *
 * Because the answer gates a dynamic `import()`, a machine that says no never
 * downloads three.js.
 */

export interface AmbientConditions {
  themeId: string;
  reduced: boolean;
  webgl: boolean;
}

export function shouldRenderAmbient(c: AmbientConditions): boolean {
  if (!c.webgl) return false;
  if (c.reduced) return false;
  if (c.themeId === 'projector') return false;
  return true;
}

/**
 * Interpret the result of a context-creation attempt. Split out from the DOM
 * poking below so the fallback logic itself is testable without a canvas.
 */
export function interpretWebglProbe(context: unknown, threw: boolean): boolean {
  if (threw) return false;
  return context !== null && context !== undefined;
}

let cached: boolean | null = null;

/**
 * Try to create a real WebGL context once and remember the answer. Some
 * lock-down configurations throw rather than return null, hence the try.
 */
export function detectWebGL(): boolean {
  if (cached !== null) return cached;
  if (typeof document === 'undefined') {
    cached = false;
    return cached;
  }
  let context: unknown = null;
  let threw = false;
  try {
    const canvas = document.createElement('canvas');
    context =
      canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    // Drop the probe canvas without WEBGL_lose_context — that extension logs a
    // noisy "context lost" warning in DevTools even though the probe succeeded.
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    threw = true;
  }
  cached = interpretWebglProbe(context, threw);
  return cached;
}
