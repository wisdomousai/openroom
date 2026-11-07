// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { sanitizedElementFragment } from './HtmlHost';

function attributesOf(fragment: DocumentFragment): string[] {
  return [...fragment.querySelectorAll('*')].flatMap((element) =>
    [...element.attributes].map((attribute) => `${element.localName}[${attribute.name}=${attribute.value}]`),
  );
}

describe('sanitizedElementFragment', () => {
  it('builds no event handler or script link from markup that hides them', () => {
    const fragment = sanitizedElementFragment(
      '<img src="x"/onerror="alert(1)"><img src="x"onerror="alert(1)"><svg/onload="alert(1)"></svg>' +
        '<a href="jav&#x61;script:alert(1)">x</a>',
    );
    expect(attributesOf(fragment)).toEqual(['img[src=x]', 'img[src=x]']);
  });

  it('keeps a drawing and a link as written', () => {
    const fragment = sanitizedElementFragment(
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg><a href="https://example.org/">x</a>',
    );
    expect(attributesOf(fragment)).toEqual([
      'svg[viewBox=0 0 10 10]',
      'circle[cx=5]',
      'circle[cy=5]',
      'circle[r=4]',
      'a[href=https://example.org/]',
    ]);
  });
});
