import { describe, expect, it } from 'vitest';

import { callTool, multiplexToolDeps, unavailableHostedDeps, type FileBinding, type ToolDeps } from '../src/index.js';

const outline = {
  version: 1,
  meta: { title: 'Local session' },
  steps: [
    { id: 'welcome', kind: 'title', title: 'Hello' },
    { id: 'check', kind: 'interaction', interactionId: 'check' },
  ],
  interactions: [
    {
      id: 'check',
      type: 'choice',
      prompt: 'Ready?',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
    },
  ],
};

function memoryFile(id = 'file-1'): FileBinding & { revision: number; stored: unknown } {
  const state = { revision: 1, stored: outline as unknown };
  return {
    fileId: id,
    get localRevision() {
      return state.revision;
    },
    title: 'Local session',
    getOutline: () => state.stored,
    saveOutline(next, base) {
      if (base !== state.revision) return { ok: false as const, conflict: true as const, latestVersion: state.revision };
      state.stored = next;
      state.revision += 1;
      return { ok: true as const, version: state.revision };
    },
    insertLocalImage: (sourcePath, alt) => ({ resourceId: 'img-1', path: 'resources/img-1.png', alt, sourcePath }),
    revision: 1,
    stored: outline,
  };
}

function hostedSpy(): ToolDeps & { created: unknown[] } {
  const created: unknown[] = [];
  return {
    created,
    createSession: async (session) => {
      created.push(session);
      return {
        sessionCode: 'SESSHOST',
        code: 'SESSHOST',
        joinUrl: 'https://join.test/?code=SESSHOST',
        hostToken: 'h',
        stageToken: 's',
      };
    },
    getExport: async () => ({ code: 'SESSHOST', status: 'live', interactions: [] }),
    controlRequest: async () => ({ status: 200, body: { hosted: true } }),
    sessionCommand: async () => ({ ok: true, hosted: true }),
  };
}

describe('MCP multiplexer', () => {
  it('saves a bound file without calling hosted design routes', async () => {
    const file = memoryFile();
    const hosted = hostedSpy();
    const deps = multiplexToolDeps(hosted, file);
    const got = await callTool(deps, 'deck_get', { deckId: 'file-1' });
    expect(got).toEqual(expect.objectContaining({ ok: true }));
    const saved = await callTool(deps, 'deck_save_version', {
      deckId: 'file-1',
      content: { ...outline, meta: { title: 'Edited' } },
      baseVersion: 1,
    });
    expect(saved).toEqual(expect.objectContaining({ ok: true, body: expect.objectContaining({ version: 2 }) }));
    const forwarded = await callTool(deps, 'deck_get', { deckId: 'cloud-design' });
    expect(forwarded).toEqual(expect.objectContaining({ ok: true, body: { hosted: true } }));
  });

  it('starts a local file through hosted createSession, never a local session runtime', async () => {
    const file = memoryFile();
    const hosted = hostedSpy();
    const deps = multiplexToolDeps(hosted, file);
    const started = (await callTool(deps, 'deck_start', { deckId: 'file-1' })) as {
      ok: boolean;
      body: { code: string };
    };
    expect(started.ok).toBe(true);
    expect(started.body.code).toBe('SESSHOST');
    expect(hosted.created).toHaveLength(1);
  });

  it('saves an unfinished local question but rejects starting it before calling hosted', async () => {
    const file = memoryFile();
    const hosted = hostedSpy();
    const deps = multiplexToolDeps(hosted, file);
    const saved = await callTool(deps, 'deck_save_version', {
      deckId: 'file-1', baseVersion: 1,
      content: { ...outline, interactions: outline.interactions.map((question) => ({ ...question, prompt: '' })) },
    });
    expect(saved).toMatchObject({ ok: true });
    const started = await callTool(deps, 'deck_start', { deckId: 'file-1' });
    expect(started).toMatchObject({ ok: false, status: 422 });
    expect(hosted.created).toHaveLength(0);
  });

  it('inserts an agent image onto the bound file via the local space assets path', async () => {
    const file = memoryFile();
    const deps = multiplexToolDeps(hostedSpy(), file);
    const inserted = await callTool(deps, 'openroom_api', {
      method: 'POST',
      path: '/api/tutoring/spaces/local/assets',
      body: { path: '/tmp/chart.png', alt: 'Chart' },
    });
    expect(inserted).toEqual(
      expect.objectContaining({
        ok: true,
        status: 201,
        body: expect.objectContaining({ resourceId: 'img-1', alt: 'Chart' }),
      }),
    );
  });

  it('session_results stays hosted and never grows a ballot tool', async () => {
    const deps = multiplexToolDeps(hostedSpy(), memoryFile());
    const results = await callTool(deps, 'session_results', { code: 'SESSHOST' });
    expect(results).toEqual(expect.objectContaining({ code: 'SESSHOST' }));
    await expect(callTool(deps, 'session_ballots', { code: 'SESSHOST' })).rejects.toThrow('unknown tool');
  });

  it('headless without a session refuses live sessions', async () => {
    const deps = multiplexToolDeps(unavailableHostedDeps(), memoryFile());
    await expect(callTool(deps, 'session_create', { outline: { version: 1, meta: { title: 'x' }, interactions: [{ id: 'a', type: 'text', prompt: 'p' }] } })).rejects.toThrow(
      'sign-in-required',
    );
  });
});
