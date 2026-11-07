import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ session: {} }));

const { desktopMcpPipeFile, desktopMcpSocketPath } = await import('./mcp-host.js');

describe('desktop MCP endpoint', () => {
  it('names the Windows pipe randomly per launch instead of one machine-wide name', () => {
    const pipe = desktopMcpSocketPath('C:\\Users\\a\\AppData\\Roaming\\OpenRoom', 'win32');
    expect(pipe).toMatch(/^\\\\\.\\pipe\\openroom-mcp-[0-9a-f]{32}$/);
    expect(desktopMcpSocketPath('C:\\Users\\b\\AppData\\Roaming\\OpenRoom', 'win32')).toBe(pipe);
    expect(desktopMcpPipeFile('/u/OpenRoom')).toBe('/u/OpenRoom/mcp-pipe');
  });

  it('keeps the macOS/Linux socket inside userData', () => {
    expect(desktopMcpSocketPath('/u/OpenRoom/', 'darwin')).toBe('/u/OpenRoom/mcp.sock');
  });
});
