import { describe, expect, it } from 'vitest';

import {
  elementMarkupIssue,
  sanitizeElementCss,
  sanitizeElementHtml,
} from '../src/element-html.js';

describe('element HTML sanitiser', () => {
  it('keeps a fragment and an inline svg', () => {
    const html = '<svg viewBox="0 0 10 10" aria-label="dot"><circle cx="5" cy="5" r="4"/></svg><p>Hi</p>';
    expect(elementMarkupIssue(html)).toBeNull();
    expect(sanitizeElementHtml(html)).toBe(html);
  });

  it('rejects script, iframes and event handlers', () => {
    expect(elementMarkupIssue('<script>alert(1)</script>')).toMatch(/script/);
    expect(elementMarkupIssue('<iframe src="https://evil.test"></iframe>')).toMatch(/iframe/);
    expect(elementMarkupIssue('<img src="https://a.test/a.png" onclick="alert(1)">')).toMatch(/event/);
    expect(elementMarkupIssue('<a href="javascript:alert(1)">x</a>')).toMatch(/javascript/);
  });

  // Attributes start after `/` or a closing quote too, not only after a space.
  it.each([
    '<img src="x"/onerror="alert(1)">',
    '<img src="x"onerror="alert(1)">',
    '<svg/onload="alert(1)"></svg>',
    '<<script></script>img src=x onerror=alert(1)>',
  ])('rejects and strips the event attribute in %s', (html) => {
    expect(elementMarkupIssue(html)).not.toBeNull();
    const cleaned = sanitizeElementHtml(html);
    expect(cleaned).not.toMatch(/onerror|onload/);
    expect(elementMarkupIssue(cleaned)).toBeNull();
  });

  it('reads character references before checking a link scheme', () => {
    expect(elementMarkupIssue('<a href="jav&#x61;script:alert(1)">x</a>')).toMatch(/javascript/);
    expect(elementMarkupIssue('<a href="javascript&colon;alert(1)">x</a>')).toMatch(/javascript/);
    expect(sanitizeElementHtml('<a href="java&Tab;script:alert(1)">x</a>')).toBe('<a  >x</a>');
    expect(elementMarkupIssue('<a href="https://example.org/?a=1&amp;b=2">x</a><img src="/a.png" alt="">')).toBeNull();
  });

  it('strips the unsafe bits so a mixed fragment can still draw', () => {
    const cleaned = sanitizeElementHtml(
      '<p>ok</p><script>alert(1)</script><img src="https://a.test/a.png" onclick="bad()">',
    );
    expect(cleaned).toContain('<p>ok</p>');
    expect(cleaned).not.toContain('script');
    expect(cleaned).not.toContain('onclick');
  });

  it('rejects @import in css and strips it', () => {
    expect(elementMarkupIssue('<p>x</p>', '@import url("https://evil.test/x.css");')).toMatch(/@import/);
    expect(sanitizeElementCss('@import url("https://evil.test/x.css"); p{color:red}')).not.toContain('@import');
  });
});
