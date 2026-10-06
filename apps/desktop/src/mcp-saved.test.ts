import { describe, expect, it } from 'vitest';

import { stampedDeckId } from './mcp-saved.js';

function saveCall(deckId: unknown): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'deck_save_version', arguments: { deckId, content: {}, baseVersion: 3 } },
  };
}

function toolResponse(body: unknown, isError = false): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: JSON.stringify(body) }], isError },
  };
}

describe('stampedDeckId', () => {
  it('names the deck after a successful deck_save_version', () => {
    expect(stampedDeckId(saveCall('deck-1'), toolResponse({ ok: true, version: 4 }))).toBe('deck-1');
  });

  it('treats an unchanged save as stamped — a refetch is harmless', () => {
    expect(stampedDeckId(saveCall('deck-1'), toolResponse({ ok: true, unchanged: true }))).toBe('deck-1');
  });

  it('ignores refused saves, tool errors, and other calls', () => {
    expect(stampedDeckId(saveCall('deck-1'), toolResponse({ ok: false, conflict: true }))).toBeNull();
    expect(stampedDeckId(saveCall('deck-1'), toolResponse({ error: 'internal tool error' }, true))).toBeNull();
    expect(stampedDeckId(saveCall(undefined), toolResponse({ ok: true }))).toBeNull();
    expect(
      stampedDeckId(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'deck_get', arguments: { deckId: 'deck-1' } } },
        toolResponse({ ok: true }),
      ),
    ).toBeNull();
    expect(stampedDeckId(saveCall('deck-1'), null)).toBeNull();
  });
});
