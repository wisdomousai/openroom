/**
 * Present's picture. What matters is that it is the projector's own markup —
 * `.stage` chrome around `@openroom/slides` — that reveals actually withhold
 * parts, that a question is drawn as a question rather than as invented
 * results, and that breakouts stay out of the linear sequence.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveRevealOrder, type Outline, type OutlineStep } from '@openroom/schema';

import { PresentStage, presentableSteps } from './PresentationStage';

const OUTLINE: Outline = {
  version: 1,
  meta: { title: 'Fractions', objectives: [] },
  steps: [
    { id: 'welcome', kind: 'title', title: 'Fractions', body: 'Day one' },
    {
      id: 'rules',
      kind: 'steps',
      title: 'Three rules',
      items: ['Same denominator', 'Add the tops', 'Simplify'],
      reveal: [['header'], ['cell-0'], ['cell-1'], ['cell-2']],
    },
    {
      id: 'detail',
      kind: 'statement',
      title: 'Why it works',
      body: 'Equal parts of the same whole.',
      breakoutOf: { stepId: 'rules', afterKey: 'cell-0' },
    },
    { id: 'check', kind: 'interaction', interactionId: 'check' },
  ],
  interactions: [
    {
      id: 'check',
      type: 'choice',
      prompt: 'Which is bigger?',
      options: [
        { id: 'a', label: 'One half' },
        { id: 'b', label: 'One third' },
      ],
    },
  ],
};

function stepAt(index: number): OutlineStep {
  const step = presentableSteps(OUTLINE)[index];
  if (step === undefined) throw new Error(`no presentable step ${String(index)}`);
  return step;
}

function render(index: number, shown: number): string {
  const step = stepAt(index);
  const groups = resolveRevealOrder(step, OUTLINE.interactions);
  return renderToStaticMarkup(
    <PresentStage
      outline={OUTLINE}
      step={step}
      groups={groups}
      shown={shown}
    />,
  );
}

describe('presentableSteps', () => {
  it('leaves breakouts out of the linear sequence', () => {
    expect(presentableSteps(OUTLINE).map((step) => step.id)).toEqual([
      'welcome',
      'rules',
      'check',
    ]);
  });
});

describe('PresentStage', () => {
  it('draws the step inside the projector’s own chrome', () => {
    const html = render(0, 1);
    expect(html).toContain('class="stage stage--embedded stage--no-rail"');
    expect(html).toContain('stage__main');
    expect(html).toContain('outline-step');
  });

  it('withholds the parts the reveal cursor has not reached', () => {
    const early = render(1, 2);
    expect(early).toContain('Three rules');
    expect(early).toContain('Same denominator');
    expect(early).not.toContain('Add the tops');
    expect(early).not.toContain('Simplify');
  });

  it('shows the whole step once every group is played', () => {
    const full = render(1, 4);
    expect(full).toContain('Same denominator');
    expect(full).toContain('Add the tops');
    expect(full).toContain('Simplify');
  });

  it('shows a question as the class first sees it — prompt and options, no results', () => {
    const html = render(2, 1);
    expect(html).toContain('Which is bigger?');
    expect(html).toContain('One half');
    expect(html).toContain('One third');
    expect(html).toContain('outline-step__options');
  });

});
