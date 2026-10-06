/**
 * Copy the built workspace bundle (apps/workspace/dist) into renderer/host,
 * where the main process serves it as openroom://app/host/.
 *
 * `--build` builds the bundle first. A checkout without apps/workspace (the
 * core build) has no renderer bundle: the step is skipped and renderer/ is left
 * empty.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, '../../workspace');
const target = resolve(here, '../renderer/host');
await rm(resolve(here, '../renderer'), { recursive: true, force: true });
await mkdir(resolve(here, '../renderer'), { recursive: true });
if (!existsSync(resolve(workspace, 'package.json'))) {
  console.log('[desktop:copy-workspace] skip (no apps/workspace)');
  process.exit(0);
}
if (process.argv.includes('--build')) {
  const result = spawnSync('bun', ['run', 'build'], { cwd: workspace, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await mkdir(target, { recursive: true });
await cp(resolve(workspace, 'dist'), target, { recursive: true });
