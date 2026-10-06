import { describe, expect, it } from 'vitest';

import {
  bundledClaudeBinary,
  bundledCodexBinary,
  claudePlatformPackageName,
  hostBinary,
  isHostSignedIn,
  parseClaudeAuthStatus,
  parseCodexLoginStatus,
  type DetectDeps,
} from './detect.js';

function deps(overrides: Partial<DetectDeps> & { files?: Record<string, string>; bins?: string[] }): DetectDeps {
  const files = overrides.files ?? {};
  const bins = new Set(overrides.bins ?? ['claude', 'codex']);
  return {
    homedir: () => '/home/tutor',
    env: {},
    exists: (path) => path in files,
    readFile: (path) => files[path] ?? null,
    binaryAvailable: (bin) => bins.has(bin),
    claudeLoggedIn: () => false,
    codexLoggedIn: () => false,
    ...overrides,
  };
}

describe('isHostSignedIn', () => {
  it('treats Claude credential files as signed in', () => {
    expect(isHostSignedIn('claude', deps({ files: { '/home/tutor/.claude/credentials.json': '{}' } }))).toBe(true);
  });

  it('falls back to claude auth status when no credential file exists', () => {
    expect(isHostSignedIn('claude', deps({ claudeLoggedIn: () => true }))).toBe(true);
    expect(isHostSignedIn('claude', deps({}))).toBe(false);
  });

  it('treats Codex auth.json as signed in', () => {
    expect(isHostSignedIn('codex', deps({ files: { '/home/tutor/.codex/auth.json': '{}' } }))).toBe(true);
    expect(isHostSignedIn('codex', deps({}))).toBe(false);
  });

  it('honours binary overrides from the environment', () => {
    const env = { OPENROOM_CLAUDE_BIN: '/opt/claude' };
    expect(hostBinary('claude', env)).toBe('/opt/claude');
    expect(
      isHostSignedIn(
        'claude',
        deps({ env, bins: ['/opt/claude', 'codex'], claudeLoggedIn: (bin) => bin === '/opt/claude' }),
      ),
    ).toBe(true);
  });

});

describe('auth parsers', () => {
  it('reads Claude auth status JSON', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":true}')).toBe(true);
    expect(parseClaudeAuthStatus('{"loggedIn":false}')).toBe(false);
    expect(parseClaudeAuthStatus('not json')).toBe(false);
  });

  it('reads Codex login status text', () => {
    expect(parseCodexLoginStatus('Logged in using ChatGPT')).toBe(true);
    expect(parseCodexLoginStatus('Not logged in')).toBe(false);
  });
});

import { createHostDetector, type AsyncDetectDeps } from './detect.js';

function asyncDeps(overrides: Partial<AsyncDetectDeps> & { files?: Record<string, string>; bins?: string[] } = {}): AsyncDetectDeps {
  const files = overrides.files ?? {};
  const bins = new Set(overrides.bins ?? ['claude', 'codex']);
  return {
    homedir: () => '/home/tutor',
    env: {},
    exists: (path) => path in files,
    readFile: (path) => files[path] ?? null,
    binaryAvailable: async (bin) => bins.has(bin),
    claudeLoggedIn: async () => false,
    codexLoggedIn: async () => false,
    bundledCodexBinary: () => '/bundled/codex',
    bundledClaudeBinary: () => '/bundled/claude',
    ...overrides,
  };
}

describe('createHostDetector', () => {
  it('reports Claude and Codex as installed even with no CLI on PATH (SDKs bundle the runtime)', async () => {
    const detector = createHostDetector(asyncDeps({ bins: [] }));
    const hosts = await detector.list();
    expect(hosts.map((host) => [host.id, host.installed, host.loginAvailable])).toEqual([
      ['claude', true, true],
      ['codex', true, true],
      // The API-key host runs in-process: always installed, never a login flow.
      ['byok', true, false],
    ]);
    expect(hosts.find((host) => host.id === 'claude')?.binary).toBe('/bundled/claude');
    expect(hosts.find((host) => host.id === 'codex')?.binary).toBe('/bundled/codex');
  });

  it('signs the API-key host in exactly when a provider key is stored', async () => {
    const withKey = createHostDetector(asyncDeps({ byokConfigured: async () => ['google'] }));
    const withoutKey = createHostDetector(asyncDeps({ byokConfigured: async () => [] }));
    expect((await withKey.list()).find((host) => host.id === 'byok')?.signedIn).toBe(true);
    expect((await withoutKey.list()).find((host) => host.id === 'byok')?.signedIn).toBe(false);
  });

  it('caches within the TTL and re-probes after invalidate', async () => {
    let probes = 0;
    let clock = 0;
    const detector = createHostDetector(
      asyncDeps({
        binaryAvailable: async () => {
          probes += 1;
          return true;
        },
      }),
      { ttlMs: 1_000, now: () => clock },
    );
    await detector.list();
    await detector.list();
    expect(probes).toBe(2); // one probe per CLI host, second list served from cache

    clock = 2_000;
    await detector.list();
    expect(probes).toBe(4);

    detector.invalidate();
    await detector.list();
    expect(probes).toBe(6);
  });
});

describe('bundled SDK binaries', () => {
  it('walks from the Claude Agent SDK to the sibling platform package', () => {
    const binary = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const found = `/store/node_modules/@anthropic-ai/${claudePlatformPackageName()}/${binary}`;
    expect(
      bundledClaudeBinary({
        resolve: () => 'file:///store/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
        exists: (path) => path === found,
      }),
    ).toBe(found);
  });

  it('walks from the Codex SDK to the vendored platform binary', () => {
    const cpu = process.arch === 'arm64' ? 'arm64' : 'x64';
    const platformPackage = `codex-${process.platform}-${cpu}`;
    const triple =
      process.platform === 'darwin'
        ? process.arch === 'arm64'
          ? 'aarch64-apple-darwin'
          : 'x86_64-apple-darwin'
        : process.platform === 'win32'
          ? 'x86_64-pc-windows-msvc'
          : process.arch === 'arm64'
            ? 'aarch64-unknown-linux-musl'
            : 'x86_64-unknown-linux-musl';
    const binary = process.platform === 'win32' ? 'codex.exe' : 'codex';
    const found = `/store/node_modules/@openai/${platformPackage}/vendor/${triple}/bin/${binary}`;
    expect(
      bundledCodexBinary({
        resolve: () => 'file:///store/node_modules/@openai/codex-sdk/dist/index.js',
        exists: (path) => path === found,
      }),
    ).toBe(found);
  });
});
