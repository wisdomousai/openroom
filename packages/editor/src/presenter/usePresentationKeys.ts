import { useEffect } from 'react';

/** Browser and desktop presenters share the same clicker keys in both live states. */
export function usePresentationKeys({ enabled, next, previous, close }: {
  enabled: boolean; next: () => void; previous: () => void; close: () => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const key = (event: KeyboardEvent) => {
      // Menus and dialogs own their keys before the presentation clicker does.
      if (event.defaultPrevented) return;
      if (event.target instanceof HTMLElement && event.target.closest('[role="menu"], [role="listbox"], [role="combobox"], [role="dialog"]:not([data-deck-preview])')) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key !== 'Escape' && event.target instanceof HTMLElement && event.target.closest('button')) return;
      const action = event.key === 'Escape' ? close : event.key === 'ArrowLeft' ? previous : ['ArrowRight', ' ', 'Spacebar'].includes(event.key) ? next : null;
      if (action) { event.preventDefault(); event.stopImmediatePropagation(); action(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [enabled, next, previous, close]);
}
