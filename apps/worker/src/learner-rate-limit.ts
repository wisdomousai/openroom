/**
 * Per-client throttle for the learner capability plane (`/api/learner/*`).
 *
 * ## What this is for, and what it is not for
 *
 * A context access link carries a 256-bit random secret (context-links.ts), so
 * guessing one is not a threat a rate limit meaningfully changes — this is NOT
 * anti-brute-force, and it is not a second factor. It buys exactly two things:
 *
 *  1. **Resource exhaustion / cost control.** `/api/learner/*` is the only route
 *     family in the product authenticated purely by a bearer capability, with no
 *     cookie, no session and no CSRF header. Anyone on the internet can make it
 *     do a D1 read, and nothing else in the stack stands between them and the
 *     database. A budget per client caps that.
 *  2. **Blunting bulk validation of a leaked batch.** If a set of links leaks
 *     (a shared screenshot, a synced notes app, a stolen backup), the natural
 *     next step is to replay them all to see which are still live. A per-client
 *     failure budget makes that slow and noisy instead of instant.
 *
 * It is deliberately not claimed to do more than that.
 *
 * ## Shape of the mechanism
 *
 * A fixed window per client, in the spirit of the session-recovery limiter in
 * session-do.ts (`RECOVERY_WINDOW_MS` / `RECOVERY_FAILURE_LIMIT`), but backed by D1
 * because the learner plane has no Durable Object to hold the counter.
 *
 * - The client key is a **salted SHA-256 of `CF-Connecting-IP`**. The raw IP is
 *   never stored, logged, or returned: `docs/PRD.md` takes a data-minimisation
 *   posture and a raw-IP column would contradict it. The salt is `TOKEN_SECRET`,
 *   already a required secret, so this introduces no new secret to manage.
 * - When the header is absent (local dev, `vitest`, an internal caller) we fall
 *   back to a fixed sentinel key rather than skipping the limiter — a limiter
 *   that can be disabled by omitting a header is not a limiter. This matters in
 *   tests: the pool isolates D1 per test *file*, not per test, so rows written
 *   by one case are still there for the next and every caller without the header
 *   would share the sentinel's budget. Tests therefore send a distinct
 *   `CF-Connecting-IP` per call unless they are exercising the limiter itself.
 * - The budget is checked **before** the credential is examined, so the 429 is
 *   reachable identically whether the token was absent, malformed, unknown,
 *   expired or revoked. There is no ordering in which the throttle can become
 *   the oracle that the single indistinguishable 401 exists to deny. The
 *   accepted consequence is that a client over budget is refused even when it
 *   then presents a *valid* link; the window is short and self-healing, and this
 *   is the only ordering that actually caps D1 work under load.
 * - D1 is written **only on a failure**. The success path does one indexed read
 *   and, in the overwhelmingly common case of no row, no write at all.
 */

import { sha256Hex } from './api-tokens.js';
import { json, type ControlEnv } from './auth.js';

/**
 * Window and budget.
 *
 * 60 s matches `RECOVERY_WINDOW_MS`: long enough to be a real brake, short
 * enough that an honest client wrongly caught (a school NAT, a family router)
 * is never locked out for more than a minute and needs no support call.
 *
 * 10 failures is tighter than the session limiter's 20 because the honest failure
 * rate here is far lower. A working learner page spends zero budget — the
 * counter is only touched when a credential does not resolve — and a student
 * with a dead link spends exactly one per page load, because `/api/learner/sessions`
 * is not even issued until `/api/learner/me` succeeds. Ten therefore covers a
 * frustrated reload loop with headroom to spare while still cutting a bulk replay
 * of a leaked batch down to ~10 probes per client per minute.
 */
export const LEARNER_AUTH_WINDOW_MS = 60 * 1000;
export const LEARNER_AUTH_FAILURE_LIMIT = 10;

/** Stand-in key for callers with no `CF-Connecting-IP` (local dev, tests). */
const NO_CLIENT_IP = '__no-cf-connecting-ip__';

export interface LearnerAttemptRow {
  window_start: number;
  failures: number;
}

/**
 * Salted digest of the caller's IP. Salting with `TOKEN_SECRET` means the stored
 * value is not a rainbow-tableable hash of a 32-bit address space: without the
 * secret, a dump of this table cannot be walked back to the IPs that produced it.
 */
export function learnerClientKey(request: Request, env: ControlEnv): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip')?.trim();
  const client = ip === undefined || ip === '' ? NO_CLIENT_IP : ip;
  return sha256Hex(`learner-rate-limit:${env.TOKEN_SECRET}:${client}`);
}

/** The one response an over-budget caller ever sees. */
export function learnerRateLimitedResponse(): Response {
  return json(
    {
      error: 'learner-rate-limited',
      message: 'Too many attempts. Wait a minute and try again.',
    },
    429,
  );
}

/**
 * This client's bookkeeping row, if any. Deliberately *not* window-filtered: the
 * caller needs to know a row physically exists so a success can clean it up.
 */
export function readLearnerAttempts(
  env: ControlEnv,
  key: string,
): Promise<LearnerAttemptRow | null> {
  return env.DB.prepare(
    'SELECT window_start, failures FROM learner_auth_attempts WHERE client_hash = ?1',
  )
    .bind(key)
    .first<LearnerAttemptRow>();
}

/** Has this client spent its budget for the window that is currently running? */
export function learnerOverBudget(row: LearnerAttemptRow | null, now: number): boolean {
  if (row === null) return false;
  if (now - row.window_start >= LEARNER_AUTH_WINDOW_MS) return false;
  return row.failures >= LEARNER_AUTH_FAILURE_LIMIT;
}

/**
 * Count one auth failure, opening a fresh window when the previous one has
 * lapsed. Expired rows for *other* clients are swept in the same round trip —
 * this only runs on failures, so the sweep costs nothing on the happy path.
 */
export async function recordLearnerAuthFailure(
  env: ControlEnv,
  key: string,
  now: number,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO learner_auth_attempts (client_hash, window_start, failures)
       VALUES (?1, ?2, 1)
       ON CONFLICT(client_hash) DO UPDATE SET
         window_start = CASE
           WHEN ?2 - learner_auth_attempts.window_start >= ?3 THEN ?2
           ELSE learner_auth_attempts.window_start END,
         failures = CASE
           WHEN ?2 - learner_auth_attempts.window_start >= ?3 THEN 1
           ELSE learner_auth_attempts.failures + 1 END`,
    ).bind(key, now, LEARNER_AUTH_WINDOW_MS),
    env.DB.prepare('DELETE FROM learner_auth_attempts WHERE window_start <= ?1').bind(
      now - LEARNER_AUTH_WINDOW_MS,
    ),
  ]);
}

/**
 * Forget this client's failures after a request that authenticated.
 *
 * Guarded by the caller on "a row was actually present", so an ordinary
 * successful learner request performs no D1 write at all.
 */
export async function clearLearnerAuthFailures(env: ControlEnv, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM learner_auth_attempts WHERE client_hash = ?1')
    .bind(key)
    .run();
}
