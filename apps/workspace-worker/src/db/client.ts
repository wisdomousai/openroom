/**
 * The control plane's query client. Runtime code reaches D1 only through
 * `orm(env)`; raw `env.DB` statements belong to tests and operator scripts.
 * `test/raw-sql-boundary.test.ts` enforces this.
 */
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import * as schema from './schema.js';

export type Orm = DrizzleD1Database<typeof schema>;

const clients = new WeakMap<D1Database, Orm>();

export function orm(env: { DB: D1Database }): Orm {
  let client = clients.get(env.DB);
  if (!client) {
    client = drizzle(env.DB, { schema });
    clients.set(env.DB, client);
  }
  return client;
}
