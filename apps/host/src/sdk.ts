/**
 * Command submission + SDK helpers.
 *
 * The SDK (docs/CONTRACTS.md §SDK) owns snapshot sync (WS + polling fallback);
 * `client.submit(command)` however posts an envelope WITHOUT `expectedRevision`
 * (see @openroom/sdk `postCommand`), and this console is required to send the
 * last known revision with every host mutation (LIVE-04). So commands are
 * posted here as the full `CommandEnvelope` documented in §HTTP API, and the
 * SDK client is asked to refresh right after so the UI picks up the new state
 * without waiting for the coalesced notification.
 */
import type { HostCommand } from './types';

export function newIdempotencyKey(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface SubmitOutcome {
  ok: boolean;
  revision?: number;
  code?: string;
  message?: string;
}

interface CommandResponseBody {
  ok?: boolean;
  revision?: number;
  error?: { code?: string; message?: string };
}

/** POST a host command envelope. Never throws; failures come back as outcomes. */
export async function submitCommand(
  sessionCode: string,
  hostToken: string,
  command: HostCommand,
  expectedRevision: number | undefined,
  idempotencyKey: string,
): Promise<SubmitOutcome> {
  const envelope: Record<string, unknown> = { idempotencyKey, command };
  if (typeof expectedRevision === 'number') envelope['expectedRevision'] = expectedRevision;

  let res: Response;
  try {
    res = await fetch(`/api/sessions/${encodeURIComponent(sessionCode)}/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify(envelope),
    });
  } catch (err) {
    return {
      ok: false,
      code: 'E_NETWORK',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }

  let body: CommandResponseBody | null = null;
  try {
    body = (await res.json()) as CommandResponseBody;
  } catch {
    body = null;
  }

  if (res.ok && body?.ok !== false) {
    return { ok: true, ...(typeof body?.revision === 'number' ? { revision: body.revision } : {}) };
  }
  const code = body?.error?.code ?? (res.status === 409 ? 'E_REVISION_CONFLICT' : `E_HTTP_${res.status}`);
  return {
    ok: false,
    code,
    message: body?.error?.message ?? `Command failed (HTTP ${res.status})`,
  };
}

/**
 * The live theme switch (docs/CONTRACTS.md §Domain, `session.theme`).
 *
 * Host-only, valid in `lobby` and `live`. Re-sending the theme the session already
 * has is an idempotent no-op that does NOT bump the revision — so the console
 * must never wait for a revision change to consider the switch applied.
 */
export function sessionThemeCommand(theme: string): HostCommand {
  return { command: 'session.theme', theme };
}
