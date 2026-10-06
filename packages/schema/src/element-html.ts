/**
 * Allowlist sanitiser for freeform `html` elements.
 *
 * One implementation for the validator, CLI, MCP, and the browser host.
 * Markup is a fragment, not a document. Script never survives.
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
]);

const EVENT_ATTR = /\s+on[a-z]+\s*=/i;
const JS_URL = /(?:href|src|xlink:href|action)\s*=\s*(['"]?)\s*javascript:/i;
const CSS_IMPORT = /@import\b/i;
const CSS_EXPRESSION = /expression\s*\(/i;
const BAD_FONT = /@font-face[\s\S]*url\(\s*(['"]?)(?!https:)/i;

export function htmlLooksUnsafe(html: string): string | null {
  const lowered = html.toLowerCase();
  for (const tag of FORBIDDEN_TAGS) {
    if (lowered.includes(`<${tag}`) || lowered.includes(`</${tag}`)) {
      return `html must not contain <${tag}>`;
    }
  }
  if (EVENT_ATTR.test(html)) return 'html must not contain event attributes';
  if (JS_URL.test(html)) return 'html must not use javascript: URLs';
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

/** Strip the known-unsafe constructs. Safe fragments pass through unchanged. */
export function sanitizeElementHtml(html: string): string {
  let next = html;
  for (const tag of FORBIDDEN_TAGS) {
    const open = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    const lone = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
    next = next.replace(open, '').replace(lone, '');
  }
  next = next.replace(/\s+on[a-z]+\s*=\s*(['"]).*?\1/gi, '');
  next = next.replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '');
  next = next.replace(/(href|src|xlink:href|action)\s*=\s*(['"]?)\s*javascript:[^'"\s>]*/gi, '$1=$2');
  return next;
}

export function sanitizeElementCss(css: string): string {
  return css
    .replace(/@import[^;{]+;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/@font-face\s*\{[^}]*url\(\s*(['"]?)(?!https:)[^}]*\}/gi, '');
}
