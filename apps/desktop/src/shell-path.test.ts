import { describe, expect, it } from 'vitest';

import { adoptLoginShellPath, mergedPath, parseMarkedPath, pathNeedsLoginShell } from './shell-path.js';

const WINDOWED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const SHELL_PATH = '/opt/homebrew/bin:/usr/bin:/bin';

describe('login shell PATH', () => {
  it('treats a windowed launch PATH as incomplete and a terminal PATH as complete', () => {
    expect(pathNeedsLoginShell(WINDOWED_PATH)).toBe(true);
    expect(pathNeedsLoginShell(undefined)).toBe(true);
    expect(pathNeedsLoginShell(SHELL_PATH)).toBe(false);
  });

  it('reads the value past profile banners the login shell prints first', () => {
    expect(parseMarkedPath(`Welcome!\nnode v22 available\n__openroom_path__${SHELL_PATH}__openroom_path__\n`))
      .toBe(SHELL_PATH);
    expect(parseMarkedPath('command not found')).toBe(null);
  });

  it('puts shell entries first and never repeats one', () => {
    expect(mergedPath(WINDOWED_PATH, SHELL_PATH)).toBe('/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  });

  it('widens a windowed PATH so a Homebrew CLI resolves', async () => {
    const env: NodeJS.ProcessEnv = { PATH: WINDOWED_PATH, SHELL: '/bin/zsh' };
    await adoptLoginShellPath({
      env,
      platform: 'darwin',
      run: async () => `__openroom_path__${SHELL_PATH}__openroom_path__`,
    });
    expect(env['PATH']).toContain('/opt/homebrew/bin');
  });

  it('leaves a complete PATH alone and never spawns a shell for it', async () => {
    const env: NodeJS.ProcessEnv = { PATH: SHELL_PATH };
    let spawned = false;
    await adoptLoginShellPath({
      env,
      platform: 'darwin',
      run: async () => {
        spawned = true;
        return '';
      },
    });
    expect(spawned).toBe(false);
    expect(env['PATH']).toBe(SHELL_PATH);
  });

  it('does not shell out on Windows', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '' };
    await adoptLoginShellPath({
      env,
      platform: 'win32',
      run: async () => {
        throw new Error('no login shell on Windows');
      },
    });
    expect(env['PATH']).toBe('');
  });
});
