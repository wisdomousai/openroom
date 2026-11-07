/**
 * Accept: text/markdown content negotiation for agent-readable pages.
 *
 * Agents prefer formatting-stripped Markdown on the same URL browsers use for
 * HTML. Shape mirrors Cloudflare Markdown for Agents: YAML frontmatter from
 * meta tags, body content with chrome stripped, JSON-LD preserved at the end.
 *
 * @see https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
 * @see https://isitagentready.com/.well-known/agent-skills/markdown-negotiation/SKILL.md
 */

export const MAX_HTML_BYTES = 2_097_152;

/** Paths that are SPA shells — converting empty app chrome is not useful. */
const SKIP_PREFIXES = ['/host', '/join', '/stage'];

type AcceptType = { type: string; q: number };

/** Parse an Accept header into media types with q-values (default q=1). */
export function parseAccept(header: string): AcceptType[] {
  const out: AcceptType[] = [];
  for (const part of header.split(',')) {
    const segments = part.trim().split(';').map((s) => s.trim());
    const type = segments[0]?.toLowerCase();
    if (!type) continue;
    let q = 1;
    for (const param of segments.slice(1)) {
      const match = /^q\s*=\s*([0-9.]+)$/i.exec(param);
      if (match) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed)) q = parsed;
      }
    }
    out.push({ type, q });
  }
  return out;
}

/**
 * True when the client explicitly prefers text/markdown over text/html.
 * Browsers never send text/markdown; agents typically send markdown first,
 * then HTML at q=0.8 and a wildcard at q=0.5.
 */
export function prefersMarkdown(acceptHeader: string | null): boolean {
  if (acceptHeader === null || acceptHeader.trim() === '') return false;
  const types = parseAccept(acceptHeader);
  const md = types.find((t) => t.type === 'text/markdown');
  if (!md || md.q <= 0) return false;
  const html = types.find((t) => t.type === 'text/html');
  const htmlQ = html?.q ?? 0;
  return md.q >= htmlQ;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)));
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/*
 * Tag scanning.
 *
 * Pages come from any host, so the extractor must stay linear in the page. A
 * regex like `<p\b[^>]*>([\s\S]*?)<\/p>` is not: from every opener that has no
 * closer it rescans the rest of the page. These helpers find the same matches,
 * but remember where each closer next occurs, so the page is read once per
 * pass. Where hostile markup nests `<` inside a tag, they skip the whole tag
 * rather than retry from every `<` in it.
 */

type Span = [start: number, end: number];

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

/** A forward search that remembers its last answer. Callers search from increasing offsets. */
function forward(find: (from: number) => Span | null): (from: number) => Span | null {
  let last: Span | null = null;
  let exhausted = false;
  return (from) => {
    if (exhausted) return null;
    if (last !== null && last[0] >= from) return last;
    last = find(from);
    if (last === null) exhausted = true;
    return last;
  };
}

function literal(lowered: string, needle: string): (from: number) => Span | null {
  return forward((from) => {
    const at = lowered.indexOf(needle, from);
    return at === -1 ? null : [at, at + needle.length];
  });
}

/** `<\/[^>]+>`: the next end tag of any name. */
function anyEndTag(html: string): (from: number) => Span | null {
  const gt = literal(html, '>');
  return forward((from) => {
    for (let at = html.indexOf('</', from); at !== -1; at = html.indexOf('</', at + 1)) {
      if (html[at + 2] === '>') continue;
      const close = gt(at + 2);
      return close === null ? null : [at, close[1]];
    }
    return null;
  });
}

interface PairSpec {
  /** Global regex for the opening `<name` (no `[^>]*`); the tag runs to the next `>`. */
  open: RegExp;
  /** Sticky regex that must follow the opening tag, for `<pre…>\s*<code…>`. */
  then?: RegExp;
  /** Only tags this accepts open a pair. */
  accept?: (tag: string) => boolean;
  /**
   * Closing tags in order; each group runs lazily to the next one. A string is
   * a lowercase literal (`'</*>'` is any end tag); a regex must be global.
   */
  close: (match: RegExpExecArray) => (string | RegExp)[];
  /** Replacement; `groups` are the text between the tags. */
  replace: (groups: string[], tag: string, match: RegExpExecArray) => string;
}

