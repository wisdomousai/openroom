import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { AGENT_HOSTS, AGENT_HOST_ORDER, type AgentHostId, type AgentHostStatus } from './types.js';

export interface DetectDeps {
  homedir(): string;
  env: NodeJS.ProcessEnv;
  exists(path: string): boolean;
  readFile(path: string): string | null;
  binaryAvailable(bin: string): boolean;
  claudeLoggedIn(bin: string): boolean;
  codexLoggedIn(bin: string): boolean;
}

const VERSION_TIMEOUT_MS = 3_000;
const AUTH_TIMEOUT_MS = 4_000;

export function claudeCredentialPaths(home: string): string[] {
  return [join(home, '.claude', 'credentials.json'), join(home, '.claude', '.credentials.json')];
}

export function codexAuthPath(home: string): string {
  return join(home, '.codex', 'auth.json');
}

/** The API-key host has no binary: its "sign-in" is a stored key. */
export function hostBinary(id: AgentHostId, env: NodeJS.ProcessEnv): string {
  if (id === 'claude') return env['OPENROOM_CLAUDE_BIN'] ?? 'claude';
  if (id === 'codex') return env['OPENROOM_CODEX_BIN'] ?? 'codex';
  return '';
}

export function parseClaudeAuthStatus(stdout: string): boolean {
  const trimmed = stdout.trim();
  if (trimmed === '') return false;
  try {
    const parsed = JSON.parse(trimmed) as { loggedIn?: unknown };
    return parsed.loggedIn === true;
  } catch {
    return /"loggedIn"\s*:\s*true/.test(trimmed);
  }
}

export function parseCodexLoginStatus(stdout: string): boolean {
  return /logged in/i.test(stdout) && !/not logged in/i.test(stdout);
}

function spawnAvailable(bin: string): boolean {
  const result = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: VERSION_TIMEOUT_MS });
  return result.error === undefined && result.status === 0;
}

