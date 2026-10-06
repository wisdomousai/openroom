/** Local-only paid collaboration fixtures. Never changes an existing account. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/workspace-worker');

export function facilitatorAccounts(options: { branding?: boolean; keep?: boolean; rawExport?: boolean } = {}) {
  const origin = process.env.OPENROOM_URL ?? 'http://127.0.0.1:8787';
  const persist = process.env.OPENROOM_E2E_PERSIST_TO;
  if (!persist || !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Co-facilitation fixtures require a local Worker and OPENROOM_E2E_PERSIST_TO.');
  const raw = process.env.OPENROOM_E2E_TOKEN_SECRET ? undefined : /^TOKEN_SECRET\s*=\s*(.+)$/m.exec(readFileSync(resolve(workerDir, '.dev.vars'), 'utf8'))?.[1]?.trim();
  const secret = process.env.OPENROOM_E2E_TOKEN_SECRET ?? (raw?.startsWith('"') ? JSON.parse(raw) as string : raw?.replace(/^'|'$/g, ''));
  if (!secret) throw new Error('Local TOKEN_SECRET is required.');
  const temp = mkdtempSync(resolve(tmpdir(), 'openroom-facilitators-'));
  const captured = new Set<string>();
  const sql = (source: string) => {
    const file = resolve(temp, 'fixture.sql'); writeFileSync(file, source, { mode: 0o600 });
    execFileSync('bunx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', persist, '--file', file], { cwd: workerDir, stdio: 'pipe', timeout: 60_000 });
  };
  const people = ['Alex', 'Sam'].map((name, index) => {
    const id = crypto.randomUUID(), authId = crypto.randomUUID(), now = Date.now();
    const email = `${id}@example.test`;
    sql(`INSERT INTO users (id,google_sub,email,name,created_at,entitlements) VALUES ('${id}','e2e:${id}','${email}','${name}',${now},'${index === 0 ? JSON.stringify({ team: true, branding: options.branding === true, keep: options.keep === true, rawExport: options.rawExport === true }) : '{}'}');
      INSERT INTO auth_sessions (id,user_id,created_at,expires_at) VALUES ('${authId}','${id}',${now},${now + 3600000});`);
    const body = Buffer.from(authId).toString('base64url');
    const value = encodeURIComponent(`${body}.${createHmac('sha256', secret).update(authId).digest('base64url')}`);
    return { id, name, email, signIn: (context: BrowserContext) => context.addCookies([{ name: 'or_session', value, url: origin, httpOnly: true, sameSite: 'Lax' }]) };
  });
  return { owner: people[0]!, helper: people[1]!, trackArchive(code: string) {
    if (!/^[A-Z0-9]{8}$/.test(code)) throw new Error('Invalid test archive');
    captured.add(code);
  }, downgradeOwner() { sql(`UPDATE users SET entitlements='{}' WHERE id='${people[0]!.id}'`); }, cleanup() {
    const ids = people.map(({ id }) => `'${id}'`).join(',');
    try {
      for (const code of captured) execFileSync('bunx', ['wrangler', 'r2', 'object', 'delete', `openroom-media/archives/${code}.json`, '--local', '--persist-to', persist], { cwd: workerDir, stdio: 'pipe', timeout: 60_000 });
      sql(`DELETE FROM session_archives WHERE user_id IN (${ids});
        DELETE FROM brand_kits WHERE created_by IN (${ids});
        DELETE FROM session_records WHERE session_id IN (SELECT id FROM sessions WHERE created_by IN (${ids}));
        DELETE FROM sessions WHERE created_by IN (${ids});
        DELETE FROM deck_drafts WHERE deck_id IN (SELECT id FROM decks WHERE created_by IN (${ids}));
        DELETE FROM deck_versions WHERE deck_id IN (SELECT id FROM decks WHERE created_by IN (${ids}));
        DELETE FROM decks WHERE created_by IN (${ids});
        DELETE FROM live_sessions WHERE user_id IN (${ids});
        DELETE FROM space_invites WHERE invited_by IN (${ids}) OR accepted_by IN (${ids});
        DELETE FROM space_members WHERE user_id IN (${ids});
        DELETE FROM spaces WHERE owner_user_id IN (${ids});
        DELETE FROM oauth_codes WHERE user_id IN (${ids});
        DELETE FROM oauth_connections WHERE user_id IN (${ids});
        DELETE FROM auth_sessions WHERE user_id IN (${ids});
        DELETE FROM users WHERE id IN (${ids});`);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  } };
}
