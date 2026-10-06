import type { AutoUpdater } from 'electron';

type Updater = Pick<AutoUpdater, 'on' | 'setFeedURL' | 'checkForUpdates'>;

/** Update failures must never escape into teaching or close an unsaved deck. */
export function startDesktopUpdateChecks(updater: Updater, feed: string): () => void {
  let checking = false, stopped = false;
  let initial: ReturnType<typeof setTimeout> | undefined;
  let repeat: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(initial);
    clearInterval(repeat);
  };
  const failed = () => {
    checking = false;
    // Feed URLs and native error bodies can contain private deployment details.
    if (!stopped) console.warn(JSON.stringify({ event: 'desktop.update.failed' }));
  };
  // Keep this listener for the process lifetime: a native request may finish after stop().
  updater.on('error', failed);
  updater.on('update-not-available', () => { checking = false; });
  // The native updater applies this on the next normal launch. Never force a restart.
  updater.on('update-downloaded', stop);
  try {
    const url = new URL(feed);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid update feed.');
    updater.setFeedURL({ url: url.href });
  } catch {
    failed();
    stop();
    return stop;
  }
  const check = () => {
    if (stopped || checking) return;
    checking = true;
    try { updater.checkForUpdates(); }
    catch { failed(); }
  };
  // Also outlasts the Windows installer's first-launch file lock.
  initial = setTimeout(check, 60_000);
  repeat = setInterval(check, 4 * 60 * 60 * 1_000);
  return stop;
}
