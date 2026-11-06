import type { KeyboardEvent } from 'react';

/**
 * Shift+F10 (and the ContextMenu key) opens the focused row's context menu.
 *
 * Browsers do not all turn Shift+F10 into a `contextmenu` event, and macOS
 * never does, so the row raises one itself: a `contextmenu` at the start of the
 * row, which the Radix trigger wrapping it opens on like a right-click.
 * Returns true when it handled the key.
 */
export function openContextMenuFromKey(event: KeyboardEvent<HTMLElement>): boolean {
  const menuKey = (event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu';
  if (!menuKey) return false;
  event.preventDefault();
  event.stopPropagation();
  const row = event.currentTarget;
  const box = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: box.left + Math.min(32, box.width / 2),
    clientY: box.top + box.height / 2,
  }));
  return true;
}

/** "New folder", or "New folder 2", 3… when a sibling already has the name. */
export function uniqueName(base: string, taken: readonly string[]): string {
  const names = new Set(taken.map((name) => name.trim().toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
}
