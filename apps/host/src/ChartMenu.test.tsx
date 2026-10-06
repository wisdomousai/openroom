import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { displaysFor } from './builder/displays';
import { ChartMenu, displayMenuLabel, honestDisplayLine } from './ChartMenu';

describe('ChartMenu', () => {
  it('lists only displays that fit a choice question', () => {
    const html = renderToStaticMarkup(
      <ChartMenu
        type="choice"
        current="bars"
        correctShown={false}
        showPercent={false}
        hasCorrect
        x={40}
        y={40}
        onPick={() => {}}
        onCallOut={() => {}}
        onTogglePercent={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('Bars');
    expect(html).toContain('Pie');
    expect(html).toContain('Big number only');
    expect(html).toContain('Tally marks');
    expect(html).not.toContain('Word cloud');
    for (const display of displaysFor('choice')) {
      expect(html).toContain(displayMenuLabel(display));
    }
  });

  it('omits ill-fitting types for open text rather than disabling them', () => {
    const html = renderToStaticMarkup(
      <ChartMenu
        type="text"
        current="list"
        correctShown={false}
        showPercent={false}
        hasCorrect={false}
        x={40}
        y={40}
        onPick={() => {}}
        onCallOut={() => {}}
        onTogglePercent={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('Word cloud');
    expect(html).not.toContain('Tally marks');
    expect(html).not.toContain('aria-disabled');
  });

  it('states the honest fit line for the question type', () => {
    expect(honestDisplayLine('choice')).toMatch(/open text/i);
    expect(honestDisplayLine('text')).toMatch(/choices/i);
  });
});
