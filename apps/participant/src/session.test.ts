import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearSession,
  loadSession,
  loadSessionByCode,
  saveSession,
  type StoredSession,
} from './session';

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

const stored: StoredSession = {
  sessionCode: 'AB12CD34',
  code: 'AB12CD34',
  token: 'participant-token',
  participantId: 'participant-1',
  handle: 'Amber Fox 4827',
};

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('participant session storage', () => {
  it('indexes a saved capability by both session code and QR join code', () => {
    saveSession(stored);

    expect(loadSession(stored.sessionCode)).toEqual(stored);
    expect(loadSessionByCode('ab12cd34')).toEqual(stored);
  });

  it('survives losing the tab-scoped store when localStorage remains', () => {
    saveSession(stored);
    sessionStorage.clear();

    expect(loadSessionByCode(stored.code ?? '')).toEqual(stored);
  });

  it('clears both session and QR indexes on explicit leave', () => {
    saveSession(stored);
    clearSession(stored);

    expect(loadSession(stored.sessionCode)).toBeNull();
    expect(loadSessionByCode(stored.code ?? '')).toBeNull();
  });
});
