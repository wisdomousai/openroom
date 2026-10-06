import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import forgeConfig from './forge-config.cjs';

if (process.argv.length !== 2) throw new Error('Usage: node scripts/make-release.mjs');
const env = { ...process.env, OPENROOM_DESKTOP_RELEASE: '1' };
forgeConfig.createForgeConfig(env);
const key = process.platform === 'darwin' ? 'OPENROOM_APPLE_API_KEY' : 'OPENROOM_WINDOWS_CERTIFICATE_FILE';
try {
  await access(env[key], constants.R_OK);
  if (!(await stat(env[key])).isFile()) throw new Error('Not a credential file.');
}
catch { throw new Error(`${key} must point to a readable signing credential file.`); }
const result = spawnSync(process.platform === 'win32' ? 'bun.exe' : 'bun', ['run', 'make'], {
  cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'), env, stdio: 'inherit',
});
if (result.error) throw new Error('Could not start the Desktop release build. Check that Bun is installed.');
process.exit(result.status ?? 1);
