import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AGENT_CHANNELS } from './channels.js';

describe('agent IPC channel contract', () => {
  it('pins the wire names', () => {
    expect(AGENT_CHANNELS).toEqual({
      list: 'desktop:agents:list',
      login: 'desktop:agents:login',
      loginOutput: 'desktop:agents:login-output',
      listKeys: 'desktop:agents:list-keys',
      setKey: 'desktop:agents:set-key',
      clearKey: 'desktop:agents:clear-key',
      pickAttachments: 'desktop:agents:pick-attachments',
      pickFolders: 'desktop:agents:pick-folders',
      savePasted: 'desktop:agents:save-pasted',
      models: 'desktop:agents:models',
      load: 'desktop:agents:load',
      select: 'desktop:agents:select',
      run: 'desktop:agents:run',
      openCodex: 'desktop:agents:open-codex',
      warmup: 'desktop:agents:warmup',
      cancel: 'desktop:agents:cancel',
      reset: 'desktop:agents:reset',
      event: 'desktop:agents:event',
      answer: 'desktop:agents:answer',
    });
  });

  it('is fully covered by the sandboxed preload (which cannot import this module)', () => {
    const preload = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'preload.ts'), 'utf8');
    for (const channel of Object.values(AGENT_CHANNELS)) {
      expect(preload).toContain(`'${channel}'`);
    }
  });
});
