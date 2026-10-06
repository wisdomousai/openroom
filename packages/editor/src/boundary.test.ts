/**
 * The editor's boundary (AGENTS.md § Editor package): it reaches its host only
 * through `EditorServices`. No file in this package may import from an app
 * (by relative path or alias), and none may use the host's router or query
 * cache — data reads arrive as host-supplied hooks.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = join(PACKAGE_ROOT, 'src');

/** Bare specifiers that belong to a host, never to the editor. */
const FORBIDDEN_PACKAGES = ['@tanstack/react-query', '@tanstack/react-router', '@openroom/stage-src'];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|css)$/.test(entry.name) ? [path] : [];
  });
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|@import\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

function specifiers(text: string): string[] {
  return [...text.matchAll(SPECIFIER)].map((match) => match[2]!);
}

/** What is wrong with one import, or null when it stays inside the boundary. */
export function boundaryProblem(file: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    const target = resolve(dirname(file), specifier);
    if (target !== PACKAGE_ROOT && !target.startsWith(PACKAGE_ROOT + sep)) return `leaves the package (${specifier})`;
    return null;
  }
  if (specifier.startsWith('@/') || /(^|\/)apps\//.test(specifier)) return `imports an app (${specifier})`;
  const forbidden = FORBIDDEN_PACKAGES.find((name) => specifier === name || specifier.startsWith(`${name}/`));
  return forbidden === undefined ? null : `imports ${forbidden}, which belongs to the host`;
}

describe('editor boundary', () => {
  it('imports nothing from an app, the router or the query cache', () => {
    const problems = sourceFiles(SOURCE_ROOT).flatMap((file) =>
      specifiers(readFileSync(file, 'utf8')).flatMap((specifier) => {
        const problem = boundaryProblem(file, specifier);
        return problem === null ? [] : [`${relative(PACKAGE_ROOT, file)}: ${problem}`];
      }),
    );
    expect(problems).toEqual([]);
  });

  it('declares no host-only dependency', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const declared = ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((field) => Object.keys(manifest[field] ?? {}));
    expect(declared.filter((name) => FORBIDDEN_PACKAGES.includes(name))).toEqual([]);
  });

  it('recognises each kind of escape', () => {
    const file = join(SOURCE_ROOT, 'live', 'LiveHost.tsx');
    expect(boundaryProblem(file, '../../../../apps/host/src/api')).toMatch(/leaves the package/);
    expect(boundaryProblem(file, '@/api')).toMatch(/imports an app/);
    expect(boundaryProblem(file, '@tanstack/react-query')).toMatch(/belongs to the host/);
    expect(boundaryProblem(file, '@tanstack/react-router')).toMatch(/belongs to the host/);
    expect(boundaryProblem(file, '@openroom/stage-src/StageView')).toMatch(/belongs to the host/);
    expect(boundaryProblem(file, '../services')).toBeNull();
    expect(boundaryProblem(file, '@openroom/ui/components/button')).toBeNull();
  });
});
