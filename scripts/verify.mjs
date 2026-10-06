/** Repository checks in dependency order, with bounded test concurrency. No deployment. */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bun, run } from './ci/run.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = process.argv.slice(2);
if (options.some((option) => option !== '--build-only')) throw new Error('Usage: node scripts/verify.mjs [--build-only]');
const projects = [];
for (const group of ['packages', 'apps']) {
  for (const entry of await readdir(resolve(root, group), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = resolve(root, group, entry.name);
    const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    projects.push({ directory, group, ...manifest });
  }
}
const shared = new Map(projects.filter((project) => project.group === 'packages').map((project) => [project.name, project]));
const built = new Set();
async function build(project, path = []) {
  if (built.has(project.name)) return;
  if (path.includes(project.name)) throw new Error(`Workspace build cycle: ${[...path, project.name].join(' -> ')}`);
  const dependencies = { ...project.dependencies, ...project.devDependencies };
  for (const name of Object.keys(dependencies)) if (shared.has(name)) await build(shared.get(name), [...path, project.name]);
  if (project.scripts?.build) await run(bun, ['run', 'build'], { cwd: project.directory });
  built.add(project.name);
}
await run(process.execPath, ['scripts/sync-mcp-config.mjs', '--check'], { cwd: root });
for (const project of shared.values()) await build(project);
if (!options.includes('--build-only')) {
  for (const project of projects) if (project.scripts?.typecheck) await run(bun, ['run', 'typecheck'], { cwd: project.directory });
  for (const project of projects) if (project.scripts?.test) await run(bun, ['run', 'test', '--maxWorkers=2'], { cwd: project.directory });
}
await run(bun, ['run', 'build:core-apps'], { cwd: root });
await run(bun, ['run', 'build:workspace'], { cwd: root });
console.log(options.includes('--build-only') ? 'All application builds completed.' : 'All repository checks and application builds completed.');
