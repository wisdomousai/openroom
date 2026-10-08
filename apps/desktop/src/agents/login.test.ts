import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { firstHttpUrl, shouldOpenLoginUrl, startCliLogin } from './login.js';

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill(): void {
    this.killed = true;
    this.emit('exit', 1);
  }
}

describe('login URL handling', () => {
  it('opens OAuth URLs from CLI output', () => {
    const line = 'Visit https://auth.openai.com/oauth/authorize?code=abc to continue.';
    const url = firstHttpUrl(line);
    expect(url).toBe('https://auth.openai.com/oauth/authorize?code=abc');
    expect(shouldOpenLoginUrl(line, url ?? '')).toBe(true);
  });
});

describe('startCliLogin', () => {
  it('resolves when signedIn becomes true after the credentials file appears', async () => {
    const child = new FakeChild();
    let signedIn = false;
    const openUrl = vi.fn();
    const done = new Promise<void>((resolve, reject) => {
      startCliLogin({
        bin: 'codex',
        args: ['login'],
        signedIn: () => signedIn,
        openUrl,
        missingBinaryMessage: 'missing',
        pollMs: 20,
        spawn: () => child as never,
        onOutput: () => undefined,
        onSuccess: () => resolve(),
        onError: reject,
      });
    });
    child.stdout.write('Open https://auth.openai.com/oauth/authorize\n');
    signedIn = true;
    await done;
    expect(openUrl).toHaveBeenCalledWith('https://auth.openai.com/oauth/authorize');
  });

  it('rejects when the process exits without credentials', async () => {
    const child = new FakeChild();
    const failed = new Promise<Error>((resolve) => {
      startCliLogin({
        bin: 'codex',
        args: ['login'],
        signedIn: () => false,
        openUrl: () => undefined,
        missingBinaryMessage: 'missing',
        spawn: () => child as never,
        onOutput: () => undefined,
        onSuccess: () => undefined,
        onError: resolve,
      });
    });
    child.emit('exit', 1);
    expect((await failed).message).toMatch(/before credentials/i);
  });
});
