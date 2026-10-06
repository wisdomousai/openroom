import { describe, expect, it } from 'vitest';
import {
  commitTimerText,
  expandTimerText,
  formatStepSeconds,
  hasTimerTextToken,
} from './timer-text';

describe('expandTimerText', () => {
  it('fills seconds, minutes and formatted duration', () => {
    expect(expandTimerText('{timer-minutes} minutes', 300)).toBe('5 minutes');
    expect(expandTimerText('{timer-seconds}s left', 300)).toBe('300s left');
    expect(expandTimerText('Go for {timer}', 300)).toBe('Go for 5:00');
  });

  it('expands longer tokens before {timer}', () => {
    expect(expandTimerText('{timer-seconds} / {timer}', 90)).toBe('90 / 1:30');
  });

  it('leaves unknown braces alone', () => {
    expect(expandTimerText('hello {world}', 60)).toBe('hello {world}');
  });

  it('handles under a minute', () => {
    expect(expandTimerText('{timer} · {timer-minutes}m', 45)).toBe('45s · 0m');
  });
});

describe('commitTimerText', () => {
  it('keeps tokens when the canvas commits the expanded display unchanged', () => {
    const stored = '{timer-minutes} minutes';
    expect(commitTimerText(stored, '10 minutes', 600)).toBe(stored);
  });

  it('stores a real rewrite as plain text', () => {
    expect(commitTimerText('{timer-minutes} minutes', 'Think hard', 600)).toBe('Think hard');
  });
});

describe('formatStepSeconds and hasTimerTextToken', () => {
  it('formats like the clock digits', () => {
    expect(formatStepSeconds(0)).toBe('0s');
    expect(formatStepSeconds(45)).toBe('45s');
    expect(formatStepSeconds(300)).toBe('5:00');
  });

  it('detects tokens', () => {
    expect(hasTimerTextToken('{timer}')).toBe(true);
    expect(hasTimerTextToken('plain')).toBe(false);
  });
});