/** `html.replace(/<open…>(…?)<close>/gi, …)` without the rescans. */
function replacePairs(html: string, spec: PairSpec): string {
  const lowered = asciiLower(html);
  const gt = literal(html, '>');
  const closers = new Map<string, (from: number) => Span | null>();
  const closer = (needle: string | RegExp) => {
    const key = needle instanceof RegExp ? `/${needle.source}/` : needle;
    let find = closers.get(key);
    if (find === undefined) {
      if (needle instanceof RegExp) {
        find = forward((from) => {
          needle.lastIndex = from;
          const match = needle.exec(html);
          return match === null ? null : [match.index, match.index + match[0].length];
        });
      } else {
        find = needle === '</*>' ? anyEndTag(html) : literal(lowered, needle);
      }
      closers.set(key, find);
    }
    return find;
  };
  const out: string[] = [];
  let copied = 0;
  spec.open.lastIndex = 0;
  for (let match = spec.open.exec(html); match !== null; match = spec.open.exec(html)) {
    const first = gt(spec.open.lastIndex);
    if (first === null) break;
    let tagEnd = first[1];
    spec.open.lastIndex = tagEnd;
    if (spec.then !== undefined) {
      spec.then.lastIndex = tagEnd;
      if (!spec.then.test(html)) continue;
      const second = gt(spec.then.lastIndex);
      if (second === null) break;
      tagEnd = second[1];
    }
    const tag = html.slice(match.index, tagEnd);
    if (spec.accept !== undefined && !spec.accept(tag)) continue;
    const groups: string[] = [];
    let at = tagEnd;
    let found = true;
    for (const needle of spec.close(match)) {
      const span = closer(needle)(at);
      if (span === null) {
        found = false;
        break;
      }
      groups.push(html.slice(at, span[0]));
      at = span[1];
    }
    if (!found) continue;
    out.push(html.slice(copied, match.index), spec.replace(groups, tag, match));
    copied = at;
    spec.open.lastIndex = at;
  }
  out.push(html.slice(copied));
  return out.join('');
}

/** `html.replace(/<open[^>]*>/gi, …)` without the rescans. */
function replaceTags(html: string, open: RegExp, replace: (tag: string) => string): string {
  const gt = literal(html, '>');
  const out: string[] = [];
  let copied = 0;
  open.lastIndex = 0;
  for (let match = open.exec(html); match !== null; match = open.exec(html)) {
    const close = gt(open.lastIndex);
    if (close === null) break;
    out.push(html.slice(copied, match.index), replace(html.slice(match.index, close[1])));
    copied = close[1];
    open.lastIndex = close[1];
  }
  out.push(html.slice(copied));
  return out.join('');
}

/** `html.replace(/<[^>]+>/g, '')`. */
function stripTags(html: string): string {
  const out: string[] = [];
  let copied = 0;
  let at = html.indexOf('<');
  while (at !== -1) {
    const close = html.indexOf('>', at + 1);
    if (close === -1) break;
    if (close > at + 1) {
      out.push(html.slice(copied, at));
      copied = close + 1;
      at = html.indexOf('<', close + 1);
    } else {
      at = html.indexOf('<', at + 1);
    }
  }
  out.push(html.slice(copied));
  return out.join('');
}

/** Every `<open…>…<close>` pair's inner text. */
function innerOf(html: string, open: RegExp, close: (match: RegExpExecArray) => string | RegExp): string[] {
  const found: string[] = [];
  replacePairs(html, {
    open,
    close: (match) => [close(match)],
    replace: ([inner]) => {
      found.push(inner ?? '');
      return '';
    },
  });
  return found;
}

