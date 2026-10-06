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
