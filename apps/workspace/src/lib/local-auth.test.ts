import { describe, expect, it } from 'vitest';

import { isLoopbackHost, useDevLoginOnly } from './local-auth';

describe('local Desktop sign-in', () => {
  it('uses demo accounts only when Desktop is on a loopback or LAN origin', () => {
    expect(useDevLoginOnly('127.0.0.1', true)).toBe(true);
    expect(useDevLoginOnly('localhost', true)).toBe(true);
    expect(useDevLoginOnly('192.168.1.20', true)).toBe(true);
    expect(useDevLoginOnly('openroom.app', true)).toBe(false);
    expect(useDevLoginOnly('127.0.0.1', false)).toBe(false);
  });

  it('treats IPv4 and IPv6 loopback as local', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('openroom.app')).toBe(false);
  });
});
