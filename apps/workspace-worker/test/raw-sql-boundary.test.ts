/**
 * Runtime code reaches D1 only through `orm(env)` (src/db/client.ts), so every
 * query is checked against src/db/schema.ts. Raw `env.DB` statements stay in
 * tests and operator scripts.
 *
 * Sources are inlined at transform time: the workerd runtime the tests execute
 * in has no filesystem.
 */
import { describe, expect, it } from 'vitest';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>;
  }
}

const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

// Files still on raw statements while the move to the query builder is under way.
// Remove a file when it is converted; the list ends empty.
const NOT_YET_CONVERTED = new Set([
  'api-tokens.ts',
  'archives.ts',
  'assets.ts',
  'auth.ts',
  'brand-kits.ts',
  'continuity-access.ts',
  'control-auth.ts',
  'control.ts',
  'deck-start.ts',
  'delivery/decks.ts',
  'delivery/session-status.ts',
  'delivery/sessions.ts',
  'delivery/shared.ts',
  'dictionary-route.ts',
  'embed-route.ts',
  'guest-links.ts',
  'home.ts',
  'hosting.ts',
  'learner-audio.ts',
  'learner-practice.ts',
  'learner-rate-limit.ts',
  'learner-work.ts',
  'learner.ts',
  'members.ts',
  'prefs.ts',
  'presentation-start.ts',
  'student-links.ts',
  'tags.ts',
  'tutoring.ts',
  'workspace.ts',
]);

const RAW = /\bDB\.(prepare|batch|exec)\(|\bD1PreparedStatement\b/;

describe('raw SQL boundary', () => {
  const files = Object.entries(sources).map(([path, text]) => [path.replace('../src/', ''), text] as const);

  it('finds the sources', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('keeps raw D1 statements out of runtime code', () => {
    const offenders = files
      .filter(([path, text]) => !path.startsWith('db/') && !NOT_YET_CONVERTED.has(path) && RAW.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('lists only files that still need converting', () => {
    const stale = [...NOT_YET_CONVERTED].filter((path) => {
      const text = files.find(([p]) => p === path)?.[1];
      return text === undefined || !RAW.test(text);
    });
    expect(stale).toEqual([]);
  });
});
