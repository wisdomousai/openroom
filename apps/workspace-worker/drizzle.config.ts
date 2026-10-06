/**
 * drizzle-kit config — migration GENERATION only.
 *
 * `out` is the same directory wrangler reads (`migrations_dir: "migrations"` in
 * wrangler.jsonc) and that vitest.config.ts feeds to `readD1Migrations`, so a
 * generated migration is picked up by `wrangler d1 migrations apply` and by the
 * test harness without any extra copy step.
 *
 * The worker's runtime does NOT use drizzle: request handlers keep issuing raw
 * `env.DB.prepare()` statements. `src/db/schema.ts` exists purely so the DDL has
 * one authoritative definition.
 *
 * Usage: `bun run db:generate` (see package.json).
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  driver: 'd1-http',
  schema: './src/db/schema.ts',
  out: './migrations',
});
