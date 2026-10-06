/**
 * Pure span algebra over styled text spans. No React, no DOM — every editor
 * surface (toolbar, task pane, keyboard shortcut) funnels through these, so
 * the invariants live in exactly one place:
 *
 *  - spans concatenate exactly to the element's plain `text` (the schema's
 *    semantic check), and
 *  - spans are normalized: no empty spans, adjacent spans with identical
 *    formatting merged.
 *
 * Offsets are character offsets into `text`, which is one-to-one with span
 * boundaries — that is what lets a DOM selection map onto ranges here.
 */
import { SPAN_SIZE_MAX, SPAN_SIZE_MIN, type TextSpan } from '@openroom/schema';

/** Formatting carried by a span, minus its text. */
export type SpanFormat = Omit<TextSpan, 'text'>;

const FORMAT_KEYS = ['bold', 'italic', 'underline', 'size', 'family', 'color'] as const;
type FormatKey = (typeof FORMAT_KEYS)[number];

function formatOf(span: TextSpan): SpanFormat {
  const { text: _text, ...format } = span;
  return format;
}

function sameFormat(a: SpanFormat | undefined, b: SpanFormat | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  for (const key of FORMAT_KEYS) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function isEmpty(format: SpanFormat | undefined): boolean {
  if (format === undefined) return true;
  return !FORMAT_KEYS.some((key) => format[key] !== undefined);
}

export function concatText(spans: readonly TextSpan[]): string {
  return spans.map((span) => span.text).join('');
}

/**
 * Drop empty spans and merge neighbors with identical formatting. A fully
 * unstyled list collapses to a single plain span (or nothing at all).
 */
export function normalizeSpans(spans: readonly TextSpan[]): TextSpan[] {
  const cleaned: TextSpan[] = [];
  for (const span of spans) {
    if (span.text.length === 0) continue;
    const previous = cleaned[cleaned.length - 1];
    if (previous !== undefined && sameFormat(formatOf(previous), formatOf(span))) {
      cleaned[cleaned.length - 1] = { ...previous, text: previous.text + span.text };
      continue;
    }
    const format = formatOf(span);
    cleaned.push(
      isEmpty(format)
        ? { text: span.text }
        : ({ text: span.text, ...compact(format) } as TextSpan),
    );
  }
  return cleaned;
}

function compact(format: SpanFormat): SpanFormat {
  const out: Record<string, unknown> = {};
  for (const key of FORMAT_KEYS) {
    if (format[key] !== undefined) out[key] = format[key];
  }
  return out as SpanFormat;
}

/** Spans for a plain string: one unstyled span. */
export function plainToSpans(text: string): TextSpan[] {
  return [{ text }];
}

/**
 * Apply a partial style patch to `[start, end)` of the span list. Boundary spans
 * are split so styling never leaks outside the selection. Toggling semantics
 * belong to the caller; this applies the patch verbatim.
 */
export function styleRange(
  spans: readonly TextSpan[],
  start: number,
  end: number,
  patch: Partial<SpanFormat>,
): TextSpan[] {
  if (end <= start) return [...spans];
  let offset = 0;
  const next: TextSpan[] = [];
  for (const span of spans) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;
    offset = spanEnd;
    if (spanEnd <= start || spanStart >= end) {
      next.push(span);
      continue;
    }
    const overlapStart = Math.max(start, spanStart);
    const overlapEnd = Math.min(end, spanEnd);
    const before = span.text.slice(0, overlapStart - spanStart);
    const middle = span.text.slice(overlapStart - spanStart, overlapEnd - spanStart);
    const after = span.text.slice(overlapEnd - spanStart);
    if (before.length > 0) next.push({ ...span, text: before });
    const format = formatOf(span);
    next.push({
      text: middle,
      ...(compact({ ...format, ...patch }) as SpanFormat),
    });
    if (after.length > 0) next.push({ ...span, text: after });
  }
  return normalizeSpans(next);
}

/** Remove every style property listed in `keys` from `[start, end)`. */
export function clearStyle(
  spans: readonly TextSpan[],
  start: number,
  end: number,
  keys: readonly FormatKey[],
): TextSpan[] {
  if (end <= start) return [...spans];
  let offset = 0;
  const next: TextSpan[] = [];
  for (const span of spans) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;
    offset = spanEnd;
    if (spanEnd <= start || spanStart >= end) {
      next.push(span);
      continue;
    }
    const overlapStart = Math.max(start, spanStart);
    const overlapEnd = Math.min(end, spanEnd);
    const before = span.text.slice(0, overlapStart - spanStart);
    const middle = span.text.slice(overlapStart - spanStart, overlapEnd - spanStart);
    const after = span.text.slice(overlapEnd - spanStart);
    if (before.length > 0) next.push({ ...span, text: before });
    const format: Record<string, unknown> = { ...compact(formatOf(span)) };
    for (const key of keys) delete format[key];
    next.push(isEmpty(format as SpanFormat) ? { text: middle } : ({ text: middle, ...format } as TextSpan));
    if (after.length > 0) next.push({ ...span, text: after });
  }
  return normalizeSpans(next);
}

/**
 * The common format across `[start, end)`, or `undefined` when the range is
 * empty or inconsistent — this is what a toolbar toggle reads to show state.
 */
