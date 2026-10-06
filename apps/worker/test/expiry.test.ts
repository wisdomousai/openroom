/**
 * Session auto-expiry alarm (PRD §12 / CONTRACTS SessionDO: "alarm ends sessions idle 12h").
 *
 * We fake `lastActivity` far in the past directly in the DO's SQLite storage
 * (the one documented escape hatch for reaching into the DO — everything else
 * in this suite goes through HTTP), then force the alarm to run immediately
 * with `runDurableObjectAlarm`, which is the supported way to test Durable
 * Object alarms under @cloudflare/vitest-pool-workers.
 */
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { command, createLiveSession, stateJson } from './helpers.js';

interface Env {
  SESSIONS: DurableObjectNamespace;
}

describe('session idle expiry alarm', () => {
  it('ends a session whose lastActivity is more than 12h old once the housekeeping alarm runs', async () => {
    const session = await createLiveSession();
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });

    const stub = (env as unknown as Env).SESSIONS.get((env as unknown as Env).SESSIONS.idFromName(session.sessionCode));

    const THIRTEEN_HOURS_AGO = Date.now() - 13 * 60 * 60 * 1000;
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO meta (k, v) VALUES ('lastActivity', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        String(THIRTEEN_HOURS_AGO),
      );
    });

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.status).toBe('ended');
  });

  it.todo(
    'idempotency rows older than 1h are pruned on the housekeeping alarm — needs a public read path into the idempotency table to assert on without reaching into DO internals beyond the documented escape hatch',
  );
});
