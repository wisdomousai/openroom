/**
 * Desktop is core (AGENTS.md § Core and workspace): neither the main process
 * nor the core renderer may import workspace code, so `build:core` works in a
 * checkout without the workspace apps. The workspace bundle reaches Desktop
 * only as built files copied into renderer/host.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS_ROOT = resolve(DESKTOP_ROOT, '..');
const SOURCE_ROOTS = ['src', 'renderer-src'].map((directory) => join(DESKTOP_ROOT, directory));

/** The workspace apps (AGPL-3.0-only), by directory and by package name. */
const WORKSPACE_APPS = ['workspace', 'workspace-worker', 'site'];
const WORKSPACE_PACKAGES = ['openroom-workspace', 'openroom-workspace-worker', 'openroom-site'];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.(?:ts|tsx|css)$/.test(entry.name) ? [path] : [];
  });
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|@import\s+|@source\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

function specifiers(text: string): string[] {
  return [...text.matchAll(SPECIFIER)].map((match) => match[2]!);
}

function insideWorkspaceApp(path: string): boolean {
  return WORKSPACE_APPS.some((app) => {
    const root = join(APPS_ROOT, app);
    return path === root || path.startsWith(root + sep);
  });
}

/** What is wrong with one import, or null when it stays in the core. */
export function coreBoundaryProblem(file: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    return insideWorkspaceApp(resolve(dirname(file), specifier)) ? `imports workspace code (${specifier})` : null;
  }
  if (specifier.startsWith('@/')) return `uses the workspace's @/ alias (${specifier})`;
  if (/(^|\/)apps\/(?:workspace|workspace-worker|site)(\/|$)/.test(specifier)) return `imports workspace code (${specifier})`;
  const name = WORKSPACE_PACKAGES.find((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
  return name === undefined ? null : `imports the workspace package ${name}`;
}

describe('desktop core boundary', () => {
  it('imports nothing from the workspace apps', () => {
    const problems = SOURCE_ROOTS.flatMap(sourceFiles).flatMap((file) =>
      specifiers(readFileSync(file, 'utf8')).flatMap((specifier) => {
        const problem = coreBoundaryProblem(file, specifier);
        return problem === null ? [] : [`${relative(DESKTOP_ROOT, file)}: ${problem}`];
      }),
    );
    expect(problems).toEqual([]);
  });

  it('declares no workspace package', () => {
    const manifest = JSON.parse(readFileSync(join(DESKTOP_ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const declared = ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((field) => Object.keys(manifest[field] ?? {}));
    expect(declared.filter((name) => WORKSPACE_PACKAGES.includes(name))).toEqual([]);
  });

  it('recognises each kind of escape', () => {
    const file = join(DESKTOP_ROOT, 'renderer-src', 'editor-services.tsx');
    expect(coreBoundaryProblem(file, '../../workspace/src/api')).toMatch(/imports workspace code/);
    expect(coreBoundaryProblem(file, '../../workspace-worker/src/index')).toMatch(/imports workspace code/);
    expect(coreBoundaryProblem(file, '@/api')).toMatch(/@\/ alias/);
    expect(coreBoundaryProblem(file, 'openroom-workspace/src/storage')).toMatch(/workspace package/);
    expect(coreBoundaryProblem(file, '../../../apps/site/src/pages')).toMatch(/imports workspace code/);
    expect(coreBoundaryProblem(file, '../../stage/src/styles.css')).toBeNull();
    expect(coreBoundaryProblem(file, '@openroom/stage-src/StageView')).toBeNull();
    expect(coreBoundaryProblem(file, '@openroom/editor')).toBeNull();
    expect(coreBoundaryProblem(file, './api')).toBeNull();
  });
});
