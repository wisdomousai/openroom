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

function metaContent(html: string, attrName: 'name' | 'property', value: string): string | null {
  const re = new RegExp(
    `<meta\\b[^>]*\\b${attrName}\\s*=\\s*["']${value}["'][^>]*>`,
    'i',
  );
  const tag = re.exec(html)?.[0];
  if (!tag) {
    // Attribute order may put content before name/property.
    const re2 = new RegExp(
      `<meta\\b[^>]*\\bcontent\\s*=\\s*(["'])([\\s\\S]*?)\\1[^>]*\\b${attrName}\\s*=\\s*["']${value}["'][^>]*>`,
      'i',
    );
    const m2 = re2.exec(html);
    const content = m2?.[2];
    return content !== undefined ? decodeEntities(content) : null;
  }
  return attr(tag, 'content');
}

function titleFromHtml(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const text = m?.[1];
  return text !== undefined ? decodeEntities(text.replace(/\s+/g, ' ').trim()) : null;
}

function extractJsonLd(html: string): string[] {
  const blocks: string[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (raw) blocks.push(raw);
  }
  return blocks;
}

function stripChrome(html: string): string {
  let out = html;
  // Drop head; we already pulled meta / JSON-LD from the full document.
  out = out.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');
  // Chrome Cloudflare also strips: nav, footer, script, style, noscript.
  for (const tag of ['script', 'style', 'noscript', 'svg', 'footer']) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
  }
  // Top site nav only — keep docs TOC (`nav.toc`) as structured links.
  out = out.replace(/<aside\b[^>]*\bclass\s*=\s*["'][^"']*\bmanual-sidebar\b[^"']*["'][^>]*>[\s\S]*?<\/aside>/gi, '');
  out = out.replace(/<nav\b[^>]*\bclass\s*=\s*["'][^"']*\btopnav\b[^"']*["'][^>]*>[\s\S]*?<\/nav>/gi, '');
  out = out.replace(/<nav\b(?![^>]*\btoc\b)[^>]*>[\s\S]*?<\/nav>/gi, '');
  // Decorative / mock UI.
  out = out.replace(/<[^>]+aria-hidden\s*=\s*["']true["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '');
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(out);
  return body?.[1] ?? out;
}

function collapseBlankLines(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Convert a content HTML fragment into Markdown (best-effort, static pages). */
export function fragmentToMarkdown(fragment: string): string {
  let html = fragment;

  // Preserve reference-table relationships in the negotiated manual edition.
  html = html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_match, table: string) => {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1]!.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) =>
        inlineToMarkdown(cell[1]!).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()),
    ).filter((row) => row.length);
    if (!rows.length) return '';
    const width = Math.max(...rows.map((row) => row.length));
    const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
    return `\n\n${line(rows[0]!)}\n${line(Array(width).fill('---'))}\n${rows.slice(1).map(line).join('\n')}\n\n`;
  });

  // Fenced code first (preserve inner markup as text).
  html = html.replace(/<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_m, code: string) => {
    const text = decodeEntities(code.replace(/<[^>]+>/g, ''));
    return `\n\n\`\`\`\n${text.replace(/\n$/, '')}\n\`\`\`\n\n`;
  });
  html = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, code: string) => {
    const text = decodeEntities(code.replace(/<[^>]+>/g, ''));
    return `\n\n\`\`\`\n${text.replace(/\n$/, '')}\n\`\`\`\n\n`;
  });

  html = html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    const text = inlineToMarkdown(inner).trim();
    return `\n\n${'#'.repeat(Number(level))} ${text}\n\n`;
  });

  html = html.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
    const text = fragmentToMarkdown(inner)
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n');
    return `\n\n${text}\n\n`;
  });

  html = html.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => {
    const text = inlineToMarkdown(inner).replace(/\n+/g, ' ').trim();
    return `\n- ${text}`;
  });
  html = html.replace(/<\/?(?:ul|ol)\b[^>]*>/gi, '\n\n');

  html = html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner: string) => {
    return `\n\n${inlineToMarkdown(inner).trim()}\n\n`;
  });

  html = html.replace(/<br\s*\/?>/gi, '  \n');
  html = html.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // details/summary → bold summary + body
  html = html.replace(
    /<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,
    (_m, summary: string, body: string) => {
      return `\n\n**${inlineToMarkdown(summary).trim()}**\n\n${fragmentToMarkdown(body)}\n\n`;
    },
  );

  // Drop remaining block wrappers; keep their text.
  html = html.replace(/<\/?(?:div|section|article|main|header|span|figure|figcaption)\b[^>]*>/gi, '\n');

  // Any leftover tags → text / strip.
  html = inlineToMarkdown(html);
  return collapseBlankLines(decodeEntities(html));
}

function inlineToMarkdown(inner: string): string {
  let html = inner;
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = attr(tag, 'src');
    const alt = (attr(tag, 'alt') ?? '').replace(/[\[\]]/g, '');
    return src ? `![${alt}](${src})` : alt;
  });
  html = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, tagAttrs: string, text: string) => {
    const href = attr(`<a ${tagAttrs}>`, 'href');
    const label = inlineToMarkdown(text).trim();
    if (!href || href.startsWith('javascript:')) return label;
    return `[${label}](${href})`;
  });
  html = html.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, t: string) => `**${inlineToMarkdown(t)}**`);
  html = html.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, t: string) => `*${inlineToMarkdown(t)}*`);
  html = html.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, t: string) => {
    const text = decodeEntities(t.replace(/<[^>]+>/g, ''));
    return `\`${text}\``;
  });
  html = html.replace(/<[^>]+>/g, '');
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
