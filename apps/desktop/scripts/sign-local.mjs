import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { arch } from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'darwin' && !process.env.OPENROOM_MAC_SIGN_IDENTITY) {
  const here = dirname(fileURLToPath(import.meta.url));
  const appPath = resolve(here, `../.forge-app/out/OpenRoom-darwin-${arch}/OpenRoom.app`);
  await access(appPath);
  const signed = spawnSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  if (signed.status !== 0) process.exit(signed.status ?? 1);
}
