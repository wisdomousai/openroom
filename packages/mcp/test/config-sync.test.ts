/**
 * The same server is declared in three files (see scripts/sync-mcp-config.mjs).
 * Only one is edited by hand; this fails if a copy is edited instead, or if the
 * source changes and the generator is not re-run.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const read = (relative: string) => JSON.parse(readFileSync(resolve(root, relative), 'utf8'));

describe('mcp client config', () => {
  const source = read('plugin/mcp.json');

  it('declares the openroom server over streamable http', () => {
    expect(source.mcpServers.openroom).toMatchObject({ type: 'streamable-http' });
    expect(String(source.mcpServers.openroom.url)).toMatch(/^https:\/\/.+\/api\/mcp$/);
  });

  it.each(['plugin/.mcp.json', '.mcp.json'])('%s carries the same servers as the source', (relative) => {
    expect(read(relative).mcpServers).toEqual(source.mcpServers);
  });

  it('keeps the Codex manifest pointing at a file that exists beside it', () => {
    // "./.mcp.json" is resolved relative to plugin/, which is why that copy
    // exists at all — repointing it would let the copy be deleted.
    const manifest = read('plugin/.codex-plugin/plugin.json');
    expect(manifest.mcpServers).toBe('./.mcp.json');
    expect(() => read('plugin/.mcp.json')).not.toThrow();
  });
});
