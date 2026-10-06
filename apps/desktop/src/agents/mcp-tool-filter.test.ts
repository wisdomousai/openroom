import { describe, expect, it } from 'vitest';

import { filterSidebarMcpResponse, inspectSidebarMcpRequest } from './mcp-tool-filter.js';

const denied = new Set(['deck_preview']);

describe('sidebar MCP tool filter', () => {
  it('removes deck_preview from tools/list without changing the other tools', () => {
    const inspected = inspectSidebarMcpRequest(
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list' }),
      denied,
    );
    expect(inspected).toEqual({ forward: true, toolsListId: '4' });
    const ids = new Set(['4']);
    const response = filterSidebarMcpResponse(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        result: { tools: [{ name: 'deck_get' }, { name: 'deck_preview' }, { name: 'deck_save_version' }] },
      }),
      denied,
      ids,
    );
    expect(JSON.parse(response).result.tools).toEqual([
      { name: 'deck_get' },
      { name: 'deck_save_version' },
    ]);
    expect(ids.size).toBe(0);
  });

  it('blocks direct deck_preview calls but forwards normal tools', () => {
    const blocked = inspectSidebarMcpRequest(
      JSON.stringify({ jsonrpc: '2.0', id: 'p1', method: 'tools/call', params: { name: 'deck_preview' } }),
      denied,
    );
    expect(blocked.forward).toBe(false);
    if (!blocked.forward) {
      expect(JSON.parse(blocked.response ?? '{}').result).toMatchObject({ isError: true });
    }
    expect(inspectSidebarMcpRequest(
      JSON.stringify({ jsonrpc: '2.0', id: 'g1', method: 'tools/call', params: { name: 'deck_get' } }),
      denied,
    )).toEqual({ forward: true, toolsListId: null });
  });
});
