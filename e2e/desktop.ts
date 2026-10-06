import { _electron as electron, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { realpath } from 'node:fs/promises';

/** The same teaching journeys exercise development builds and actual packaged executables. */
export async function launchDesktop(profile: string, file: string) {
  const executable = process.env.OPENROOM_DESKTOP_EXECUTABLE;
  const app = await electron.launch({
    timeout: 20_000,
    ...(executable ? { executablePath: resolve(executable) } : {}),
    args: [...(executable ? [] : [resolve('../apps/desktop')]), `--user-data-dir=${profile}`, file],
    env: { ...process.env, OPENROOM_ORIGIN: process.env.OPENROOM_URL ?? 'http://127.0.0.1:8787' },
  });
  try {
    expect(await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData') }))).toEqual({
      packaged: Boolean(executable), profile: await realpath(profile),
    });
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
