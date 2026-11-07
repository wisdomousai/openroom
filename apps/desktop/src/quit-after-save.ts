/**
 * The windows whose save-and-close a Quit is waiting on. Choosing Save in the
 * close prompt during Quit marks the window; the quit goes on only when that
 * same save closes it. A save that does not close the window (Save As
 * cancelled, an outline that needs repair, a write error) clears the mark, and
 * so does the next close prompt, so closing that window later never quits the app.
 */
export interface QuitAfterSave<W extends object> {
  /** The close prompt opened for this window: an earlier request no longer applies. */
  promptOpened(window: W): void;
  /** The tutor chose Save in the prompt; `quitting` is whether Quit opened it. */
  saveRequested(window: W, quitting: boolean): void;
  /** The requested save finished. True when the window should resume the quit as it closes. */
  saveFinished(window: W, saved: boolean): boolean;
}

export function createQuitAfterSave<W extends object>(): QuitAfterSave<W> {
  const waiting = new WeakSet<W>();
  return {
    promptOpened(window) { waiting.delete(window); },
    saveRequested(window, quitting) {
      if (quitting) waiting.add(window);
      else waiting.delete(window);
    },
    saveFinished(window, saved) {
      const resume = saved && waiting.has(window);
      waiting.delete(window);
      return resume;
    },
  };
}
