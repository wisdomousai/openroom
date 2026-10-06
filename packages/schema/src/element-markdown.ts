/**
 * Markdown → HTML for reading-material elements.
 *
 * One implementation for the validator, CLI, MCP, and the browser host — the
 * deliberate mirror of the worker's `fragmentToMarkdown`, so a page imported as
 * Markdown renders back to the same shape it was read from.
 *
 * Two properties this file must keep, because `elementMarkupIssue` enforces
 * `html === renderMarkdownToHtml(markdown)`:
 *
 * 1. **Deterministic.** Same input, same bytes out, forever. A change to the
 *    output shape invalidates every stored element, so treat it as a migration.
 * 2. **Safe by construction.** Text is escaped and only the tags below are ever
 *    emitted, so the result always passes `htmlLooksUnsafe` without a strip pass.
 */

/** Tags this renderer may emit. Nothing here is in `FORBIDDEN_TAGS`. */
const BLOCK_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr'];

/**
 * Code-span placeholder. A NUL cannot appear in authored Markdown and passes
 * through `escapeHtmlText` untouched, so it cannot collide with ordinary text
 * the way a bare number would. Built rather than typed: a literal control
 * character in source does not survive editors and patch tools intact.
 */
const CODE_SLOT = String.fromCharCode(0);
const CODE_SLOT_PATTERN = new RegExp(`${CODE_SLOT}(\\d+)${CODE_SLOT}`, 'g');

/**
 * Escape a text span.
 *
 * `=` is escaped along with the usual four. It is not a security requirement —
 * the angle brackets already are — but `htmlLooksUnsafe` and
 * `sanitizeElementHtml` match ` on&lt;word&gt;=` anywhere in the string, so reading
 * material that merely *mentions* `onerror=` would be rejected as an event
 * attribute and then silently mangled at render time. Escaping the `=` keeps
 * prose about HTML storable, and `&#61;` renders as `=` in text and decodes to
 * `=` inside an attribute value.
 */
export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/=/g, '&#61;');
}

/**
 * Only https URLs survive into an `href`/`src`. Anything else keeps its label as
 * plain text — a link whose target the teacher cannot see is worse than no link.
 */
function safeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.toString();
}

/**
 * Inline pass. Code spans are lifted out first and put back last, so their
 * contents are never read as emphasis or as a link.
 */
function renderInline(source: string): string {
  const codeSpans: string[] = [];
  let text = source.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push(`<code>${escapeHtmlText(code)}</code>`);
    return `${CODE_SLOT}${String(codeSpans.length - 1)}${CODE_SLOT}`;
  });

  text = escapeHtmlText(text);

  // Images before links: the syntax differs only by the leading `!`.
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string, href: string) => {
    const url = safeUrl(href);
    if (url === null) return alt;
    return `<img src="${escapeHtmlText(url)}" alt="${alt}" />`;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    const url = safeUrl(href);
    if (url === null) return label;
    return `<a href="${escapeHtmlText(url)}" rel="noreferrer noopener" target="_blank">${label}</a>`;
  });

  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  // Two trailing spaces before a newline is Markdown's hard break.
  text = text.replace(/ {2}\n/g, '<br />\n');

  return text.replace(CODE_SLOT_PATTERN, (_match, index: string) => codeSpans[Number(index)] ?? '');
}

/** Group the source into blocks, then render each. Line-based, no backtracking. */
export function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let index = 0;

  const paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${renderInline(paragraph.join('\n').trim())}</p>`);
    paragraph.length = 0;
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      flushParagraph();
      index += 1;
      continue;
    }

    // Fenced code. Everything up to the closing fence is literal text.
    if (/^```/.test(line)) {
      flushParagraph();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1; // the closing fence, or the end of the source
      out.push(`<pre><code>${escapeHtmlText(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      const level = String(heading[1]?.length ?? 1);
      out.push(`<h${level}>${renderInline((heading[2] ?? '').trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph();
      out.push('<hr />');
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index += 1;
      }
      out.push(`<blockquote>${renderMarkdownToHtml(quoted.join('\n'))}</blockquote>`);
      continue;
    }

    const BULLET = /^\s*[-*+]\s+(.*)$/;
    const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
    const bulleted = BULLET.test(line);
    if (bulleted || ORDERED.test(line)) {
      flushParagraph();
      const tag = bulleted ? 'ul' : 'ol';
      const pattern = bulleted ? BULLET : ORDERED;
      const items: string[] = [];
      while (index < lines.length) {
        const match = pattern.exec(lines[index] ?? '');
        if (match === null) break;
        items.push(`<li>${renderInline((match[1] ?? '').trim())}</li>`);
        index += 1;
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return out.join('\n');
}

/** Every tag the renderer can produce. Exported so the safety test can assert the set. */
export const MARKDOWN_OUTPUT_TAGS: readonly string[] = [...BLOCK_TAGS, 'strong', 'em', 'a', 'img', 'br'];
