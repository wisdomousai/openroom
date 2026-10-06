import type { SpanFontFamily, TextElementAlignment, TextSpan } from '@openroom/schema';

import { formatAtRange, hasFormat, type SpanFormat } from './spans';

/**
 * What the formatting toolbar shows for one selection. Pure: no React, no DOM,
 * so the states a toolbar can be in are testable without a browser.
 *
 * `null` on size / family / color means "nothing to show" — either the range
 * mixes values or it carries no value at all. The toolbar draws both the same
 * way (an unset control), because there is no useful difference between "these
 * characters disagree" and "these characters are default".
 */
export interface FormatToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  size: number | null;
  family: SpanFontFamily | null;
  color: string | null;
  /**
   * Element-level, not per-span. `null` means alignment does not apply here: a
   * wired kind's fixed slot is aligned by the skin, not by the author.
   */
  align: TextElementAlignment | null;
}

/**
 * The styled thing a toolbar reads. A freeform text element satisfies it as
 * written; a fixed slot passes `align: null`, which is what hides the align
 * group rather than showing a control that would write nowhere.
 */
export interface StyledTarget {
  text: string;
  spans?: readonly TextSpan[];
  align?: TextElementAlignment | null;
}

export type ToggleKey = 'bold' | 'italic' | 'underline';

export function toolbarState(
  target: StyledTarget,
  start: number,
  end: number,
): FormatToolbarState {
  const spans = target.spans ?? [{ text: target.text }];
  const common = formatAtRange(spans, start, end);
  return {
    bold: hasFormat(spans, start, end, 'bold'),
    italic: hasFormat(spans, start, end, 'italic'),
    underline: hasFormat(spans, start, end, 'underline'),
    size: common?.size ?? null,
    family: common?.family ?? null,
    color: common?.color ?? null,
    align: target.align === null ? null : (target.align ?? 'left'),
  };
}

/**
 * The patch a B/I/U press writes. Turning a format off writes `undefined`, not
 * `false` — `compact()` in the span algebra drops undefined keys, so the span
 * comes back unstyled rather than carrying `bold: false` forever.
 */
export function togglePatch(state: FormatToolbarState, key: ToggleKey): Partial<SpanFormat> {
  return state[key] ? { [key]: undefined } : { [key]: true };
}
