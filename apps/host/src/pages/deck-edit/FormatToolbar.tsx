import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  RemoveFormatting,
  Underline,
} from 'lucide-react';
import type { SpanFontFamily, TextElementAlignment } from '@openroom/schema';

import { Button } from '../../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Toggle } from '../../components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { togglePatch, toolbarState, type StyledTarget, type ToggleKey } from './format-toolbar-state';
import type { SpanFormat } from './spans';
import { partSelection } from './selection-offsets';

/**
 * The formatting controls for a text selection on the slide, floating over the
 * selection itself.
 *
 * Every action works off a *snapshot* of the selection taken when the selection
 * changed, never off the live one: opening a portal control (a size list, the
 * color grid) moves focus out of the part and the browser drops the visible
 * selection, so a control that re-read the DOM at click time would style the
 * wrong range or none at all. The snapshot also carries the part's text, so the
 * string a gesture commits and the range it styles come from one read.
 */

const SIZES = [50, 75, 100, 125, 150, 200, 300, 400] as const;

const FAMILIES: { value: SpanFontFamily; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'display', label: 'Display' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
];

/** Theme hexes. A span stores `#rrggbb`, so the grid offers nothing else. */
const COLORS = [
  '#242424',
  '#616161',
  '#0f6cbd',
  '#107c41',
  '#b88217',
  '#ca5010',
  '#b4009e',
  '#5c2e91',
] as const;

const ALIGNMENTS: { value: TextElementAlignment; label: string; Icon: typeof AlignLeft }[] = [
  { value: 'left', label: 'Align left', Icon: AlignLeft },
  { value: 'center', label: 'Align center', Icon: AlignCenter },
  { value: 'right', label: 'Align right', Icon: AlignRight },
];

