import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDesktopUpdateChecks } from './updates.js';

class Updater extends EventEmitter {
  setFeedURL = vi.fn();
  checkForUpdates = vi.fn();
}
const HOUR = 60 * 60 * 1000;
function start(updater: Updater, feed = 'https://updates.example.test/mac') {
  return startDesktopUpdateChecks(updater as unknown as Parameters<typeof startDesktopUpdateChecks>[0], feed);
}

describe('Desktop update lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('survives an asynchronous native failure and retries without logging its private message', () => {
    const updater = new Updater();
    start(updater);
    vi.advanceTimersByTime(59_999);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(() => updater.emit('error', new Error('PRIVATE_UPDATE_URL'))).not.toThrow();
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('{"event":"desktop.update.failed"}');
    vi.advanceTimersByTime(4 * HOUR);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('does not start another download while a check is pending and stops after an update arrives', () => {
    const updater = new Updater();
    start(updater);
    vi.advanceTimersByTime(9 * HOUR);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.emit('update-not-available');
    vi.advanceTimersByTime(4 * HOUR);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    updater.emit('update-downloaded');
    vi.advanceTimersByTime(24 * HOUR);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('cancels timers on shutdown but absorbs a late native failure', () => {
    const updater = new Updater(), stop = start(updater);
    vi.advanceTimersByTime(60_000);
    stop();
    vi.advanceTimersByTime(24 * HOUR);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(() => updater.emit('error', new Error('late request'))).not.toThrow();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('retries a synchronous check failure without letting it escape', () => {
    const updater = new Updater();
    updater.checkForUpdates.mockImplementationOnce(() => { throw new Error('native failure'); });
    start(updater);
    expect(() => vi.advanceTimersByTime(4 * HOUR)).not.toThrow();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('disables an invalid or rejected feed before starting checks', () => {
    for (const feed of ['not-a-url', 'http://updates.example.test', 'https://private:secret@updates.example.test', 'https://updates.example.test/#private']) {
      const updater = new Updater();
      start(updater, feed);
      vi.advanceTimersByTime(4 * HOUR);
      expect(updater.setFeedURL).not.toHaveBeenCalled();
      expect(updater.checkForUpdates).not.toHaveBeenCalled();
    }
    const updater = new Updater();
    updater.setFeedURL.mockImplementation(() => { throw new Error('native rejection'); });
    expect(() => start(updater)).not.toThrow();
    vi.advanceTimersByTime(4 * HOUR);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
