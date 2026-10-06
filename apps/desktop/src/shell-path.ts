import { execFile } from 'node:child_process';

/**
 * A desktop app launched from Finder, Dock, or Spotlight inherits only the system
 * directories — never Homebrew, nvm, volta, bun, or npm-global. Agent CLIs the teacher
 * installed then look missing to every `execFile` in this process. Resolving the login
 * shell's own PATH once at startup is the standard repair.
 */
const SYSTEM_PATH_ENTRIES = new Set(['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin']);
const SHELL_TIMEOUT_MS = 3_000;
const MARKER = '__openroom_path__';

export interface LoginShellDeps {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  run(shell: string, args: string[], timeoutMs: number): Promise<string>;
}

/** True when PATH holds nothing beyond what a windowed launch always provides. */
export function pathNeedsLoginShell(value: string | undefined): boolean {
  const entries = (value ?? '').split(':').filter((entry) => entry !== '');
  return entries.length === 0 || entries.every((entry) => SYSTEM_PATH_ENTRIES.has(entry));
}

/** Login shells print profiles, banners, and version notices; the markers fence off the value. */
export function parseMarkedPath(output: string): string | null {
  const match = new RegExp(`${MARKER}(.*)${MARKER}`, 's').exec(output);
  const value = match?.[1]?.trim();
  return value === undefined || value === '' ? null : value;
}

/** Shell entries win, since they carry the teacher's own tooling; current entries stay as fallback. */
export function mergedPath(current: string | undefined, resolved: string): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const entry of [...resolved.split(':'), ...(current ?? '').split(':')]) {
    if (entry === '' || entry.includes('\0') || seen.has(entry)) continue;
    seen.add(entry);
    merged.push(entry);
  }
  return merged.join(':');
}

function runLoginShell(shell: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      shell,
      args,
      { timeout: timeoutMs, encoding: 'utf8', killSignal: 'SIGKILL' },
      (_error, stdout) => resolve(stdout),
    );
  });
}

export function systemLoginShellDeps(): LoginShellDeps {
  return { env: process.env, platform: process.platform, run: runLoginShell };
}

/**
 * The PATH a terminal would see, or null when the current one is already complete, the
 * platform has no POSIX login shell, or the shell never answered.
 */
export async function loginShellPath(deps: LoginShellDeps = systemLoginShellDeps()): Promise<string | null> {
  if (deps.platform === 'win32') return null;
  if (!pathNeedsLoginShell(deps.env['PATH'])) return null;
  const shell = deps.env['SHELL'] ?? '/bin/zsh';
  const output = await deps.run(shell, ['-ilc', `echo "${MARKER}\${PATH}${MARKER}"`], SHELL_TIMEOUT_MS);
  return parseMarkedPath(output);
}

/** Widens this process's PATH so agent CLIs resolve wherever the teacher installed them. */
export async function adoptLoginShellPath(deps: LoginShellDeps = systemLoginShellDeps()): Promise<void> {
  const resolved = await loginShellPath(deps);
  if (resolved === null) return;
  deps.env['PATH'] = mergedPath(deps.env['PATH'], resolved);
}