function spawnText(bin: string, args: string[], timeout: number): string {
  const result = spawnSync(bin, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) return '';
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

export function systemDetectDeps(): DetectDeps {
  return {
    homedir,
    env: process.env,
    exists: existsSync,
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    binaryAvailable: spawnAvailable,
    claudeLoggedIn: (bin) => parseClaudeAuthStatus(spawnText(bin, ['auth', 'status'], AUTH_TIMEOUT_MS)),
    codexLoggedIn: (bin) => parseCodexLoginStatus(spawnText(bin, ['login', 'status'], AUTH_TIMEOUT_MS)),
  };
}

export function isHostSignedIn(id: AgentHostId, deps: DetectDeps): boolean {
  const home = deps.homedir();
  if (id === 'claude') {
    if (claudeCredentialPaths(home).some((path) => deps.exists(path))) return true;
    const bin = hostBinary(id, deps.env);
    return deps.binaryAvailable(bin) ? deps.claudeLoggedIn(bin) : false;
  }
  if (id === 'codex') {
    if (deps.exists(codexAuthPath(home))) return true;
    const bin = hostBinary(id, deps.env);
    return deps.binaryAvailable(bin) ? deps.codexLoggedIn(bin) : false;
  }
  // BYOK sign-in is a stored key, which only the async detector can read.
  return false;
}

/**
 * The Codex SDK ships the codex binary inside @openai/codex vendor packages.
 * Used for the sign-in flow when the tutor never installed the codex CLI.
 */
function resolvedPath(urlOrPath: string): string {
  const path = urlOrPath.startsWith('file:') ? fileURLToPath(urlOrPath) : urlOrPath;
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function bundledCodexBinary(deps: { resolve?: (specifier: string) => string; exists?: (path: string) => boolean } = {}): string | null {
  const resolve = deps.resolve ?? ((specifier: string) => import.meta.resolve(specifier));
  const exists = deps.exists ?? existsSync;
  let sdkEntry: string;
  try {
    sdkEntry = resolvedPath(resolve('@openai/codex-sdk'));
  } catch {
    return null;
  }
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
  const platformPackage = `codex-${process.platform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  // dist/index.js -> package root -> walk node_modules for @openai/codex-<platform> (vendor holds the binary)
  let dir = dirname(sdkEntry);
  for (let depth = 0; depth < 8; depth += 1) {
    for (const name of [platformPackage, 'codex']) {
      const packageDir = join(dir, 'node_modules', '@openai', name);
      const root = resolvedPath(packageDir);
      const vendored = join(root, 'vendor', triple, 'bin', binaryName);
      if (exists(vendored)) return vendored;
      // The platform package can sit next to the resolved @openai/codex (store layouts).
      const sibling = join(dirname(root), platformPackage, 'vendor', triple, 'bin', binaryName);
      if (exists(sibling)) return sibling;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * The Claude Agent SDK ships its CLI as @anthropic-ai/claude-agent-sdk-<platform>.
 * Used for the sign-in flow when the tutor never installed Claude Code.
 */
export function claudePlatformPackageName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `claude-agent-sdk-${platform}-${arch === 'arm64' ? 'arm64' : 'x64'}`;
}

export function bundledClaudeBinary(deps: { resolve?: (specifier: string) => string; exists?: (path: string) => boolean } = {}): string | null {
  const resolve = deps.resolve ?? ((specifier: string) => import.meta.resolve(specifier));
  const exists = deps.exists ?? existsSync;
  let sdkEntry: string;
  try {
    sdkEntry = resolvedPath(resolve('@anthropic-ai/claude-agent-sdk'));
  } catch {
    return null;
  }
  const platformPackage = claudePlatformPackageName();
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
  let dir = dirname(sdkEntry);
  for (let depth = 0; depth < 8; depth += 1) {
    const packageDir = join(dir, 'node_modules', '@anthropic-ai', platformPackage);
    const root = resolvedPath(packageDir);
    const vendored = join(root, binaryName);
    if (exists(vendored)) return vendored;
    const sibling = join(dirname(root), platformPackage, binaryName);
    if (exists(sibling)) return sibling;
    const nextTo = join(dir, platformPackage, binaryName);
    if (exists(nextTo)) return nextTo;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export interface AsyncDetectDeps {
  homedir(): string;
  env: NodeJS.ProcessEnv;
  exists(path: string): boolean;
  readFile(path: string): string | null;
  binaryAvailable(bin: string): Promise<boolean>;
  claudeLoggedIn(bin: string): Promise<boolean>;
  codexLoggedIn(bin: string): Promise<boolean>;
  bundledCodexBinary(): string | null;
  bundledClaudeBinary(): string | null;
  /** Provider ids with a usable API key; the API-key host is signed in when any exist. */
  byokConfigured?(): Promise<string[]>;
}

function execAvailable(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: VERSION_TIMEOUT_MS }, (error) => {
      resolve(error === null);
    });
  });
}

function execText(bin: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve(error !== null && stdout === '' && stderr === '' ? '' : `${stdout}\n${stderr}`);
    });
  });
}

export function systemAsyncDetectDeps(
  options: { byokConfigured?: () => Promise<string[]> } = {},
): AsyncDetectDeps {
  const sync = systemDetectDeps();
  return {
    homedir: sync.homedir,
    env: sync.env,
    exists: sync.exists,
    readFile: sync.readFile,
    binaryAvailable: execAvailable,
    claudeLoggedIn: async (bin) => parseClaudeAuthStatus(await execText(bin, ['auth', 'status'], AUTH_TIMEOUT_MS)),
    codexLoggedIn: async (bin) => parseCodexLoginStatus(await execText(bin, ['login', 'status'], AUTH_TIMEOUT_MS)),
    bundledCodexBinary: () => bundledCodexBinary(),
    bundledClaudeBinary: () => bundledClaudeBinary(),
    ...options,
  };
}

async function detectHostAsync(id: AgentHostId, deps: AsyncDetectDeps): Promise<AgentHostStatus> {
  const home = deps.homedir();
  const binary = hostBinary(id, deps.env);
  if (id === 'claude') {
    // The Agent SDK bundles the Claude runtime, so running is always possible.
    const bundled = deps.bundledClaudeBinary();
    const binaryDetected = await deps.binaryAvailable(binary);
    const resolved = binaryDetected ? binary : (bundled ?? binary);
    const signedIn = claudeCredentialPaths(home).some((path) => deps.exists(path))
      ? true
      : binaryDetected && (await deps.claudeLoggedIn(binary));
    return {
      ...AGENT_HOSTS[id],
      binary: resolved,
      installed: true,
      signedIn,
      loginAvailable: binaryDetected || bundled !== null,
      runtimeVersion: null,
      detail: null,
    };
  }
  if (id === 'codex') {
    const bundled = deps.bundledCodexBinary();
    const binaryDetected = await deps.binaryAvailable(binary);
    const signedIn = deps.exists(codexAuthPath(home))
      ? true
      : binaryDetected && (await deps.codexLoggedIn(binary));
    return {
      ...AGENT_HOSTS[id],
      binary: binaryDetected ? binary : (bundled ?? binary),
      installed: true,
      signedIn,
      loginAvailable: binaryDetected || bundled !== null,
      runtimeVersion: null,
      detail: null,
    };
  }
  // The API-key host runs in this process. Nothing to install, nothing to sign
  // into: it is ready as soon as one provider key is stored.
  const configured = (await deps.byokConfigured?.()) ?? [];
  return {
    ...AGENT_HOSTS[id],
    binary,
    installed: true,
    signedIn: configured.length > 0,
    loginAvailable: false,
    runtimeVersion: null,
    detail: null,
  };
}

export async function detectAgentHostsAsync(deps: AsyncDetectDeps): Promise<AgentHostStatus[]> {
  return Promise.all(AGENT_HOST_ORDER.map((id) => detectHostAsync(id, deps)));
}

export interface HostDetector {
  list(): Promise<AgentHostStatus[]>;
  invalidate(): void;
}

const DETECT_TTL_MS = 15_000;

export function createHostDetector(
  deps: AsyncDetectDeps = systemAsyncDetectDeps(),
  options: { ttlMs?: number; now?: () => number } = {},
): HostDetector {
  const ttl = options.ttlMs ?? DETECT_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: { at: number; value: Promise<AgentHostStatus[]> } | null = null;
  return {
    list() {
      if (cached !== null && now() - cached.at < ttl) return cached.value;
      const value = detectAgentHostsAsync(deps);
      cached = { at: now(), value };
      // A failed probe must not poison the cache.
      value.catch(() => {
        cached = null;
      });
      return value;
    },
    invalidate() {
      cached = null;
    },
  };
}
