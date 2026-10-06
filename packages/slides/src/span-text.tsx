import type { CSSProperties, ReactNode } from 'react';

import type { SlideSpanStyle } from './slide-types';
import { TOKEN_SPLIT } from './tokens';

/**
 * Styled text: style spans, token spans, and the two nested.
 *
 * A style span carries styling over a character range. A token span carries the
 * *word index* the live surfaces circle and ink against. The two are different
 * partitions of the same string, so nesting order matters: tokens are the outer
 * spans, spans are sliced inside them. That keeps `closest('[data-token]')` — the
 * only thing ink resolves against — working even when a span boundary falls
 * mid-word.
 */

/**
 * One styled span's inline style. Size is stored as a percent of the slide's
 * base font and rendered as em, so the slide scales as one thing on desk,
 * wall, and phone. Families resolve to theme tokens — a span can never inject
 * a raw CSS font.
 */
export function spanStyleOf(span: SlideSpanStyle): CSSProperties {
  const style: CSSProperties = {};
  if (span.bold === true) style.fontWeight = 600;
  if (span.italic === true) style.fontStyle = 'italic';
  if (span.underline === true) style.textDecoration = 'underline';
  if (typeof span.size === 'number') {
    const size = Math.min(400, Math.max(25, Math.round(span.size)));
    style.fontSize = `${String(size / 100)}em`;
  }
  if (span.family !== undefined && span.family !== 'default') {
    style.fontFamily = `var(--font-${span.family})`;
  }
  if (span.color !== undefined) style.color = span.color;
  return style;
}

/** True when a span says nothing about how its characters look. */
function unstyled(span: SlideSpanStyle): boolean {
  return (
    span.bold === undefined &&
    span.italic === undefined &&
    span.underline === undefined &&
    span.size === undefined &&
    span.family === undefined &&
    span.color === undefined
  );
}

/**
 * The spans covering `[start, end)` of the styled string, split at the ends.
 *
 * Character offsets, the same walk the editor's span algebra uses — so a slice
 * taken here and a style applied there describe the same characters.
 */
export function sliceSpans(
  spans: readonly SlideSpanStyle[],
  start: number,
  end: number,
): SlideSpanStyle[] {
  const out: SlideSpanStyle[] = [];
  if (end <= start) return out;
  let offset = 0;
  for (const span of spans) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;
    offset = spanEnd;
    if (spanEnd <= start || spanStart >= end) continue;
    const from = Math.max(start, spanStart) - spanStart;
    const to = Math.min(end, spanEnd) - spanStart;
    out.push({ ...span, text: span.text.slice(from, to) });
  }
  return out;
}

function renderSpans(spans: readonly SlideSpanStyle[], keyPrefix: string): ReactNode {
  return spans.map((span, index) => (
    <span key={`${keyPrefix}-${String(index)}`} style={spanStyleOf(span)}>
      {span.text}
    </span>
  ));
}

/** Styled text with no token numbering — the plain rendering of a span list. */
export function SpanText({ spans }: { spans: readonly SlideSpanStyle[] }): ReactNode {
  return <>{renderSpans(spans, 'r')}</>;
}

/**
 * One span per word, numbered within the part it sits in, with styling sliced
 * inside each span.
 *
 * The numbering is positional over the same split the stage's own `TokenLine`
 * uses (`/(\s+)/`, index >> 1), so a click and the ink drawn afterwards agree
 * about which word was meant. With no spans the output is the bare token spans
 * and raw whitespace — the markup the projector has always drawn.
 */
export function TokenSpanWords({
  text,
  spans,
}: {
  text: string;
  spans?: readonly SlideSpanStyle[];
}): ReactNode {
  let offset = 0;
  return (
    <>
      {text.split(TOKEN_SPLIT).map((chunk, index) => {
        const start = offset;
        offset += chunk.length;
        const sliced = spans === undefined ? undefined : sliceSpans(spans, start, offset);
        if (/^\s+$/.test(chunk)) {
          // Whitespace is not a word: it never carries a token index. It does
          // carry styling, so an underline or a colour runs across the gap.
          if (sliced === undefined || sliced.every(unstyled)) return chunk;
          return <span key={`s-${String(index)}`}>{renderSpans(sliced, `s${String(index)}`)}</span>;
        }
        return (
          <span key={`w-${String(index)}`} data-token={Math.floor(index / 2)}>
            {sliced === undefined ? chunk : renderSpans(sliced, `w${String(index)}`)}
          </span>
        );
      })}
    </>
  );
}
