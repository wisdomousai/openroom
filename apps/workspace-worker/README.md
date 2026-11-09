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

Runtime queries go through the Drizzle query builder: `orm(env)` from
`src/db/client.ts`, so every query is type-checked against the schema. Use the
`sql` template only for SQLite fragments the builder cannot express (helpers in
`src/db/sql.ts`). Raw `env.DB.prepare()` statements belong to tests and operator
scripts only; `test/raw-sql-boundary.test.ts` enforces this.
