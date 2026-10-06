/**
 * Tests run inside workerd via @cloudflare/vitest-pool-workers.
 *
 * NOTE: `defineWorkersConfig` was removed in vitest-pool-workers ≥0.18 (the
 * Vitest 4 line); the pool is now wired up as a Vite plugin, `cloudflareTest`.
 *
 * D1: the migrations under `migrations/` are read here in Node and handed to
 * the test worker as a binding; `test/apply-migrations.ts` applies them inside
 * each test file's isolated storage stack (the documented pool pattern).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = await readD1Migrations(path.join(here, 'migrations'));

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
      },
    }),
  ],
});
