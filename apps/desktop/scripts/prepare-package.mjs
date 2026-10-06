import { build } from 'esbuild';
import { realpathSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import forgeConfig from './forge-config.cjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const stage = resolve(appRoot, '.forge-app');
// Validate release configuration before replacing a previous staging directory.
forgeConfig.createForgeConfig();
const manifest = JSON.parse(await readFile(resolve(appRoot, 'package.json'), 'utf8'));
const electronManifest = JSON.parse(await readFile(resolve(appRoot, 'node_modules/electron/package.json'), 'utf8'));

function realpathOrSelf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Prefer the same-folder sibling (bun/npm store layout), then walk node_modules. */
function siblingPackage(fromDir, name) {
  const short = name.split('/').at(-1);
  let dir = fromDir;
  for (let depth = 0; depth < 8; depth += 1) {
    for (const candidate of [resolve(dir, short), resolve(dir, 'node_modules', name)]) {
      try {
        return realpathSync(candidate);
      } catch {
        /* keep looking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate ${name} next to ${fromDir}`);
}

await rm(stage, { recursive: true, force: true });
await mkdir(resolve(stage, 'dist'), { recursive: true });
await cp(resolve(appRoot, 'renderer'), resolve(stage, 'renderer'), { recursive: true });
// The agent SDKs locate their bundled runtimes relative to their own package
// files, so they must ship as real packages (asar-unpacked), never inlined.
const SDK_EXTERNALS = ['@anthropic-ai/claude-agent-sdk', '@openai/codex-sdk'];

for (const entry of ['main', 'agents/mcp-stdio']) {
  await build({
    entryPoints: [resolve(appRoot, `src/${entry}.ts`)],
    outfile: resolve(stage, `dist/${entry}.js`),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['electron', ...SDK_EXTERNALS],
    // Bundled CommonJS dependencies still require Node built-ins at runtime.
    banner: { js: 'import { createRequire as __openroomCreateRequire } from "node:module"; const require = __openroomCreateRequire(import.meta.url);' },
  });
}
// Sandboxed preloads have no ESM loader.
await build({
  entryPoints: [resolve(appRoot, 'src/preload.ts')],
  outfile: resolve(stage, 'dist/preload.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
});

const cpu = process.arch === 'arm64' ? 'arm64' : 'x64';
const claudeSdkRoot = realpathOrSelf(resolve(appRoot, 'node_modules/@anthropic-ai/claude-agent-sdk'));
const claudePlatform = `@anthropic-ai/claude-agent-sdk-${process.platform}-${cpu}`;
const codexSdkRoot = realpathOrSelf(resolve(appRoot, 'node_modules/@openai/codex-sdk'));
const codexRoot = siblingPackage(dirname(codexSdkRoot), '@openai/codex');
const stagedPackages = [
  ['@anthropic-ai/claude-agent-sdk', claudeSdkRoot],
  [claudePlatform, siblingPackage(dirname(claudeSdkRoot), claudePlatform)],
  ['@openai/codex-sdk', codexSdkRoot],
  ['@openai/codex', codexRoot],
  [`@openai/codex-${process.platform}-${cpu}`, siblingPackage(dirname(codexRoot), `@openai/codex-${process.platform}-${cpu}`)],
];
for (const [name, source] of stagedPackages) {
  await cp(source, resolve(stage, 'node_modules', name), { recursive: true, dereference: true });
}
await mkdir(resolve(stage, 'plugin'), { recursive: true });
await cp(resolve(appRoot, '../../plugin/skills'), resolve(stage, 'plugin/skills'), { recursive: true });

await writeFile(resolve(stage, 'package.json'), JSON.stringify({
  name: manifest.name,
  productName: manifest.productName,
  version: manifest.version,
  description: manifest.description,
  private: true,
  type: 'module',
  main: 'dist/main.js',
  // Without an explicit Forge marker its resolver walks up to the workspace and
  // packages the source tree (including dependency-store links), ignoring this stage.
  config: { forge: './forge.config.cjs' },
  // Pin the installed runtime: Forge's range lookup does not recognize Bun's lockfile.
  devDependencies: { electron: electronManifest.version },
}, null, 2));
await mkdir(resolve(stage, 'scripts'), { recursive: true });
await cp(resolve(appRoot, 'forge.config.cjs'), resolve(stage, 'forge.config.cjs'));
await cp(resolve(here, 'forge-config.cjs'), resolve(stage, 'scripts/forge-config.cjs'));
