/**
 * Sanitiser for freeform `html` elements.
 *
 * One implementation for the validator, CLI, MCP, and the browser host.
 * Markup is a fragment, not a document. Script never survives.
 *
 * Markup is read with the HTML tokenizer's own rules for where a tag and an
 * attribute begin and end, so `<img src="x"/onerror=…>` or `<svg/onload=…>` is an
 * event attribute here exactly as it is in the browser. Elements that switch
 * the browser's tokenizer into text mode (`<title>`, `<noscript>`, CDATA…) are
 * refused, so for accepted markup this reading and the browser's never differ.
 * The browser host also re-checks the parsed DOM with `elementTagForbidden` and
 * `elementAttributeIssue` before insertion.
 */

import { renderMarkdownToHtml } from './element-markdown.js';
import { ELEMENT_HTML_ABS_MAX, ELEMENT_MARKDOWN_MAX, ELEMENT_MARKUP_MAX } from './outline-types.js';

const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'style',
  'title',
  'xmp',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
  'template',
  'frame',
  'frameset',
  'applet',
]);

/** Elements whose content the browser reads as text up to their own end tag. */
const RAW_TEXT_TAGS = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
]);

/** Attributes the browser resolves as a URL, besides any `…href`. */
const URL_ATTRS = new Set([
  'src',
  'action',
  'formaction',
  'poster',
  'background',
  'cite',
  'ping',
  'data',
  'codebase',
  'longdesc',
  'lowsrc',
  'dynsrc',
  'usemap',
  'manifest',
  'icon',
]);

const URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif)[;,]/i;