function metaContent(html: string, attrName: 'name' | 'property', value: string): string | null {
  const named = new RegExp(`\\b${attrName}\\s*=\\s*["']${value}["']`, 'i');
  let content: string | null = null;
  replaceTags(html, /<meta\b/gi, (tag) => {
    if (content === null && named.test(tag)) content = attr(tag, 'content');
    return '';
  });
  return content;
}

function titleFromHtml(html: string): string | null {
  const text = innerOf(html, /<title/gi, () => '</title>')[0];
  return text !== undefined ? decodeEntities(text.replace(/\s+/g, ' ').trim()) : null;
}

function extractJsonLd(html: string): string[] {
  const blocks: string[] = [];
  replacePairs(html, {
    open: /<script\b/gi,
    accept: (tag) => /type\s*=\s*["']application\/ld\+json["']/i.test(tag),
    close: () => ['</script>'],
    replace: ([inner]) => {
      const raw = inner?.trim();
      if (raw) blocks.push(raw);
      return '';
    },
  });
  return blocks;
}

function dropPairs(html: string, open: RegExp, close: string, accept?: (tag: string) => boolean): string {
  return replacePairs(html, { open, accept, close: () => [close], replace: () => '' });
}

function stripChrome(html: string): string {
  let out = html;
  // Drop head; we already pulled meta / JSON-LD from the full document.
  out = dropPairs(out, /<head\b/gi, '</head>');
  // Chrome Cloudflare also strips: nav, footer, script, style, noscript.
  for (const tag of ['script', 'style', 'noscript', 'svg', 'footer']) {
    out = dropPairs(out, new RegExp(`<${tag}\\b`, 'gi'), `</${tag}>`);
    out = replaceTags(out, new RegExp(`<${tag}\\b`, 'gi'), () => '');
  }
  // Top site nav only — keep docs TOC (`nav.toc`) as structured links.
  out = dropPairs(out, /<aside\b/gi, '</aside>', (tag) => /\bclass\s*=\s*["'][^"']*\bmanual-sidebar\b/i.test(tag));
  out = dropPairs(out, /<nav\b/gi, '</nav>', (tag) => /\bclass\s*=\s*["'][^"']*\btopnav\b/i.test(tag));
  out = dropPairs(out, /<nav\b/gi, '</nav>', (tag) => !/\btoc\b/i.test(tag));
  // Decorative / mock UI.
  out = dropPairs(out, /<[^>]/g, '</*>', (tag) => /aria-hidden\s*=\s*["']true["']/i.test(tag.slice(2)));
  return bodyOf(out) ?? out;
}

/** `/<body\b[^>]*>([\s\S]*)<\/body>/i`: the first body tag to the last closer. */
function bodyOf(html: string): string | null {
  const open = /<body\b/i.exec(html);
  if (open === null) return null;
  const close = html.indexOf('>', open.index + 5);
  const end = asciiLower(html).lastIndexOf('</body>');
  if (close === -1 || end <= close) return null;
  return html.slice(close + 1, end);
}

/** Each line's trailing spaces and tabs, then runs of blank lines. */
function collapseBlankLines(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let end = line.length;
      while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end -= 1;
      return line.slice(0, end);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lines joined by single spaces, blank ones dropped. A regex over the spaces would backtrack. */
function joinLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');
}

function fencedCode(code: string): string {
  const text = decodeEntities(stripTags(code));
  return `\n\n\`\`\`\n${text.replace(/\n$/, '')}\n\`\`\`\n\n`;
}

/** Convert a content HTML fragment into Markdown (best-effort, static pages). */
export function fragmentToMarkdown(fragment: string): string {
  let html = fragment;

  // Preserve reference-table relationships in the negotiated manual edition.
  html = replacePairs(html, {
    open: /<table\b/gi,
    close: () => ['</table>'],
    replace: ([table = '']) => {
      const rows = innerOf(table, /<tr\b/gi, () => '</tr>').map((row) =>
        innerOf(row, /<t[hd]\b/gi, () => /<\/t[hd]>/gi).map((cell) =>
          joinLines(inlineToMarkdown(cell).replace(/\|/g, '\\|'))),
      ).filter((row) => row.length);
      if (!rows.length) return '';
      const width = Math.max(...rows.map((row) => row.length));
      const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
      return `\n\n${line(rows[0]!)}\n${line(Array(width).fill('---'))}\n${rows.slice(1).map(line).join('\n')}\n\n`;
    },
  });

  // Fenced code first (preserve inner markup as text).
  html = replacePairs(html, {
    open: /<pre\b/gi,
    then: /\s*<code\b/iy,
    close: () => [/<\/code>\s*<\/pre>/gi],
    replace: ([code = '']) => fencedCode(code),
  });
  html = replacePairs(html, { open: /<pre\b/gi, close: () => ['</pre>'], replace: ([code = '']) => fencedCode(code) });

  html = replacePairs(html, {
    open: /<h([1-6])\b/gi,
    close: (match) => [`</h${match[1]!}>`],
    replace: ([inner = ''], _tag, match) => `\n\n${'#'.repeat(Number(match[1]))} ${inlineToMarkdown(inner).trim()}\n\n`,
  });

  html = replacePairs(html, {
    open: /<blockquote\b/gi,
    close: () => ['</blockquote>'],
    replace: ([inner = '']) => {
      const text = fragmentToMarkdown(inner)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
      return `\n\n${text}\n\n`;
    },
  });

  html = replacePairs(html, {
    open: /<li\b/gi,
    close: () => ['</li>'],
    replace: ([inner = '']) => `\n- ${inlineToMarkdown(inner).replace(/\n+/g, ' ').trim()}`,
  });
  html = replaceTags(html, /<\/?(?:ul|ol)\b/gi, () => '\n\n');

  html = replacePairs(html, {
    open: /<p\b/gi,
    close: () => ['</p>'],
    replace: ([inner = '']) => `\n\n${inlineToMarkdown(inner).trim()}\n\n`,
  });

  html = html.replace(/<br\s*\/?>/gi, '  \n');
  html = html.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // details/summary → bold summary + body
  html = replacePairs(html, {
    open: /<details\b/gi,
    then: /\s*<summary\b/iy,
    close: () => ['</summary>', '</details>'],
    replace: ([summary = '', body = '']) =>
      `\n\n**${inlineToMarkdown(summary).trim()}**\n\n${fragmentToMarkdown(body)}\n\n`,
  });

  // Drop remaining block wrappers; keep their text.
  html = replaceTags(html, /<\/?(?:div|section|article|main|header|span|figure|figcaption)\b/gi, () => '\n');

  // Any leftover tags → text / strip.
  html = inlineToMarkdown(html);
  return collapseBlankLines(decodeEntities(html));
}

function inlineToMarkdown(inner: string): string {
  let html = inner;
  html = replaceTags(html, /<img\b/gi, (tag) => {
    const src = attr(tag, 'src');
    const alt = (attr(tag, 'alt') ?? '').replace(/[\[\]]/g, '');
    return src ? `![${alt}](${src})` : alt;
  });
  html = replacePairs(html, {
    open: /<a\b/gi,
    close: () => ['</a>'],
    replace: ([text = ''], tag) => {
      const href = attr(tag, 'href');
      const label = inlineToMarkdown(text).trim();
      if (!href || href.startsWith('javascript:')) return label;
      return `[${label}](${href})`;
    },
  });
  html = replacePairs(html, {
    open: /<(strong|b)\b/gi,
    close: (match) => [`</${match[1]!.toLowerCase()}>`],
    replace: ([text = '']) => `**${inlineToMarkdown(text)}**`,
  });
  html = replacePairs(html, {
    open: /<(em|i)\b/gi,
    close: (match) => [`</${match[1]!.toLowerCase()}>`],
    replace: ([text = '']) => `*${inlineToMarkdown(text)}*`,
  });
  html = replacePairs(html, {
    open: /<code\b/gi,
    close: () => ['</code>'],
    replace: ([text = '']) => `\`${decodeEntities(stripTags(text))}\``,
  });
  html = stripTags(html);
  return decodeEntities(html);
}

/** Estimated token count — same ballpark heuristic agents use (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function htmlToAgentMarkdown(html: string): { markdown: string; tokens: number } {
  const title = titleFromHtml(html) ?? metaContent(html, 'property', 'og:title');
  const description =
    metaContent(html, 'name', 'description') ?? metaContent(html, 'property', 'og:description');
  const image = metaContent(html, 'property', 'og:image');
  const jsonLd = extractJsonLd(html);

  const front: string[] = [];
  if (title) front.push(`title: ${yamlScalar(title)}`);
  if (description) front.push(`description: ${yamlScalar(description)}`);
  if (image) front.push(`image: ${yamlScalar(image)}`);

  const body = fragmentToMarkdown(stripChrome(html));
  const parts: string[] = [];
  if (front.length > 0) {
    parts.push(`---\n${front.join('\n')}\n---`, '');
  }
  if (body) parts.push(body);
  if (jsonLd.length > 0) {
    parts.push('', '```json', jsonLd.join('\n'), '```');
  }
  const markdown = collapseBlankLines(parts.join('\n')) + '\n';
  return { markdown, tokens: estimateTokens(markdown) };
}

/**
 * The same extraction, without the agent frontmatter.
 *
 * `htmlToAgentMarkdown` answers an `Accept: text/markdown` request, so it leads
 * with YAML an agent can read. Reading material on a slide wants the prose and
 * nothing else, with the page title handed back separately for the element's
 * accessible name.
 */
export function pageToReadingMarkdown(html: string): { title: string | null; markdown: string } {
  return {
    title: titleFromHtml(html) ?? metaContent(html, 'property', 'og:title'),
    markdown: collapseBlankLines(fragmentToMarkdown(stripChrome(html))),
  };
}

function yamlScalar(value: string): string {
  // Quote when YAML-special characters appear.
  if (/[:#{}[\],&*!|>'"%@`]|^\s|\s$/.test(value) || value === '' || /[\n\r]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes('text/html');
}

function shouldSkipPath(pathname: string): boolean {
  return SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * If the request prefers Markdown and the asset response is HTML, return a
 * Markdown representation. Otherwise return the original response unchanged
 * (with Vary: Accept so caches keep HTML/Markdown variants separate).
 */
export async function negotiateMarkdown(request: Request, response: Response): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers(response.headers);
  appendVary(headers, 'Accept');

  if (
    request.method !== 'GET' &&
    request.method !== 'HEAD'
  ) {
    return new Response(response.body, { status: response.status, headers });
  }

  if (!prefersMarkdown(request.headers.get('accept'))) {
    return new Response(response.body, { status: response.status, headers });
  }

  if (shouldSkipPath(url.pathname) || response.status !== 200 || !isHtmlContentType(headers.get('content-type'))) {
    return new Response(response.body, { status: response.status, headers });
  }

  const buf = await response.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_HTML_BYTES) {
    return new Response(buf, { status: response.status, headers });
  }

  const html = new TextDecoder().decode(buf);
  const { markdown, tokens } = htmlToAgentMarkdown(html);

  headers.set('content-type', 'text/markdown; charset=utf-8');
  headers.set('x-markdown-tokens', String(tokens));
  // Body changed — drop validators that described the HTML.
  headers.delete('content-length');
  headers.delete('etag');
  headers.delete('last-modified');
  headers.delete('content-encoding');

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(markdown, { status: 200, headers });
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get('vary');
  if (!existing) {
    headers.set('vary', value);
    return;
  }
  const parts = existing.split(',').map((s) => s.trim().toLowerCase());
  if (!parts.includes(value.toLowerCase())) {
    headers.set('vary', `${existing}, ${value}`);
  }
}
