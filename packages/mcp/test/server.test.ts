import { describe, expect, it } from 'vitest';

import { OUTLINE_STEP_KINDS } from '@openroom/schema';

import {
  buildMcpServerCard,
  DEFAULT_SERVER_INFO,
  handleMcpMessage,
  OUTLINE_SCHEMA_RESOURCE_URI,
  PROTOCOL_VERSION,
  TOOL_DEFINITIONS,
  type ToolDeps,
} from '../src/index.js';

const SERVER_INFO = { name: 'openroom-test', version: '0.0.0' };

const VALID_SESSION_YAML = `version: 1
meta:
  title: Test session
interactions:
  - id: q1
    type: choice
    prompt: Pick one
    options:
      - id: a
        label: A
      - id: b
        label: B
        correct: true
`;

const VALID_OUTLINE = {
  version: 1,
  meta: { title: 'French B1 revision', language: 'French', level: 'B1' },
  steps: [
    { id: 'welcome', kind: 'title', title: 'On commence', tutorNotes: 'Ask what felt difficult.' },
    { id: 'check', kind: 'interaction', interactionId: 'q1' },
  ],
  interactions: [
    {
      id: 'q1',
      type: 'choice',
      prompt: 'Pick one',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B', correct: true },
      ],
    },
  ],
};

function stubDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    createSession: async () => ({
      sessionCode: 'CODE1234',
      code: 'CODE1234',
      joinUrl: 'https://example.test/?code=CODE1234',
      hostToken: 'host-token',
      stageToken: 'stage-token',
    }),
    getExport: async () => null,
    controlRequest: async () => ({ status: 200, body: {} }),
    sessionCommand: async () => ({ ok: true, status: 200, body: {} }),
    ...overrides,
  };
}

function rpc(method: string, params?: Record<string, unknown>, id: number | undefined = 1) {
  return { jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, ...(params ? { params } : {}) };
}

function toolResultJson(response: Record<string, unknown> | null): any {
  const result = (response as any).result;
  expect(result.content[0].type).toBe('text');
  return JSON.parse(result.content[0].text);
}

