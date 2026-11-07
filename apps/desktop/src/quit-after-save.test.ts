import { describe, expect, it } from 'vitest';

import { createQuitAfterSave } from './quit-after-save.js';

describe('quit after save', () => {
  it('resumes the quit when the save the Quit asked for closes the window', () => {
    const tracker = createQuitAfterSave<object>();
    const window = {};
    tracker.promptOpened(window);
    tracker.saveRequested(window, true);
    expect(tracker.saveFinished(window, true)).toBe(true);
  });

  it('does not quit when a later close succeeds after the Quit save failed', () => {
    const tracker = createQuitAfterSave<object>();
    const window = {};
    tracker.promptOpened(window);
    tracker.saveRequested(window, true);
    // Save As cancelled, outline needs repair, or the write failed.
    expect(tracker.saveFinished(window, false)).toBe(false);
    // The tutor later closes the window and saves it.
    tracker.promptOpened(window);
    tracker.saveRequested(window, false);
    expect(tracker.saveFinished(window, true)).toBe(false);
  });

  it('forgets the Quit request when the close prompt opens again', () => {
    const tracker = createQuitAfterSave<object>();
    const window = {};
    tracker.promptOpened(window);
    tracker.saveRequested(window, true);
    // No result came back (a save already running); the next prompt supersedes it.
    tracker.promptOpened(window);
    expect(tracker.saveFinished(window, true)).toBe(false);
  });

  it('keeps each window to its own request', () => {
    const tracker = createQuitAfterSave<object>();
    const first = {};
    const second = {};
    tracker.saveRequested(first, true);
    tracker.saveRequested(second, false);
    expect(tracker.saveFinished(second, true)).toBe(false);
    expect(tracker.saveFinished(first, true)).toBe(true);
  });
});
