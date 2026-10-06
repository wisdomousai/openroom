import { describe, expect, it } from 'vitest';

import {
  estimateTokens,
  htmlToAgentMarkdown,
  negotiateMarkdown,
  parseAccept,
  prefersMarkdown,
} from '../src/markdown-negotiation.js';

describe('parseAccept / prefersMarkdown', () => {
  it('parses q-values', () => {
    expect(parseAccept('text/markdown, text/html;q=0.8, */*;q=0.5')).toEqual([
      { type: 'text/markdown', q: 1 },
      { type: 'text/html', q: 0.8 },
      { type: '*/*', q: 0.5 },
    ]);
  });

  it('prefers markdown for the agent Accept used by isitagentready', () => {
    expect(prefersMarkdown('text/markdown, text/html;q=0.8, */*;q=0.5')).toBe(true);
  });

  it('does not prefer markdown for a normal browser Accept', () => {
    expect(
      prefersMarkdown(
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      ),
    ).toBe(false);
  });

  it('defaults to HTML when Accept is missing or empty', () => {
    expect(prefersMarkdown(null)).toBe(false);
    expect(prefersMarkdown('')).toBe(false);
  });

  it('loses when text/html has a higher q than text/markdown', () => {
    expect(prefersMarkdown('text/html, text/markdown;q=0.1')).toBe(false);
  });
});

describe('htmlToAgentMarkdown', () => {
  it('preserves reference columns, escaped cell separators, and screenshot descriptions', () => {
    const { markdown } = htmlToAgentMarkdown(`<html><body><main><h1>Access</h1>
      <table><thead><tr><th>Role</th><th>Access</th></tr></thead><tbody>
      <tr><td>Editor</td><td><strong>Read | write</strong></td></tr>
      <tr><td>Presenter</td><td><a href="/docs/present/">Present</a></td></tr></tbody></table>
      <img src="/docs/images/library.png" alt="Library and selected deck">
      </main></body></html>`);
    expect(markdown).toContain('| Role | Access |\n| --- | --- |');
    expect(markdown).toContain('| Editor | **Read \\| write** |');
    expect(markdown).toContain('| Presenter | [Present](/docs/present/) |');
    expect(markdown).toContain('![Library and selected deck](/docs/images/library.png)');
  });

  const sample = `<!doctype html>
<html><head>
<title>OpenRoom — free polls</title>
<meta name="description" content="Agent-native classroom polls.">
<meta property="og:image" content="https://openroom.app/og.png">
<script type="application/ld+json">{"@type":"WebSite","name":"OpenRoom"}</script>
</head>
<body>
<nav class="topnav"><a href="/">Home</a></nav>
<main>
  <h1>Live polls for the classroom</h1>
  <p>OpenRoom is <strong>free</strong>. Read the <a href="/docs/">docs</a>.</p>
  <ul><li>Choice</li><li>Scale</li></ul>
  <div class="stage-mock" aria-hidden="true"><p>Ignore me</p></div>
</main>
<footer class="site"><p>Footer chrome</p></footer>
</body></html>`;

  it('emits frontmatter, stripped body, and JSON-LD', () => {
    const { markdown, tokens } = htmlToAgentMarkdown(sample);
    expect(markdown).toContain('---\n');
    expect(markdown).toContain('title: OpenRoom — free polls');
    expect(markdown).toContain('description: Agent-native classroom polls.');
    expect(markdown).toContain('image: "https://openroom.app/og.png"');
    expect(markdown).toContain('# Live polls for the classroom');
    expect(markdown).toContain('**free**');
    expect(markdown).toContain('[docs](/docs/)');
    expect(markdown).toContain('- Choice');
    expect(markdown).toContain('```json');
    expect(markdown).toContain('"@type":"WebSite"');
    expect(markdown).not.toContain('Home');
    expect(markdown).not.toContain('Footer chrome');
    expect(markdown).not.toContain('Ignore me');
    expect(tokens).toBe(estimateTokens(markdown));
  });
});

describe('negotiateMarkdown', () => {
  const htmlBody = `<!doctype html><html><head><title>Hi</title></head>
<body><h1>Hello</h1><p>World</p></body></html>`;

  it('returns markdown for Accept: text/markdown on HTML assets', async () => {
    const request = new Request('https://openroom.app/', {
      headers: { accept: 'text/markdown, text/html;q=0.8, */*;q=0.5' },
    });
    const asset = new Response(htmlBody, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const res = await negotiateMarkdown(request, asset);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('vary')?.toLowerCase()).toContain('accept');
    expect(res.headers.get('x-markdown-tokens')).toMatch(/^\d+$/);
    const body = await res.text();
    expect(body).toContain('# Hello');
    expect(body).not.toContain('<html');
  });

  it('keeps HTML for browsers and still sets Vary: Accept', async () => {
    const request = new Request('https://openroom.app/', {
      headers: { accept: 'text/html' },
    });
    const asset = new Response(htmlBody, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const res = await negotiateMarkdown(request, asset);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('vary')?.toLowerCase()).toContain('accept');
    expect(await res.text()).toContain('<html');
  });

  it('skips SPA shells under /host/', async () => {
    const request = new Request('https://openroom.app/host/', {
      headers: { accept: 'text/markdown' },
    });
    const asset = new Response(htmlBody, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const res = await negotiateMarkdown(request, asset);
    expect(res.headers.get('content-type')).toContain('text/html');
  });
});
