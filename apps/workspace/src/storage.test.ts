/**
 * Session credentials on this device. `localStorage` is stubbed because this
 * workspace runs vitest without a DOM.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

vi.stubGlobal('localStorage', new MemoryStorage());

const { clearLiveSession, listLiveSessions, loadLiveSession, saveLiveSession } = await import(
  './storage'
);

const session = {
  sessionCode: 'sc-1',
  code: 'ABC123',
  hostToken: 'ht',
  stageToken: 'st',
  createdAt: 1,
};

beforeEach(() => {
  localStorage.clear();
});

describe('live session storage', () => {
  it('round-trips a session by join code', () => {
    saveLiveSession(session);
    expect(loadLiveSession('sc-1')).toEqual(session);
    expect(listLiveSessions()).toHaveLength(1);
  });

  it('forgets a session once it has ended', () => {
    saveLiveSession(session);
    clearLiveSession('sc-1');
    expect(loadLiveSession('sc-1')).toBeNull();
    // Home's "On this device" reads this list: an ended session leaves it.
    expect(listLiveSessions()).toEqual([]);
  });

  it('clearing an unknown session is not an error', () => {
    expect(() => clearLiveSession('nothing')).not.toThrow();
  });
});
