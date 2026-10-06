/**
 * Applies the D1 control-plane migrations before each test file runs.
 *
 * `TEST_MIGRATIONS` is read from `migrations/` in Node by vitest.config.ts and
 * passed through as a binding; `applyD1Migrations` is idempotent (it records
 * applied migrations in the `d1_migrations` table).
 */
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
