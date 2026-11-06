import { useEffect } from 'react';

/** Controls that act on Space and Enter themselves. */
const PRESS_OWNERS =
  'button, a[href], summary, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="option"]';

/** Controls that move with the arrow keys themselves. */
const ARROW_OWNERS =
  '[role="tab"], [role="tablist"], [role="radio"], [role="radiogroup"], [role="slider"], [role="menubar"], [role="tree"], [role="grid"]';

/**
 * Whether the focused element owns this key, so a console or presentation
 * shortcut must leave it alone. Menus, dialogs and text fields own every key.
 * A focused button, link or tab owns Space and Enter, so Space on Back presses
 * Back. Tabs, radios and sliders own the arrows; on a plain button the arrows
 * still turn the slide, as a clicker does.
 */
export function focusOwnsKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target.closest('[role="menu"], [role="listbox"], [role="combobox"], [role="dialog"]:not([data-deck-preview])')) return true;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
  if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter') return target.closest(PRESS_OWNERS) !== null;
  if (event.key.startsWith('Arrow')) return target.closest(ARROW_OWNERS) !== null;
  return false;
}

/** Browser and desktop presenters share the same clicker keys in both live states. */
export function usePresentationKeys({ enabled, next, previous, close }: {
  enabled: boolean; next: () => void; previous: () => void; close: () => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const key = (event: KeyboardEvent) => {
      if (focusOwnsKey(event)) return;
      const action = event.key === 'Escape' ? close : event.key === 'ArrowLeft' ? previous : ['ArrowRight', ' ', 'Spacebar'].includes(event.key) ? next : null;
      if (action) { event.preventDefault(); event.stopImmediatePropagation(); action(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [enabled, next, previous, close]);
}
