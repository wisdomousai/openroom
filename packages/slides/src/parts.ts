import type { CSSProperties, FocusEvent, KeyboardEvent, MouseEvent } from 'react';

/**
 * The attributes a part contributes to whatever element already carried it.
 *
 * Deliberately *attributes*, not a wrapper element: the projector's DOM shape is
 * the reference rendering, and a shared skeleton that quietly added a `<div>`
 * around every heading would change it. A part marks the element the stage was
 * already drawing.
 */
export interface PartAttrs {
  'data-part'?: string;
  'data-selected'?: 'true';
  /** Editor-only watermark; never part of the editable text. */
  'data-placeholder'?: string;
  'data-empty'?: 'true';
  onInput?: (event: React.FormEvent<HTMLElement>) => void;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  contentEditable?: boolean;
  suppressContentEditableWarning?: boolean;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  style?: CSSProperties;
}

export interface PartOptions {
  /** Parts the reveal play-through has not reached; they are not rendered. */
  hiddenParts?: ReadonlySet<string>;
  selectedPart?: string | null;
  onPartClick?: (key: string) => void;
  /** Which parts take a caret. A predicate keeps composite parts read-only. */
  editable?: boolean | ((key: string) => boolean);
  onPartCommit?: (key: string, text: string) => void;
  /**
   * Extra keys on an editable part. Return true to skip the default
   * Enter-commits-and-blurs behaviour (e.g. Enter inserts another option).
   */
  onPartKeyDown?: (key: string, event: KeyboardEvent<HTMLElement>) => boolean | void;
  /** Editor-only instruction, displayed when a contenteditable is empty. */
  partPlaceholder?: (key: string) => { text: string; empty: boolean };
}

/** Text of a part element, minus anything the surface drew inside it (badges). */
function partText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  for (const decoration of copy.querySelectorAll('[data-slide-decoration]')) {
    decoration.remove();
  }
  // Browsers park a non-breaking space in an emptied contenteditable.
  return (copy.textContent ?? '').replace(/\u00a0/g, ' ').trim();
}

export interface PartApi {
  /** True when the reveal play-through has not reached this part yet. */
  hidden(key: string): boolean;
  /** Identity, selection and click — for the element that *is* the part. */
  hostAttrs(key: string): PartAttrs;
  /** A caret on the element holding the part's text, and nothing else. */
  editAttrs(key: string): PartAttrs;
  /** Both, for a part whose element is its text (a heading, a bullet). */
  attrs(key: string): PartAttrs;
}

export function makeParts(options: PartOptions): PartApi {
  const {
    hiddenParts,
    selectedPart,
    onPartClick,
    editable = false,
    onPartCommit,
    onPartKeyDown,
    partPlaceholder,
  } = options;
  const canEdit = (key: string): boolean =>
    onPartCommit !== undefined && (typeof editable === 'function' ? editable(key) : editable);

  const hostAttrs = (key: string): PartAttrs => {
    const attrs: PartAttrs = { 'data-part': key };
    if (selectedPart === key) attrs['data-selected'] = 'true';
    if (onPartClick !== undefined) {
      attrs.onClick = (event) => {
        event.stopPropagation();
        onPartClick(key);
      };
    }
    return attrs;
  };

  const editAttrs = (key: string): PartAttrs => {
    if (!canEdit(key)) return {};
    const placeholder = partPlaceholder?.(key);
    return {
      ...(placeholder ? { 'data-placeholder': placeholder.text, 'data-empty': placeholder.empty ? 'true' as const : undefined } : {}),
      contentEditable: true,
      suppressContentEditableWarning: true,
      onInput: (event) => {
        // An emptied contenteditable can contain <br>, so :empty alone is not enough.
        if (partText(event.currentTarget) === '') event.currentTarget.dataset['empty'] = 'true';
        else delete event.currentTarget.dataset['empty'];
      },
      // Commit on blur only. Nothing above re-renders while the caret is in
      // here, which is why the surrounding parse can stay synchronous.
      onBlur: (event) => {
        onPartCommit?.(key, partText(event.currentTarget));
      },
      onKeyDown: (event) => {
        if (onPartKeyDown?.(key, event) === true) return;
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      },
    };
  };

  return {
    hidden: (key) => hiddenParts?.has(key) === true,
    hostAttrs,
    editAttrs,
    attrs: (key) => ({ ...hostAttrs(key), ...editAttrs(key) }),
  };
}