const CSS_IMPORT = /@import\b/i;
const CSS_EXPRESSION = /expression\s*\(/i;
const BAD_FONT = /@font-face[\s\S]*url\(\s*(['"]?)(?!https:)/i;

/** True for an element the host never inserts. `name` is a tag or DOM local name. */
export function elementTagForbidden(name: string): boolean {
  return FORBIDDEN_TAGS.has(asciiLower(name));
}

/**
 * Why an attribute must not reach the page, or null if it may. `value` is the
 * decoded value, as the DOM reports it.
 */
export function elementAttributeIssue(name: string, value: string): string | null {
  const lower = asciiLower(name);
  if (lower.startsWith('on') || name.toLowerCase().startsWith('on')) {
    return 'html must not contain event attributes';
  }
  if (lower.endsWith('href') || URL_ATTRS.has(lower)) return urlIssue(value);
  // SVG <animate>/<set> can write a link target after the fact.
  if (lower === 'attributename' && /href/i.test(value)) return 'html must not animate link targets';
  return null;
}

function urlIssue(value: string): string | null {
  // The URL parser drops tabs and newlines anywhere and trims C0 and space.
  const url = value.replace(/[\u0000-\u0020\u007f]+/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1];
  if (scheme === undefined) {
    // Relative, unless a character reference this file does not decode spells a scheme.
    return /^[^/?#]*&/.test(url) ? 'html must not use character references before a URL path' : null;
  }
  const lower = asciiLower(scheme);
  if (URL_SCHEMES.has(lower) || DATA_IMAGE.test(url)) return null;
  return `html must not use ${lower}: URLs`;
}

/* ------------------------------------------------------------------ */
/* Tokenizer                                                           */
/* ------------------------------------------------------------------ */

interface HtmlAttribute {
  name: string;
  /** Raw, still entity-encoded. */
  value: string;
  start: number;
  end: number;
}

type HtmlToken =
  | { kind: 'tag'; name: string; endTag: boolean; attrs: HtmlAttribute[]; start: number; end: number }
  | { kind: 'comment'; start: number; end: number }
  | { kind: 'declaration'; cdata: boolean; start: number; end: number };

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

function isSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\f' || char === '\r';
}

function isAlpha(char: string | undefined): boolean {
  return char !== undefined && /^[A-Za-z]$/.test(char);
}

/** A start or end tag from `start` (the `<`), per the tokenizer's tag and attribute states. */
function readTag(html: string, start: number, endTag: boolean): HtmlToken {
  const length = html.length;
  let at = start + (endTag ? 2 : 1);
  const nameStart = at;
  while (at < length && !isSpace(html[at]) && html[at] !== '/' && html[at] !== '>') at += 1;
  const name = asciiLower(html.slice(nameStart, at));
  const attrs: HtmlAttribute[] = [];
  while (at < length) {
    const char = html[at];
    if (isSpace(char) || char === '/') {
      at += 1;
      continue;
    }
    if (char === '>') return { kind: 'tag', name, endTag, attrs, start, end: at + 1 };
    // Attribute name: the first character is taken whatever it is (even `=`).
    const attrStart = at;
    at += 1;
    while (at < length && !isSpace(html[at]) && html[at] !== '/' && html[at] !== '>' && html[at] !== '=') at += 1;
    const attrName = asciiLower(html.slice(attrStart, at));
    let probe = at;
    while (probe < length && isSpace(html[probe])) probe += 1;
    if (html[probe] !== '=') {
      attrs.push({ name: attrName, value: '', start: attrStart, end: at });
      at = probe;
      continue;
    }
    probe += 1;
    while (probe < length && isSpace(html[probe])) probe += 1;
    const quote = html[probe];
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, probe + 1);
      if (close === -1) break;
      attrs.push({ name: attrName, value: html.slice(probe + 1, close), start: attrStart, end: close + 1 });
      at = close + 1;
    } else {
      let valueEnd = probe;
      while (valueEnd < length && !isSpace(html[valueEnd]) && html[valueEnd] !== '>') valueEnd += 1;
      attrs.push({ name: attrName, value: html.slice(probe, valueEnd), start: attrStart, end: valueEnd });
      at = valueEnd;
    }
  }
  // End of input inside a tag: the browser drops the tag.
  return { kind: 'tag', name, endTag, attrs, start, end: length };
}

/**
 * Every tag, comment and markup declaration in `html`, in order. Text is the
 * gaps between tokens. Linear in the input.
 */
function tokenize(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const length = html.length;
  // Where each comment terminator next occurs. Searching afresh per comment
  // would rescan the tail from every `<!--` when a terminator is missing.
  const nextAt = new Map<string, number>();
  const next = (needle: string, from: number): number => {
    const known = nextAt.get(needle);
    if (known !== undefined && (known === -1 || known >= from)) return known;
    const found = html.indexOf(needle, from);
    nextAt.set(needle, found);
    return found;
  };
  let at = 0;
  while (at < length) {
    const open = html.indexOf('<', at);
    if (open === -1) break;
    const after = html[open + 1];
    if (isAlpha(after)) {
      const tag = readTag(html, open, false);
      tokens.push(tag);
      at = tag.end;
    } else if (after === '/' && isAlpha(html[open + 2])) {
      const tag = readTag(html, open, true);
      tokens.push(tag);
      at = tag.end;
    } else if (html.startsWith('<!--', open)) {
      const body = open + 4;
      let end: number;
      if (html[body] === '>') end = body + 1;
      else if (html.startsWith('->', body)) end = body + 2;
      else {
        const dashClose = next('-->', body);
        const bangClose = next('--!>', body);
        end = Math.min(dashClose === -1 ? length : dashClose + 3, bangClose === -1 ? length : bangClose + 4);
      }
      tokens.push({ kind: 'comment', start: open, end });
      at = end;
    } else if (after === '!' || after === '?' || after === '/') {
      // DOCTYPE and bogus comments end at the first `>`. `</>` is dropped the same way.
      const close = html.indexOf('>', open + 2);
      const end = close === -1 ? length : close + 1;
      tokens.push({ kind: 'declaration', cdata: html.startsWith('<![CDATA[', open), start: open, end });
      at = end;
    } else {
      at = open + 1;
    }
  }
  return tokens;
}

/** End of the raw-text run a `name` start tag opens: after its end tag, or the input end. */
function rawTextEnd(html: string, lowered: string, name: string, from: number): number {
  if (name === 'plaintext') return html.length;
  let at = from;
  for (;;) {
    const close = lowered.indexOf(`</${name}`, at);
    if (close === -1) return html.length;
    const after = html[close + 2 + name.length];
    if (after === undefined || isSpace(after) || after === '/' || after === '>') {
      return readTag(html, close, true).end;
    }
    at = close + 1;
  }
}

const NAMED_REFS: Readonly<Record<string, string>> = {
  amp: '&',
  AMP: '&',
  lt: '<',
  LT: '<',
  gt: '>',
  GT: '>',
  quot: '"',
  QUOT: '"',
  apos: "'",
  nbsp: '\u00a0',
  colon: ':',
  Tab: '\t',
  NewLine: '\n',
  sol: '/',
  num: '#',
  quest: '?',
  period: '.',
  lpar: '(',
  rpar: ')',
};

/**
 * Decode the character references a URL check needs. A named reference not
 * listed stays encoded; `urlIssue` refuses an `&` before the path.
 */
function decodeAttribute(value: string): string {
  return value.replace(/&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([A-Za-z][A-Za-z0-9]*));?/g, (match, hex?: string, dec?: string, name?: string) => {
    if (name !== undefined) return NAMED_REFS[name] ?? match;
    const code = Number.parseInt(hex ?? dec ?? '', hex !== undefined ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
  });
}

function tagIssue(token: HtmlToken & { kind: 'tag' }): string | null {
  if (FORBIDDEN_TAGS.has(token.name)) return `html must not contain <${token.name}>`;
  for (const attr of token.attrs) {
    const issue = elementAttributeIssue(attr.name, decodeAttribute(attr.value));
    if (issue !== null) return issue;
  }
  return null;
}

export function htmlLooksUnsafe(html: string): string | null {
  // Substring checks first: they also catch a forbidden tag hidden where the
  // tokenizer below would read text, which is what keeps the two readings equal.
  const lowered = asciiLower(html);
  for (const tag of FORBIDDEN_TAGS) {
    if (lowered.includes(`<${tag}`) || lowered.includes(`</${tag}`)) {
      return `html must not contain <${tag}>`;
    }
  }
  if (lowered.includes('<![cdata[')) return 'html must not contain CDATA sections';
  for (const token of tokenize(html)) {
    if (token.kind !== 'tag') continue;
    const issue = tagIssue(token);
    if (issue !== null) return issue;
  }
  return null;
}

export function cssLooksUnsafe(css: string): string | null {
  if (CSS_IMPORT.test(css)) return 'css must not use @import';
  if (CSS_EXPRESSION.test(css)) return 'css must not use expression()';
  if (BAD_FONT.test(css)) return 'css @font-face must use an https URL';
  return null;
}

export function elementMarkupIssue(html: string, css?: string, markdown?: string): string | null {
  if (markdown === undefined) {
    if (html.length + (css?.length ?? 0) > ELEMENT_MARKUP_MAX) {
      return `html and css together must be at most ${String(ELEMENT_MARKUP_MAX)} characters`;
    }
  } else {
    if (markdown.length > ELEMENT_MARKDOWN_MAX) {
      return `markdown must be at most ${String(ELEMENT_MARKDOWN_MAX)} characters`;
    }
    if (html.length > ELEMENT_HTML_ABS_MAX) {
      return `html must be at most ${String(ELEMENT_HTML_ABS_MAX)} characters`;
    }
    // `html` is derived, never authored. Rejecting a drifted pair is what lets
    // every renderer read `html` and still trust `markdown` as the source.
    if (html !== renderMarkdownToHtml(markdown)) {
      return 'html must be the rendered form of markdown';
    }
  }
  const htmlIssue = htmlLooksUnsafe(html);
  if (htmlIssue !== null) return htmlIssue;
  if (css !== undefined && css !== '') {
    const cssIssue = cssLooksUnsafe(css);
    if (cssIssue !== null) return cssIssue;
  }
  return null;
}

/** One sanitising pass; see `sanitizeElementHtml`. */
function sanitizePass(html: string): string {
  const lowered = asciiLower(html);
  const out: string[] = [];
  let copied = 0;
  for (const token of tokenize(html)) {
    // Tokens inside a dropped raw-text run are read again by the next pass.
    if (token.start < copied || token.kind === 'comment') continue;
    if (token.kind === 'declaration' && !token.cdata) continue;
    let keep = '';
    let end = token.end;
    if (token.kind === 'tag') {
      if (FORBIDDEN_TAGS.has(token.name)) {
        if (!token.endTag && RAW_TEXT_TAGS.has(token.name)) end = rawTextEnd(html, lowered, token.name, token.end);
      } else {
        const dropped = token.attrs.filter((attr) => elementAttributeIssue(attr.name, decodeAttribute(attr.value)) !== null);
        if (dropped.length === 0) continue;
        let from = token.start;
        for (const attr of dropped) {
          keep += `${html.slice(from, attr.start)} `;
          from = attr.end;
        }
        keep += html.slice(from, token.end);
      }
    }
    out.push(html.slice(copied, token.start), keep);
    copied = end;
  }
  out.push(html.slice(copied));
  return out.join('');
}

/**
 * Strip the unsafe constructs. Safe fragments pass through unchanged.
 *
 * Forbidden elements go (with their content, for the raw-text ones), unsafe
 * attributes go, and CDATA goes. Removing a piece can join its neighbours into
 * new markup, so passes repeat until nothing changes.
 */
export function sanitizeElementHtml(html: string): string {
  let current = html;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = sanitizePass(current);
    if (next === current) return current;
    current = next;
  }
  return '';
}

export function sanitizeElementCss(css: string): string {
  return css
    .replace(/@import[^;{]+;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/@font-face\s*\{[^}]*url\(\s*(['"]?)(?!https:)[^}]*\}/gi, '');
}