export function formatAtRange(
  spans: readonly TextSpan[],
  start: number,
  end: number,
): SpanFormat | undefined {
  if (end <= start) {
    // Empty selection: report the format under the caret.
    let offset = 0;
    for (const span of spans) {
      if (start < offset + span.text.length) return formatOf(span);
      offset += span.text.length;
    }
    const last = spans[spans.length - 1];
    return last === undefined ? undefined : formatOf(last);
  }
  let common: SpanFormat | undefined;
  let seen = false;
  let offset = 0;
  for (const span of spans) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;
    offset = spanEnd;
    if (spanEnd <= start || spanStart >= end) continue;
    if (!seen) {
      common = formatOf(span);
      seen = true;
      continue;
    }
    if (!sameFormat(common, formatOf(span))) return undefined;
  }
  return seen ? common : undefined;
}

/**
 * Replace `[start, end)` with `insertion`. The inserted characters inherit the
 * format of the span they landed in: a replacement contained in one styled span
 * continues its style, a replacement spanning spans lands unstyled (no single
 * format describes what it replaced), and a pure insertion at the caret
 * continues the format on the caret's side.
 */
export function replaceRange(
  spans: readonly TextSpan[],
  start: number,
  end: number,
  insertion: string,
): TextSpan[] {
  let offset = 0;
  const next: TextSpan[] = [];
  let inserted = false;
  let inheritedFormat: SpanFormat | undefined;
  for (const span of spans) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;
    offset = spanEnd;
    const overlapsReplacement = spanEnd > start && spanStart < end;
    if (!inserted && end > start && start >= spanStart && start < spanEnd) {
      // Replacement starts inside this span. Contained here -> inherit its
      // format; spanning past it -> the replaced material had mixed formats.
      inheritedFormat = end <= spanEnd ? { ...compact(formatOf(span)) } : undefined;
    } else if (!inserted && end === start) {
      // Pure insertion. Inside a span, or exactly at a span's right edge, the
      // new characters continue what was just typed.
      if ((start > spanStart && start < spanEnd) || spanEnd === start) {
        inheritedFormat = { ...compact(formatOf(span)) };
      }
    }
    if (!overlapsReplacement) {
      next.push(span);
      continue;
    }
    const before = span.text.slice(0, Math.max(0, start - spanStart));
    const after = span.text.slice(Math.max(0, Math.min(span.text.length, end - spanStart)));
    if (before.length > 0) next.push({ ...span, text: before });
    if (!inserted) {
      inserted = true;
      if (insertion.length > 0) {
        next.push(
          inheritedFormat === undefined
            ? { text: insertion }
            : ({ text: insertion, ...inheritedFormat } as TextSpan),
        );
      }
    }
    if (after.length > 0) next.push({ ...span, text: after });
  }
  if (!inserted && insertion.length > 0) {
    next.push(
      inheritedFormat === undefined
        ? { text: insertion }
        : ({ text: insertion, ...inheritedFormat } as TextSpan),
    );
  }
  return normalizeSpans(next);
}

/**
 * Spans for `newText` given the spans of `oldText`: the unchanged prefix and
 * suffix keep their formatting, the edited middle inherits the format it had.
 */
export function retargetSpans(oldText: string, spans: readonly TextSpan[], newText: string): TextSpan[] {
  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(oldText.length - prefix, newText.length - prefix);
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return replaceRange(spans, prefix, oldText.length - suffix, newText.slice(prefix, newText.length - suffix));
}

/**
 * Strip every style property from `[start, end)` — the span-level half of
 * "Clear formatting". Shared by element and fixed-slot styling so the two
 * cannot disagree about what clearing a range means.
 */
export function clearStyleRange(spans: readonly TextSpan[], start: number, end: number): TextSpan[] {
  let offset = 0;
  const next: TextSpan[] = [];
  for (const span of spans) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;
    offset = spanEnd;
    if (spanEnd <= start || spanStart >= end) {
      next.push(span);
      continue;
    }
    const overlapStart = Math.max(start, spanStart);
    const overlapEnd = Math.min(end, spanEnd);
    const before = span.text.slice(0, overlapStart - spanStart);
    const middle = span.text.slice(overlapStart - spanStart, overlapEnd - spanStart);
    const after = span.text.slice(overlapEnd - spanStart);
    if (before.length > 0) next.push({ ...span, text: before });
    next.push({ text: middle });
    if (after.length > 0) next.push({ ...span, text: after });
  }
  return normalizeSpans(next);
}

/** Span size into the schema's budget, or `undefined` when there is nothing to clamp. */
export function clampSpanSize(size: number | undefined): number | undefined {
  if (size === undefined || !Number.isFinite(size)) return undefined;
  return Math.round(Math.min(SPAN_SIZE_MAX, Math.max(SPAN_SIZE_MIN, size)));
}

/**
 * The span list a stored field should keep, or `undefined` when it carries no
 * styling at all — a lone unstyled span is noise the plan file does not need.
 */
export function pruneSpans(spans: readonly TextSpan[]): TextSpan[] | undefined {
  const normalized = normalizeSpans(spans);
  if (normalized.length === 0) return undefined;
  if (normalized.length === 1 && isEmpty(formatOf(normalized[0]!))) return undefined;
  return normalized;
}

/** True when every character in `[start, end)` carries `key` set to truthy. */
export function hasFormat(spans: readonly TextSpan[], start: number, end: number, key: 'bold' | 'italic' | 'underline'): boolean {
  if (end <= start) {
    const format = formatAtRange(spans, start, end);
    return format?.[key] === true;
  }
  let offset = 0;
  let covered = false;
  for (const span of spans) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;
    offset = spanEnd;
    if (spanEnd <= start || spanStart >= end) continue;
    covered = true;
    if (span[key] !== true) return false;
  }
  return covered;
}
