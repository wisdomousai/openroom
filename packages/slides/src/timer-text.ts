/**
 * Tokens in a timer step's title/body that resolve from the configured duration.
 *
 * Authored as plain strings with placeholders; expanded at draw time so the
 * slide never hard-codes a length that drifts from `seconds`.
 *
 * Closed vocabulary — never free template language:
 *   {timer-seconds}  whole seconds (e.g. 300)
 *   {timer-minutes}  whole minutes, floor (e.g. 5)
 *   {timer}          same mm:ss (or Ns) the clock uses for the planned length
 */

/** Calm mm:ss (or Ns under a minute), matching the projector's countdown. */
export function formatStepSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `${String(s)}s`;
  return `${String(m)}:${s.toString().padStart(2, '0')}`;
}

export const TIMER_TEXT_TOKENS = [
  '{timer}',
  '{timer-minutes}',
  '{timer-seconds}',
] as const;

export type TimerTextToken = (typeof TIMER_TEXT_TOKENS)[number];

/** True when the string still carries at least one duration token. */
export function hasTimerTextToken(text: string): boolean {
  return (
    text.includes('{timer-seconds}') ||
    text.includes('{timer-minutes}') ||
    text.includes('{timer}')
  );
}

/**
 * Expand duration tokens in authored text.
 *
 * Longer names first so `{timer-seconds}` is not half-matched by `{timer}`.
 * Unknown braces are left alone.
 */
export function expandTimerText(text: string, seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return text
    .replaceAll('{timer-seconds}', String(total))
    .replaceAll('{timer-minutes}', String(minutes))
    .replaceAll('{timer}', formatStepSeconds(total));
}

/**
 * When the canvas commits expanded display text, keep the tokenised source if
 * the author did not actually change what they see. Otherwise store their new
 * plain string (they overwrote the tokens on purpose).
 */
export function commitTimerText(
  stored: string | undefined,
  committed: string,
  seconds: number,
): string {
  const raw = stored ?? '';
  const expanded = expandTimerText(raw, seconds);
  if (committed === expanded || committed.trim() === expanded.trim()) return raw;
  return committed;
}
