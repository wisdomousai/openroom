import type { NumericInteractionView } from '@openroom/sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NumericHistogramChart } from './histogram';

const year: NumericInteractionView = {
  id: 'year',
  type: 'numeric',
  prompt: 'In welchem Jahr fiel die Berliner Mauer?',
  correct: 1989,
};

function render(values: number[], revealed: boolean): string {
  return renderToStaticMarkup(
    <NumericHistogramChart
      interaction={year}
      values={values}
      total={values.length}
      mean={values[0] ?? null}
      median={values[0] ?? null}
      dontKnow={0}
      revealed={revealed}
      reduced
    />,
  );
}

describe('number histogram', () => {
  it('marks the correct value on its bin when the one answer is wrong', () => {
    const html = render([1961], true);
    expect(html).toMatch(/class="or-hist-note"[^>]*>1 answer ·/);
    expect(html).toContain('<span class="or-hist-note__correct"> · correct 1989</span>');

    // The correct bin has no bar, so the rule is what marks it on the axis.
    const bar = html.match(/<rect data-ts-key="numeric-histogram:[^"]*" fill="var\(--ok\)" x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="([\d.]+)"/);
    expect(bar).not.toBeNull();
    const [, x, width, height] = bar!;
    expect(Number(height)).toBe(0);
    const rule = html.match(/<g data-ts-key="numeric-correct"[^>]*><line [^>]*x1="([\d.]+)"/);
    expect(rule).not.toBeNull();
    expect(Number(rule![1])).toBeCloseTo(Number(x) + Number(width) / 2, 1);
  });

  it('draws no correct rule before the reveal', () => {
    const html = render([1961], false);
    expect(html).not.toContain('data-ts-key="numeric-correct"');
    expect(html).not.toContain('or-hist-note__correct');
  });
});