describe('MCP protocol core', () => {
  it('initialize advertises tools plus the optional UI resource', async () => {
    const response = await handleMcpMessage(rpc('initialize'), stubDeps(), SERVER_INFO);
    const result = (response as any).result;
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.capabilities).toEqual({ tools: {}, resources: {} });
    expect(result.serverInfo).toEqual(SERVER_INFO);
    expect(typeof result.instructions).toBe('string');
    expect(result.instructions.length).toBeGreaterThan(0);
  });

  it('notifications (no id) return null', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      stubDeps(),
      SERVER_INFO,
    );
    expect(response).toBeNull();
  });

  it('lists and reads the versioned deck preview resource', async () => {
    const deps = stubDeps({ appOrigin: 'https://app.example.test/' });
    const listed = await handleMcpMessage(rpc('resources/list'), deps, SERVER_INFO);
    const resource = (listed as any).result.resources.find(
      (r: any) => r.uri === 'ui://openroom/deck-preview/v1.html',
    );
    expect(resource).toMatchObject({
      uri: 'ui://openroom/deck-preview/v1.html',
      mimeType: 'text/html+skybridge',
      _meta: {
        ui: { domain: 'https://app.example.test', prefersBorder: true },
        'openai/widgetDomain': 'https://app.example.test',
        'openai/widgetAccessible': true,
        'openai/outputTemplate': 'ui://openroom/deck-preview/v1.html',
      },
    });

    const read = await handleMcpMessage(
      rpc('resources/read', { uri: 'ui://openroom/deck-preview/v1.html' }),
      deps,
      SERVER_INFO,
    );
    expect((read as any).result.contents[0].text).toContain('<div id="app"');
    expect((read as any).result.contents[0].text).toContain('<script>');

    const missing = await handleMcpMessage(
      rpc('resources/read', { uri: 'ui://openroom/missing.html' }),
      deps,
      SERVER_INFO,
    );
    expect((missing as any).error.code).toBe(-32602);
  });

  it('lists a resource template for the deck preview widget', async () => {
    const listed = await handleMcpMessage(
      rpc('resources/templates/list'),
      stubDeps({ appOrigin: 'https://app.example.test/' }),
      SERVER_INFO,
    );
    expect((listed as any).result.resourceTemplates).toContainEqual(
      expect.objectContaining({
        uriTemplate: 'ui://openroom/deck-preview/v1.html',
        mimeType: 'text/html+skybridge',
      }),
    );
  });

  it('serves the outline schema so an agent can read the contract before authoring', async () => {
    const deps = stubDeps();
    const listed = await handleMcpMessage(rpc('resources/list'), deps, SERVER_INFO);
    expect((listed as any).result.resources).toContainEqual(
      expect.objectContaining({
        uri: OUTLINE_SCHEMA_RESOURCE_URI,
        mimeType: 'application/schema+json',
      }),
    );

    const read = await handleMcpMessage(
      rpc('resources/read', { uri: OUTLINE_SCHEMA_RESOURCE_URI }),
      deps,
      SERVER_INFO,
    );
    const schema = JSON.parse((read as any).result.contents[0].text);
    // The union an agent could not previously enumerate.
    expect(schema.$defs.step.oneOf).toHaveLength(OUTLINE_STEP_KINDS.length);
    expect(schema.required).toEqual(expect.arrayContaining(['version', 'meta', 'steps', 'interactions']));
  });

  it('batch requests are rejected with -32600', async () => {
    const response = await handleMcpMessage([rpc('ping')], stubDeps(), SERVER_INFO);
    expect((response as any).error.code).toBe(-32600);
  });

  it('tools/list exposes validation, business API, session creation, control, and results', async () => {
    const response = await handleMcpMessage(rpc('tools/list'), stubDeps(), SERVER_INFO);
    const names = (response as any).result.tools.map((t: any) => t.name);
    expect(names).toEqual([
      'outline_validate',
      'session_create',
      'session_status',
      'session_results',
      'openroom_api',
      'deck_get',
      'deck_preview',
      'deck_save_version',
      'deck_draft_put',
      'deck_start',
      'session_facilitate',
      'session_recap',
      'session_command',
      'picture_search',
    ]);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
      expect(typeof tool.annotations?.readOnlyHint).toBe('boolean');
      expect(typeof tool.annotations?.destructiveHint).toBe('boolean');
      expect(typeof tool.annotations?.openWorldHint).toBe('boolean');
      expect(tool.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['mcp'] }]);
      expect(tool._meta).toMatchObject({ securitySchemes: [{ type: 'oauth2', scopes: ['mcp'] }] });
    }
  });

  it('outline_validate accepts a typed outline and reports its compiled interactions', async () => {
    const response = await handleMcpMessage(
      rpc('tools/call', { name: 'outline_validate', arguments: { outline: VALID_OUTLINE } }),
      stubDeps(),
      SERVER_INFO,
    );
    expect(toolResultJson(response)).toEqual({
      ok: true,
      title: 'French B1 revision',
      stepCount: 2,
      interactionCount: 1,
      steps: [
        { id: 'welcome', kind: 'title' },
        { id: 'check', kind: 'interaction' },
      ],
    });
  });

  it('outline_validate accepts a typed full-slide iframe element', async () => {
    const iframeOutline = structuredClone(VALID_OUTLINE);
    iframeOutline.steps.splice(1, 0, {
      id: 'article',
      kind: 'blank',
      elements: [
        {
          id: 'news',
          type: 'iframe',
          url: 'https://example.test/embed/article',
          title: 'News article',
          box: { x: 0, y: 0, w: 100, h: 100 },
        },
      ],
    } as (typeof iframeOutline.steps)[number]);
    const response = await handleMcpMessage(
      rpc('tools/call', { name: 'outline_validate', arguments: { outline: iframeOutline } }),
      stubDeps(),
      SERVER_INFO,
    );
    expect(toolResultJson(response)).toMatchObject({
      ok: true,
      stepCount: 3,
      steps: [{ id: 'welcome' }, { id: 'article', kind: 'blank' }, { id: 'check' }],
    });
  });

  it('outline_validate accepts a typed scrollable PDF element', async () => {
    const pdfOutline = structuredClone(VALID_OUTLINE);
    pdfOutline.steps.splice(1, 0, {
      id: 'handout',
      kind: 'blank',
      elements: [
        {
          id: 'document',
          type: 'pdf',
          url: 'https://example.test/handout.pdf',
          title: 'Lesson handout',
          box: { x: 0, y: 0, w: 100, h: 100 },
        },
      ],
    } as (typeof pdfOutline.steps)[number]);
    const response = await handleMcpMessage(
      rpc('tools/call', { name: 'outline_validate', arguments: { outline: pdfOutline } }),
      stubDeps(),
      SERVER_INFO,
    );
    expect(toolResultJson(response)).toMatchObject({
      ok: true,
      stepCount: 3,
      steps: [{ id: 'welcome' }, { id: 'handout', kind: 'blank' }, { id: 'check' }],
    });
  });

  it('session_create compiles a poll list to an outline and returns tokens', async () => {
    const bad = await handleMcpMessage(
      rpc('tools/call', { name: 'session_create', arguments: { outline: 'nope' } }),
      stubDeps(),
      SERVER_INFO,
    );
    expect(toolResultJson(bad).ok).toBe(false);

    const good = await handleMcpMessage(
      rpc('tools/call', { name: 'session_create', arguments: { outline: VALID_SESSION_YAML } }),
      stubDeps(),
      SERVER_INFO,
    );
    const value = toolResultJson(good);
    expect(value.ok).toBe(true);
    expect(value.code).toBe('CODE1234');
    expect(value.hostToken).toBe('host-token');
  });

  it('session_status on a missing session is a tool error result, not a protocol error', async () => {
    const response = await handleMcpMessage(
      rpc('tools/call', { name: 'session_status', arguments: { code: 'NOPE0000' } }),
      stubDeps(),
      SERVER_INFO,
    );
    expect((response as any).result.isError).toBe(true);
    expect(toolResultJson(response)).toEqual({ error: 'session-not-found' });
  });

  it('session_results slices to one interaction when interactionId is given', async () => {
    const exported = {
      summary: { title: 'Result', questions: [{ prompt: 'One', rows: [], entries: [] }, { prompt: 'Two', rows: [], entries: ['A suggestion'] }] },
      sessionCode: 'R',
      code: 'R',
      status: 'live',
      revision: 4,
      participantCount: 2,
      interactions: [
        { id: 'q1', prompt: 'One', type: 'choice', status: 'revealed', aggregate: { kind: 'choice' } },
        { id: 'q2', prompt: 'Two', type: 'text', status: 'pending', aggregate: null },
      ],
    };
    const deps = stubDeps({ getExport: async () => exported });
    const response = await handleMcpMessage(
      rpc('tools/call', { name: 'session_results', arguments: { code: 'R', interactionId: 'q2' } }),
      deps,
      SERVER_INFO,
    );
    const value = toolResultJson(response);
    expect(value.interactions).toHaveLength(1);
    expect(value.interactions[0].id).toBe('q2');
    expect(value.summary).toEqual({ title: 'Result', questions: [{ prompt: 'Two', rows: [], entries: ['A suggestion'] }] });
  });

  it('openroom_api delegates only allowlisted tutoring paths and preserves status', async () => {
    const calls: unknown[] = [];
    const deps = stubDeps({
      controlRequest: async (method, path, body) => {
        calls.push({ method, path, body });
        return { status: 201, body: { learner: { id: 'learner-1' } } };
      },
    });
    const response = await handleMcpMessage(
      rpc('tools/call', {
        name: 'openroom_api',
        arguments: {
          method: 'POST',
          path: '/api/tutoring/contexts',
          body: { displayName: 'Camille' },
        },
      }),
      deps,
      SERVER_INFO,
    );
    expect(toolResultJson(response)).toEqual({
      ok: true,
      status: 201,
      body: { learner: { id: 'learner-1' } },
    });
    expect(calls).toEqual([{
      method: 'POST',
      path: '/api/tutoring/contexts',
      body: { displayName: 'Camille' },
    }]);

    const blocked = await handleMcpMessage(
      rpc('tools/call', {
        name: 'openroom_api',
        arguments: { method: 'POST', path: '/confirm-deletion/token' },
      }),
      deps,
      SERVER_INFO,
    );
    expect((blocked as any).result.isError).toBe(true);
    expect(toolResultJson(blocked)).toEqual({ error: 'path is outside the tutoring API allowlist' });
  });

  it('deck_get reads a deck and passes a requested version through', async () => {
    const calls: unknown[] = [];
    const deps = stubDeps({
      controlRequest: async (method, path, body) => {
        calls.push({ method, path, body });
        return { status: 200, body: { deck: { id: 'd1', currentVersion: 3 }, content: VALID_OUTLINE } };
      },
    });
    const plain = await handleMcpMessage(
      rpc('tools/call', { name: 'deck_get', arguments: { deckId: 'd1' } }),
      deps,
      SERVER_INFO,
    );
    expect(toolResultJson(plain).ok).toBe(true);
    await handleMcpMessage(
      rpc('tools/call', { name: 'deck_get', arguments: { deckId: 'd 1', version: 2 } }),
      deps,
      SERVER_INFO,
    );
    expect(calls).toEqual([
      { method: 'GET', path: '/api/decks/d1', body: undefined },
      { method: 'GET', path: '/api/decks/d%201?version=2', body: undefined },
    ]);
  });

  it('deck_preview returns structured content while retaining JSON text fallback', async () => {
    const response = await handleMcpMessage(
      rpc('tools/call', { name: 'deck_preview', arguments: { outline: VALID_OUTLINE } }),
      stubDeps({ appOrigin: 'https://app.example.test/' }),
      SERVER_INFO,
    );
    const value = toolResultJson(response);
    expect(value).toMatchObject({
      ok: true,
      previewVersion: 1,
      source: { kind: 'draft' },
      outline: VALID_OUTLINE,
      links: { assetOrigin: 'https://app.example.test' },
    });
    expect((response as any).result.structuredContent).toEqual(value);
    expect((response as any).result._meta).toMatchObject({
      'openai/outputTemplate': 'ui://openroom/deck-preview/v1.html',
      'openai/widgetAccessible': true,
    });

    const definition = TOOL_DEFINITIONS.find((tool) => tool.name === 'deck_preview');
    expect(definition?._meta).toMatchObject({
      ui: { resourceUri: 'ui://openroom/deck-preview/v1.html' },
      'openai/outputTemplate': 'ui://openroom/deck-preview/v1.html',
      'openai/widgetAccessible': true,
    });
  });

  it('deck_preview reads a saved version and supplies Desktop plus browser handoffs', async () => {
    const calls: unknown[] = [];
    const response = await handleMcpMessage(
      rpc('tools/call', { name: 'deck_preview', arguments: { deckId: 'deck one', version: 2 } }),
      stubDeps({
        appOrigin: 'https://app.example.test',
        controlRequest: async (method, path, body) => {
          calls.push({ method, path, body });
          return {
            status: 200,
            body: {
              deck: { id: 'deck one', currentVersion: 4 },
              contentVersion: 2,
              content: VALID_OUTLINE,
            },
          };
        },
      }),
      SERVER_INFO,
    );
    expect(toolResultJson(response)).toMatchObject({
      ok: true,
      source: { kind: 'deck', deckId: 'deck one', version: 2, currentVersion: 4 },
      links: {
        browserEditorUrl: 'https://app.example.test/host/#/decks/deck%20one/edit',
        desktopHandoffUrl: 'https://app.example.test/desktop/open?deckId=deck%20one',
      },
    });
    expect(calls).toEqual([
      { method: 'GET', path: '/api/decks/deck%20one?version=2', body: undefined },
    ]);
  });

  it('deck_preview rejects ambiguous sources and draft versions', async () => {
    for (const argumentsValue of [
      {},
      { outline: VALID_OUTLINE, deckId: 'd1' },
      { outline: VALID_OUTLINE, version: 1 },
    ]) {
      const response = await handleMcpMessage(
        rpc('tools/call', { name: 'deck_preview', arguments: argumentsValue }),
        stubDeps(),
        SERVER_INFO,
      );
      expect((response as any).result.isError).toBe(true);
    }
  });

  it('deck_save_version validates before sending and refuses without baseVersion', async () => {
    let called = false;
    const deps = stubDeps({
      controlRequest: async () => {
        called = true;
        return { status: 201, body: { deckId: 'd1', version: 4 } };
      },
    });
    const invalid = await handleMcpMessage(
      rpc('tools/call', {
        name: 'deck_save_version',
        arguments: { deckId: 'd1', content: { version: 1 }, baseVersion: 3 },
      }),
      deps,
      SERVER_INFO,
    );
    expect(toolResultJson(invalid).ok).toBe(false);
    expect(Array.isArray(toolResultJson(invalid).errors)).toBe(true);
    expect(called).toBe(false);

    const missingBase = await handleMcpMessage(
      rpc('tools/call', {
        name: 'deck_save_version',
        arguments: { deckId: 'd1', content: VALID_OUTLINE },
      }),
      deps,
      SERVER_INFO,
    );
    expect((missingBase as any).result.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('deck_save_version sends the compiled outline and explains a version conflict', async () => {
    const calls: unknown[] = [];
    const ok = await handleMcpMessage(
      rpc('tools/call', {
        name: 'deck_save_version',
        arguments: { deckId: 'd1', content: VALID_OUTLINE, baseVersion: 3 },
      }),
      stubDeps({
        controlRequest: async (method, path, body) => {
          calls.push({ method, path, body });
          return { status: 201, body: { deckId: 'd1', version: 4 } };
        },
      }),
      SERVER_INFO,
    );
    expect(toolResultJson(ok)).toMatchObject({ ok: true, status: 201 });
    expect(calls).toEqual([{
      method: 'POST',
      path: '/api/decks/d1/versions',
      body: { content: VALID_OUTLINE, baseVersion: 3 },
    }]);

    const conflict = await handleMcpMessage(
      rpc('tools/call', {
        name: 'deck_save_version',
        arguments: { deckId: 'd1', content: VALID_OUTLINE, baseVersion: 3 },
      }),
      stubDeps({
        controlRequest: async () => ({
          status: 409,
          body: { error: 'version-conflict', latestVersion: 5 },
        }),
      }),
      SERVER_INFO,
    );
    const value = toolResultJson(conflict);
    expect(value.ok).toBe(false);
    expect(value.status).toBe(409);
    expect(value.body).toEqual({ error: 'version-conflict', latestVersion: 5 });
    expect(String(value.hint)).toContain('deck_get');
  });

  it('deck_draft_put stores unvalidated working text', async () => {
    const calls: unknown[] = [];
    const response = await handleMcpMessage(
      rpc('tools/call', {
        name: 'deck_draft_put',
        arguments: { deckId: 'd1', source: 'version: 1\nmeta:\n  title: half typed', baseVersion: 2 },
      }),
      stubDeps({
        controlRequest: async (method, path, body) => {
          calls.push({ method, path, body });
          return { status: 200, body: { deckId: 'd1', savedAt: 1700000000000 } };
        },
      }),
      SERVER_INFO,
    );
    expect(toolResultJson(response)).toMatchObject({ ok: true, status: 200 });
    expect(calls).toEqual([{
      method: 'PUT',
      path: '/api/decks/d1/draft',
      body: { source: 'version: 1\nmeta:\n  title: half typed', baseVersion: 2 },
    }]);
  });

  it('deck_start files a session and then launches it', async () => {
    const calls: unknown[] = [];
    const response = await handleMcpMessage(
      rpc('tools/call', { name: 'deck_start', arguments: { deckId: 'd1', version: 2 } }),
      stubDeps({
        controlRequest: async (method, path, body) => {
          calls.push({ method, path, body });
          if (path === '/api/sessions') return { status: 201, body: { session: { id: 'sess-9' } } };
          return {
            status: 201,
            body: { sessionCode: 'CODE1234', code: 'CODE1234', joinUrl: 'https://x.test/?code=CODE1234' },
          };
        },
      }),
      SERVER_INFO,
    );
    expect(toolResultJson(response)).toMatchObject({ ok: true, sessionId: 'sess-9', status: 201 });
    expect(calls).toEqual([
      { method: 'POST', path: '/api/sessions', body: { deckId: 'd1', deckVersion: 2 } },
      { method: 'POST', path: '/api/sessions/sess-9/launch', body: { start: true } },
    ]);
  });

  it('deck_start reports the create failure rather than launching nothing', async () => {
    const response = await handleMcpMessage(
      rpc('tools/call', { name: 'deck_start', arguments: { deckId: 'gone' } }),
      stubDeps({
        controlRequest: async () => ({ status: 404, body: { error: 'deck-not-found' } }),
      }),
      SERVER_INFO,
    );
    expect(toolResultJson(response)).toEqual({
      ok: false,
      status: 404,
      body: { error: 'deck-not-found' },
    });
  });

  it('session_command delegates an arbitrary host command to the owned session adapter', async () => {
    const calls: unknown[] = [];
    const deps = stubDeps({
      sessionCommand: async (code, command, options) => {
        calls.push({ code, command, options });
        return { ok: true, status: 200, body: { revision: 7 } };
      },
    });
    const response = await handleMcpMessage(
      rpc('tools/call', {
        name: 'session_command',
        arguments: {
          code: 'CODE1234',
          command: { command: 'outline.next' },
          idempotencyKey: 'retry-1',
          expectedRevision: 6,
        },
      }),
      deps,
      SERVER_INFO,
    );
    expect(toolResultJson(response)).toEqual({ ok: true, status: 200, body: { revision: 7 } });
    expect(calls).toEqual([{
      code: 'CODE1234',
      command: { command: 'outline.next' },
      options: { idempotencyKey: 'retry-1', expectedRevision: 6 },
    }]);
  });

  it('session_command rejects command objects without a string command field', async () => {
    const response = await handleMcpMessage(
      rpc('tools/call', {
        name: 'session_command',
        arguments: { code: 'CODE1234', command: { name: 'outline.next' } },
      }),
      stubDeps(),
      SERVER_INFO,
    );
    expect((response as { result: { isError: boolean } }).result.isError).toBe(true);
    expect(toolResultJson(response)).toEqual({
      error: 'command.command must be a non-empty string (e.g. "outline.next")',
    });
  });

  it('picture_search shapes stock hits into a pasteable media object without a caption', async () => {
    const deps = stubDeps({
      controlRequest: async () => ({
        status: 200,
        body: {
          hits: [
            {
              id: 195893,
              previewUrl: 'https://cdn.pixabay.com/preview.jpg',
              imageUrl: 'https://pixabay.com/get/large.jpg',
              pageUrl: 'https://pixabay.com/photos/red-roses-195893/',
              tags: 'roses, red, flower',
              user: 'anna',
              width: 1280,
              height: 853,
            },
            { id: 2, imageUrl: '' },
          ],
          totalHits: 312,
          page: 1,
          source: 'Pixabay',
        },
      }),
    });
    const response = await handleMcpMessage(
      rpc('tools/call', { name: 'picture_search', arguments: { query: 'roses' } }),
      deps,
      SERVER_INFO,
    );
    const value = toolResultJson(response);
    expect(value.ok).toBe(true);
    expect(value.totalHits).toBe(312);
    expect(value.pictures).toHaveLength(1);
    expect(value.pictures[0].media).toEqual({
      type: 'image',
      url: 'https://pixabay.com/get/large.jpg',
      alt: 'roses, red, flower',
    });
    // The credit is rendered from the URL; an authored caption would replace it.
    expect(value.pictures[0].media.caption).toBeUndefined();
    expect(value.pictures[0].pageUrl).toBe('https://pixabay.com/photos/red-roses-195893/');
  });

  it('picture_search sends the query and page, and omits both when browsing', async () => {
    const calls: unknown[] = [];
    const deps = stubDeps({
      controlRequest: async (method, path) => {
        calls.push({ method, path });
        return { status: 200, body: { hits: [], totalHits: 0, page: 1, source: 'Pixabay' } };
      },
    });
    await handleMcpMessage(
      rpc('tools/call', { name: 'picture_search', arguments: { query: 'roses', page: 2 } }),
      deps,
      SERVER_INFO,
    );
    await handleMcpMessage(
      rpc('tools/call', { name: 'picture_search', arguments: {} }),
      deps,
      SERVER_INFO,
    );
    expect(calls).toEqual([
      { method: 'GET', path: '/api/tutoring/stock?q=roses&page=2' },
      { method: 'GET', path: '/api/tutoring/stock' },
    ]);
  });

  it('picture_search rejects an out-of-range page before calling the API', async () => {
    const calls: unknown[] = [];
    const deps = stubDeps({
      controlRequest: async (method, path) => {
        calls.push({ method, path });
        return { status: 200, body: {} };
      },
    });
    for (const page of [0, 99, 1.5]) {
      const response = await handleMcpMessage(
        rpc('tools/call', { name: 'picture_search', arguments: { page } }),
        deps,
        SERVER_INFO,
      );
      expect((response as { result: { isError: boolean } }).result.isError).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it('picture_search names an unconfigured deployment instead of returning a bare 501', async () => {
    const deps = stubDeps({
      controlRequest: async () => ({ status: 501, body: { error: 'stock-unconfigured' } }),
    });
    const response = await handleMcpMessage(
      rpc('tools/call', { name: 'picture_search', arguments: { query: 'roses' } }),
      deps,
      SERVER_INFO,
    );
    const value = toolResultJson(response);
    expect(value.ok).toBe(false);
    expect(value.status).toBe(501);
    expect(value.hint).toContain('not configured');
  });

  it('unknown tool -> isError result', async () => {
    const response = await handleMcpMessage(
      rpc('tools/call', { name: 'deck_delete', arguments: {} }),
      stubDeps(),
      SERVER_INFO,
    );
    expect((response as any).result.isError).toBe(true);
  });
});

describe('MCP Server Card', () => {
  it('buildMcpServerCard advertises streamable-http endpoint and tools capability', () => {
    const card = buildMcpServerCard({ origin: 'https://openroom.app' });
    expect(card.serverInfo.name).toBe(DEFAULT_SERVER_INFO.name);
    expect(card.serverInfo.version).toBe(DEFAULT_SERVER_INFO.version);
    expect(card.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(card.transport).toEqual({
      type: 'streamable-http',
      endpoint: 'https://openroom.app/api/mcp',
    });
    expect(card.capabilities.tools).toBe(true);
    expect(card.capabilities.resources).toBe(true);
    expect(card.capabilities.prompts).toBe(false);
    expect(card.tools.map((t) => t.name)).toEqual([
      'outline_validate',
      'session_create',
      'session_status',
      'session_results',
      'openroom_api',
      'deck_get',
      'deck_preview',
      'deck_save_version',
      'deck_draft_put',
      'deck_start',
      'session_facilitate',
      'session_recap',
      'session_command',
      'picture_search',
    ]);
  });
});