/** The family control, identical in both modes; `default` means the theme's. */
function FamilySelect({
  value,
  onPick,
  onOpenChange,
}: {
  value: SpanFontFamily;
  onPick: (value: SpanFontFamily) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(picked) => {
        onPick(picked as SpanFontFamily);
      }}
      onOpenChange={onOpenChange}
    >
      <SelectTrigger className="h-8 w-28" aria-label="Font">
        <SelectValue placeholder="Font" />
      </SelectTrigger>
      <SelectContent>
        {FAMILIES.map((family) => (
          <SelectItem key={family.value} value={family.value}>
            {family.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const BAR_CLASS =
  'absolute z-20 flex items-center gap-1 rounded-lg border border-hairline bg-card p-1 shadow-[var(--shadow-overlay)]';

/** Keep the caret in the part: a blur would commit and re-render the slide
 * before the click ever lands on the control. */
function keepCaret(event: { preventDefault: () => void }) {
  event.preventDefault();
}

interface Snapshot {
  text: string;
  start: number;
  end: number;
  /** Frame-relative, in pixels: the selection's box. */
  centerX: number;
  top: number;
  bottom: number;
}

/**
 * The whole-part font mode: one family for the part, no range. A fill-the-gaps
 * prompt is the only part shaped this way — its stored string holds `{{id}}`
 * placeholders, so no character range describes what the slide draws. The bar
 * carries the family control alone and needs no selection to appear; `Default`
 * is the clear, so there is no clear action beside it.
 */
export interface FontOnlyTarget {
  family: SpanFontFamily | undefined;
  onFont: (family: SpanFontFamily) => void;
}

export function FormatToolbar({
  frame,
  part,
  styled,
  fontOnly,
  onStyle,
  onAlign,
  onClearFormat,
}: {
  frame: HTMLElement;
  /** The contentEditable element the selection must live inside. */
  part: HTMLElement;
  /** The range-styled target. Null in font-only mode: no range is styled. */
  styled: StyledTarget | null;
  /** Present instead of `styled` on a part whose only style is a whole font. */
  fontOnly?: FontOnlyTarget;
  onStyle?: (start: number, end: number, patch: Partial<SpanFormat>, text: string) => void;
  /** Absent on a fixed slot: its alignment belongs to the skin, not the author. */
  onAlign?: (align: TextElementAlignment) => void;
  onClearFormat?: (start: number, end: number, text: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // Portal controls take focus, which clears the selection in the part. While
  // one is open the snapshot must survive, or the bar would unmount under the
  // pointer on its way to the item being clicked.
  const openMenus = useRef(0);
  const isFontOnly = fontOnly !== undefined;

  useEffect(() => {
    // Font-only styles the whole part, so the bar rides the part's own box and
    // stays up whether or not there is a caret in it.
    if (isFontOnly) {
      const rect = part.getBoundingClientRect();
      const box = frame.getBoundingClientRect();
      setSnapshot({
        text: part.textContent ?? '',
        start: 0,
        end: 0,
        centerX: rect.left + rect.width / 2 - box.left,
        top: rect.top - box.top,
        bottom: rect.bottom - box.top,
      });
      return;
    }
    const read = () => {
      const picked = partSelection(part);
      if (picked === null) {
        if (openMenus.current === 0) setSnapshot(null);
        return;
      }
      const selection = window.getSelection();
      if (selection === null || selection.rangeCount === 0) return;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const box = frame.getBoundingClientRect();
      setSnapshot({
        ...picked,
        centerX: rect.left + rect.width / 2 - box.left,
        top: rect.top - box.top,
        bottom: rect.bottom - box.top,
      });
    };
    read();
    document.addEventListener('selectionchange', read);
    return () => {
      document.removeEventListener('selectionchange', read);
    };
  }, [frame, part, isFontOnly]);

  // Clamped inside the frame: the frame clips its overflow, so a bar hung off
  // the top of a selection near the slide's edge would simply be cut in half.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (snapshot === null || bar === null) {
      setPlace(null);
      return;
    }
    const { width, height } = bar.getBoundingClientRect();
    const box = frame.getBoundingClientRect();
    const above = snapshot.top - height - 8;
    setPlace({
      left: Math.min(Math.max(4, snapshot.centerX - width / 2), Math.max(4, box.width - width - 4)),
      top: above >= 4 ? above : Math.min(snapshot.bottom + 8, box.height - height - 4),
    });
  }, [frame, snapshot]);

  if (snapshot === null) return null;
  const menu = (open: boolean) => {
    openMenus.current += open ? 1 : -1;
    if (openMenus.current < 0) openMenus.current = 0;
  };
  const box = {
    left: place?.left ?? 0,
    top: place?.top ?? 0,
    visibility: place === null ? ('hidden' as const) : undefined,
  };

  if (fontOnly !== undefined) {
    return (
      <div
        ref={barRef}
        className={BAR_CLASS}
        data-slide-decoration=""
        contentEditable={false}
        style={box}
        onMouseDown={keepCaret}
      >
        <FamilySelect value={fontOnly.family ?? 'default'} onPick={fontOnly.onFont} onOpenChange={menu} />
      </div>
    );
  }

  if (styled === null || onStyle === undefined || onClearFormat === undefined) return null;
  const state = toolbarState(styled, snapshot.start, snapshot.end);
  const style = (patch: Partial<SpanFormat>) => {
    onStyle(snapshot.start, snapshot.end, patch, snapshot.text);
  };

  return (
    <div
      ref={barRef}
      className={BAR_CLASS}
      data-slide-decoration=""
      contentEditable={false}
      style={box}
      onMouseDown={keepCaret}
    >
      {([
        { key: 'bold', label: 'Bold', Icon: Bold },
        { key: 'italic', label: 'Italic', Icon: Italic },
        { key: 'underline', label: 'Underline', Icon: Underline },
      ] as { key: ToggleKey; label: string; Icon: typeof Bold }[]).map(({ key, label, Icon }) => (
        <Toggle
          key={key}
          size="sm"
          aria-label={label}
          pressed={state[key]}
          onPressedChange={() => {
            style(togglePatch(state, key));
          }}
        >
          <Icon />
        </Toggle>
      ))}

      <Select
        value={state.size === null ? 'default' : String(state.size)}
        onValueChange={(value) => {
          style({ size: value === 'default' ? undefined : Number(value) });
        }}
        onOpenChange={menu}
      >
        <SelectTrigger className="h-8 w-24" aria-label="Size">
          <SelectValue placeholder="Size" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default</SelectItem>
          {SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {`${String(size)}%`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <FamilySelect
        value={state.family ?? 'default'}
        onPick={(family) => {
          style({ family: family === 'default' ? undefined : family });
        }}
        onOpenChange={menu}
      />

      <Popover onOpenChange={menu}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-2" aria-label="Color">
            <span
              className="size-4 rounded-sm border border-hairline"
              style={{ background: state.color ?? 'var(--foreground)' }}
            />
            Color
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2">
          <div className="grid grid-cols-4 gap-1">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                data-selected={state.color === color ? 'true' : undefined}
                className="size-6 rounded-md border border-hairline data-[selected=true]:ring-2 data-[selected=true]:ring-ring"
                style={{ background: color }}
                onClick={() => {
                  style({ color });
                }}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              style({ color: undefined });
            }}
          >
            Default
          </Button>
        </PopoverContent>
      </Popover>

      {state.align !== null && onAlign !== undefined ? (
        <ToggleGroup
          type="single"
          value={state.align}
          onValueChange={(value) => {
            if (value !== '') onAlign(value as TextElementAlignment);
          }}
        >
          {ALIGNMENTS.map(({ value, label, Icon }) => (
            <ToggleGroupItem key={value} value={value} aria-label={label} className="h-8 min-w-8">
              <Icon />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8"
        aria-label="Clear formatting"
        onClick={() => {
          onClearFormat(snapshot.start, snapshot.end, snapshot.text);
        }}
      >
        <RemoveFormatting />
      </Button>
    </div>
  );
}
