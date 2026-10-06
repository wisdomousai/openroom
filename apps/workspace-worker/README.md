# openroom-workspace-worker

## Database schema

`src/db/schema.ts` is the single source of truth for the D1 control plane.
Everything under `migrations/` is **generated** by drizzle-kit — never handwrite
or hand-edit SQL there.

To change the schema:

```sh
# 1. edit src/db/schema.ts
bun run db:generate      # drizzle-kit generate  -> migrations/NNNN_*.sql + meta/
# 2. commit the emitted .sql and migrations/meta/
```

`drizzle.config.ts` points `out` at `migrations/`, which is the same directory
wrangler applies (`migrations_dir` in `wrangler.jsonc`) and the same directory
`vitest.config.ts` feeds to `readD1Migrations`. `migrations/meta/` is drizzle's
snapshot journal; it must be committed so the next `db:generate` produces a diff
rather than a fresh init.

Drizzle is used for schema definition and migration generation **only**. Request
handlers keep issuing raw `env.DB.prepare()` statements; nothing in `src/db/` is
imported by runtime code.
