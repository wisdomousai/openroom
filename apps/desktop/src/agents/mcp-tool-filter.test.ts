import { describe, expect, it } from 'vitest';

import {
  apiCallNeedingConfirmation,
  confirmationAllowed,
  confirmationRefusal,
  confirmationRequest,
  confirmationResponseId,
  filterSidebarMcpResponse,
  inspectSidebarMcpRequest,
} from './mcp-tool-filter.js';

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

describe('openroom_api confirmation gate', () => {
  const call = (method: string, path: string, body?: unknown) =>
    JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'openroom_api', arguments: { method, path, body } } });

  it('holds membership, invitation, access-link and billing writes, and passes deck authoring through', () => {
    expect(apiCallNeedingConfirmation(call('POST', '/api/my/spaces/s1/invites', { email: 'x@example.invalid', role: 'editor' })))
      .toMatchObject({ id: 7, method: 'POST', path: '/api/my/spaces/s1/invites' });
    expect(apiCallNeedingConfirmation(call('delete', '/api/my/spaces/s1/members/u2'))).not.toBeNull();
    expect(apiCallNeedingConfirmation(call('POST', '/api/my/invites/i1/accept'))).not.toBeNull();
    expect(apiCallNeedingConfirmation(call('POST', '/api/tutoring/students/c1/links'))).not.toBeNull();
    expect(apiCallNeedingConfirmation(call('POST', '/api/my/billing/checkout', { priceId: 'p' }))).not.toBeNull();
    // Passes the tool's path allowlist as a deck id, but decodes to the billing route.
    expect(apiCallNeedingConfirmation(call('POST', '/api/decks/%2e%2e%2fmy%2fbilling%2fcheckout'))).not.toBeNull();

    expect(apiCallNeedingConfirmation(call('POST', '/api/decks/d1/versions', {}))).toBeNull();
    expect(apiCallNeedingConfirmation(call('PUT', '/api/sessions/s1/record', {}))).toBeNull();
    expect(apiCallNeedingConfirmation(call('GET', '/api/my/spaces/s1/members'))).toBeNull();
  });

  it('allows the held call only on an explicit Allow answer', () => {
    const held = apiCallNeedingConfirmation(call('POST', '/api/my/spaces/s1/invites', { email: 'x@example.invalid' }));
    if (held === null) throw new Error('expected a held call');
    const ask = JSON.parse(confirmationRequest('openroom-confirm-1', held));
    expect(ask.params.name).toBe('ask_question');
    expect(ask.params.arguments.questions[0].prompt).toContain('POST /api/my/spaces/s1/invites with {"email":"x@example.invalid"}');
    expect(confirmationResponseId(JSON.stringify({ jsonrpc: '2.0', id: 'openroom-confirm-1', result: {} }))).toBe('openroom-confirm-1');
    expect(confirmationResponseId(JSON.stringify({ jsonrpc: '2.0', id: 7, result: {} }))).toBeNull();

    const answered = (answers: unknown, isError = false) =>
      JSON.stringify({ jsonrpc: '2.0', id: 'openroom-confirm-1', result: { isError, content: [{ type: 'text', text: JSON.stringify({ answers }) }] } });
    expect(confirmationAllowed(answered([{ questionId: 'confirm', optionIds: ['allow'] }]))).toBe(true);
    expect(confirmationAllowed(answered([{ questionId: 'confirm', optionIds: ['deny'] }]))).toBe(false);
    expect(confirmationAllowed(answered([{ questionId: 'confirm', optionIds: [], text: 'yes, allow' }]))).toBe(false);
    expect(confirmationAllowed(answered([{ questionId: 'confirm', optionIds: ['allow'] }], true))).toBe(false);
    expect(JSON.parse(confirmationRefusal(7))).toMatchObject({ id: 7, result: { isError: true } });
  });
});
