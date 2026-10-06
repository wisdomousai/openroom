import { describe, expect, it } from 'vitest';

import { elementMarkupIssue, htmlLooksUnsafe, sanitizeElementHtml } from '../src/element-html.js';
import { renderMarkdownToHtml } from '../src/element-markdown.js';
import { ELEMENT_MARKDOWN_MAX } from '../src/outline-types.js';

describe('markdown renderer', () => {
  it('renders the block shapes the worker importer emits', () => {
    const html = renderMarkdownToHtml(
      ['# Title', '', 'A line.', '', '- one', '- two', '', '1. first', '', '> quoted', '', '```', 'a < b', '```', '', '---'].join('\n'),
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>A line.</p>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>first</li></ol>');
    expect(html).toContain('<blockquote><p>quoted</p></blockquote>');
    expect(html).toContain('<pre><code>a &lt; b</code></pre>');
    expect(html).toContain('<hr />');
  });

  it('renders inline emphasis, code, and links', () => {
    const html = renderMarkdownToHtml('**b** and *i* and `c` and [l](https://example.test/a)');
    expect(html).toContain('<strong>b</strong>');
    expect(html).toContain('<em>i</em>');
    expect(html).toContain('<code>c</code>');
    expect(html).toContain('href="https://example.test/a"');
  });

  it('never lets a code span be reparsed as emphasis or a link', () => {
    expect(renderMarkdownToHtml('`a *b* [c](https://x.test)`')).toBe(
      '<p><code>a *b* [c](https://x.test)</code></p>',
    );
  });

  // Security: the renderer is the only thing standing between imported page text
  // and a slide, so nothing may reach the output as live markup.
  it('escapes markup in the source rather than passing it through', () => {
    const html = renderMarkdownToHtml('Text <script>alert(1)</script> and <img onerror=x>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;script&gt;');
  });

  // Tutoring content *about* HTML is ordinary. The sanitiser's event-attribute
  // heuristic matches ` on<word>=` anywhere in the string, so unless the renderer escapes
  // the `=`, such a page is rejected as unsafe and mangled at render time.
  it('keeps reading material that merely mentions an event attribute storable', () => {
    const html = renderMarkdownToHtml('Never write `<img onerror=alert(1)>` in your page.');
    expect(htmlLooksUnsafe(html)).toBeNull();
    expect(sanitizeElementHtml(html)).toBe(html);
  });

  it('drops links and images that are not https, keeping their text', () => {
    for (const source of [
      '[go](http://plain.test)',
      '[go](javascript:alert(1))',
      '[go](https://user:pw@x.test/)',
      '![go](http://plain.test/a.png)',
    ]) {
      const html = renderMarkdownToHtml(source);
      expect(html).toContain('go');
      expect(html).not.toContain('<a ');
      expect(html).not.toContain('<img ');
      expect(html).not.toContain('javascript:');
    }
  });

  it('produces output the element sanitiser already accepts and leaves alone', () => {
    const hostile = [
      '# <script>alert(1)</script>',
      '',
      '<iframe src="https://evil.test"></iframe>',
      '',
      '- <style>@import url(x)</style>',
      '',
      '[x](javascript:alert(1))',
    ].join('\n');
    const html = renderMarkdownToHtml(hostile);
    expect(htmlLooksUnsafe(html)).toBeNull();
    expect(sanitizeElementHtml(html)).toBe(html);
  });
});

describe('markdown-backed html element', () => {
  const markdown = '# Reading\n\nA paragraph.';
  const html = renderMarkdownToHtml(markdown);

  it('accepts a pair the renderer produced', () => {
    expect(elementMarkupIssue(html, undefined, markdown)).toBeNull();
  });

  it('rejects html that has drifted from its markdown source', () => {
    expect(elementMarkupIssue(`${html}<p>edited by hand</p>`, undefined, markdown)).toMatch(/rendered form/);
  });

  it('caps the markdown source', () => {
    const long = 'a'.repeat(ELEMENT_MARKDOWN_MAX + 1);
    expect(elementMarkupIssue(renderMarkdownToHtml(long), undefined, long)).toMatch(/at most/);
  });

  it('leaves the plain html element budget alone', () => {
    expect(elementMarkupIssue('<p>hand written</p>')).toBeNull();
  });
});
