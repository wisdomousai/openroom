import type { IpcMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { isTrustedDesktopUrl } from './auth-navigation.js';
import { trustedIpc } from './trusted-ipc.js';

type Registered = (event: Record<string, unknown>, ...args: unknown[]) => unknown;

function fakeIpc() {
  const handlers = new Map<string, Registered>();
  const ipc = {
    handle: (channel: string, listener: Registered) => { handlers.set(channel, listener); },
    on(channel: string, listener: Registered) { handlers.set(channel, listener); return ipc; },
  };
  return { ipc: ipc as unknown as IpcMain, handlers };
}

const origin = 'https://openroom.app';
const frame = (url: string, parent: unknown = null) => ({ senderFrame: { url, parent } });

describe('trusted IPC', () => {
  it('runs a handler only for a top frame on the bundled renderer or the OpenRoom origin', async () => {
    const { ipc, handlers } = fakeIpc();
    const run = vi.fn(() => 'ran');
    trustedIpc(ipc, (url) => isTrustedDesktopUrl(url, origin)).handle('desktop:agents:run', run);
    const call = handlers.get('desktop:agents:run') as Registered;

    expect(await call(frame('openroom://app/core/index.html#/file'), { prompt: 'x' })).toBe('ran');
    expect(await call(frame(`${origin}/host/index.html#/`))).toBe('ran');
    expect(run).toHaveBeenCalledTimes(2);

    for (const event of [
      frame('https://openroom.app@evil.example/landing'),
      frame('https://openroom.app.evil.example/landing'),
      frame('openroom://local/3/page.html'),
      frame('openroom://app/core/index.html', {}),
      { senderFrame: null },
    ]) {
      expect(() => call(event)).toThrow('This page cannot use OpenRoom Desktop.');
    }
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('answers a foreign synchronous send with null instead of the value', () => {
    const { ipc, handlers } = fakeIpc();
    const guarded = trustedIpc(ipc, (url) => isTrustedDesktopUrl(url, origin));
    expect(guarded.on('desktop:control-origin', (event) => { event.returnValue = origin; })).toBe(guarded);
    const call = handlers.get('desktop:control-origin') as Registered;

    const foreign: Record<string, unknown> = frame('https://evil.example/');
    call(foreign);
    expect(foreign['returnValue']).toBeNull();
    const own: Record<string, unknown> = frame('openroom://app/core/index.html');
    call(own);
    expect(own['returnValue']).toBe(origin);
  });
});
