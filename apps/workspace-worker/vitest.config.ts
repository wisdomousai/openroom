/**
 * Tests run inside workerd via @cloudflare/vitest-pool-workers.
 *
 * NOTE: `defineWorkersConfig` was removed in vitest-pool-workers ≥0.18 (the
 * Vitest 4 line); the pool is now wired up as a Vite plugin, `cloudflareTest`.
 *
 * D1: the migrations under `migrations/` are read here in Node and handed to
 * the test worker as a binding; `test/apply-migrations.ts` applies them inside
 * each test file's isolated storage stack (the documented pool pattern).
 *
 * Relay: SessionDO lives in the relay script (`script_name: "openroom-relay"`
 * in wrangler.jsonc) and RELAY is a service binding to it. Auxiliary workers
 * must be plain JS, so the relay is bundled with `wrangler deploy --dry-run`
 * before the pool starts and registered under its script name.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = await readD1Migrations(path.join(here, 'migrations'));

const relayRoot = path.join(here, '..', 'relay');
const relayOut = path.join(relayRoot, 'dist');
execFileSync(
  path.join(relayRoot, 'node_modules', '.bin', 'wrangler'),
  ['deploy', '--dry-run', '--outdir', relayOut, '--config', path.join(relayRoot, 'wrangler.jsonc')],
  { cwd: relayRoot, stdio: 'ignore' },
);

export default defineConfig({
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        d1Databases: { DB: 'openroom-test' },
        bindings: {
          TOKEN_SECRET: 'test-secret',
          ADMIN_KEY: 'test-admin',
          DEMO_AUTH: '1',
          JOIN_ORIGIN: 'https://join.openroom.app',
          /*
           * Tests run as the hosted product: billing is configured, so accounts
           * without a Paddle mapping use their manual `users.entitlements` and
           * start free. A deployment without PADDLE_ENVIRONMENT is self-hosted
           * and unlocks every capability; tests opt into that explicitly.
           */
          PADDLE_ENVIRONMENT: 'sandbox',
          TEST_MIGRATIONS: migrations,
        },
        workers: [
          {
            name: 'openroom-relay',
            modules: true,
            // Inline contents: a `scriptPath` auxiliary worker fails to start under the pool.
            script: readFileSync(path.join(relayOut, 'index.js'), 'utf8'),
            compatibilityDate: '2025-11-01',
            compatibilityFlags: ['nodejs_compat'],
            durableObjects: { SESSIONS: { className: 'SessionDO', useSQLite: true } },
            bindings: {
              TOKEN_SECRET: 'test-secret',
              JOIN_ORIGIN: 'https://join.openroom.app',
            },
          },
        ],
      },
    }),
  ],
});
