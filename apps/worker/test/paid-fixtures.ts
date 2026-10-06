/**
 * Account and subscription fixtures for paid-access tests. Subscriptions are
 * recorded at the trusted ingestion boundary; every account client (cookie, PAT,
 * connected OAuth client, MCP) reaches the Worker through the same fetch.
 */
import { env } from 'cloudflare:test';
import worker, { type Env } from '../src/index';
import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth';
import { signCookieValue } from '../src/tokens';
import { sha256Hex } from '../src/api-tokens';
import { ENTITLEMENT_FLAGS } from '../src/entitlements';
import { paddleCatalog, parseBillingEvent } from '../src/billing/paddle';
import { recordBillingEvent } from '../src/billing/state';
import { BASE } from './helpers';

export const price = 'pri_01gsz8x8sawmvhz1pv30nge1ke';
export const configured: Env = { ...env, PADDLE_ENVIRONMENT: 'sandbox', PADDLE_PRICE_CATALOG: JSON.stringify({ environment: 'sandbox', prices: {
  [price]: { name: 'Test training', capabilities: ENTITLEMENT_FLAGS.filter((flag) => flag !== 'connectors') },
} }) };
export const providerId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 26)}`;
export type Client = 'cookie' | 'pat' | 'oauth' | 'mcp';
export const clients: Client[] = ['cookie', 'pat', 'oauth', 'mcp'];

export async function account(target: Env = configured) {
  const id = crypto.randomUUID(), sessionId = crypto.randomUUID(), now = Date.now();
  const email = `${id}@example.test`, pat = `orpat_${crypto.randomUUID()}_${crypto.randomUUID()}`, oauth = `orauth_${(crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '').slice(0, 43)}`;
  await env.DB.prepare('INSERT INTO users (id,google_sub,email,name,created_at) VALUES (?1,?1,?2,?3,?4)').bind(id, email, 'Trainer', now).run();
  await env.DB.prepare('INSERT INTO auth_sessions (id,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)').bind(sessionId, id, now, now + 3600000).run();
  await env.DB.prepare('INSERT INTO api_tokens (id,user_id,name,token_hash,token_prefix,created_at) VALUES (?1,?2,?3,?4,?5,?6)').bind(crypto.randomUUID(), id, 'Test client', await sha256Hex(pat), pat.slice(0, 12), now).run();
  const connectionId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO oauth_connections (id,user_id,client_id,client_name,redirect_uri,token_hash,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)')
    .bind(connectionId, id, 'openroom-office', 'Test PowerPoint', `${BASE}/office/callback.html`, await sha256Hex(oauth), now, now + 3600000).run();
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(await signCookieValue('test-secret', sessionId))}`;
  const raw = (path: string, method = 'GET', body?: object, client: Exclude<Client, 'mcp'> = 'cookie') => worker.fetch(new Request(`${BASE}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(client === 'cookie' ? { cookie, [CSRF_HEADER]: '1' } : { authorization: `Bearer ${client === 'pat' ? pat : oauth}` }) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), target);
  const rpc = async (name: string, args: object) => {
    const response = await raw('/api/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, 'oauth');
    const message = await response.json() as { result: { isError?: boolean; content: { text: string }[] } };
    const text = message.result.content[0]!.text;
    let value: any; try { value = JSON.parse(text); } catch { value = text; }
    return { error: message.result.isError === true, value };
  };
  const request = async (path: string, method = 'GET', body?: object, client: Client = 'cookie'): Promise<{ status: number; body: any }> => {
    if (client === 'mcp') return (await rpc('openroom_api', { path, method, ...(body ? { body } : {}) })).value;
    const response = await raw(path, method, body, client);
    const text = await response.text();
    let value: unknown; try { value = JSON.parse(text); } catch { value = text; }
    return { status: response.status, body: value };
  };
  const spaces = await request('/api/my/spaces');
  return { id, email, spaceId: spaces.body.spaces[0].id as string, connectionId, raw, rpc, request };
}
export type Account = Awaited<ReturnType<typeof account>>;

export async function subscribe(owner: Account) {
  const customerId = providerId('ctm'), subscriptionId = providerId('sub');
  await env.DB.prepare("INSERT INTO billing_customers (environment,customer_id,user_id,created_at) VALUES ('sandbox',?1,?2,?3)").bind(customerId, owner.id, Date.now()).run();
  let revision = Date.now() - 10000;
  const change = async (status: string) => {
    const time = new Date(++revision).toISOString();
    const event = parseBillingEvent({ event_id: providerId('evt'), event_type: 'subscription.updated', occurred_at: time, data: {
      id: subscriptionId, customer_id: customerId, status, updated_at: time,
      current_billing_period: { starts_at: time, ends_at: new Date(Date.now() + 86400000).toISOString() }, scheduled_change: null,
      items: [{ status: 'active', recurring: true, quantity: 1, price: { id: price } }],
    } });
    // Fixture at the trusted ingestion boundary; signature behavior has its own HTTP tests.
    await recordBillingEvent(configured, paddleCatalog(configured)!, event!, 'test-evidence', 'webhook');
  };
  await change('active');
  return change;
}
export async function member(owner: Account, collaborator: Account, role = 'editor', spaceId = owner.spaceId) {
  await env.DB.prepare('INSERT INTO space_members (space_id,user_id,role,created_at) VALUES (?1,?2,?3,?4)').bind(spaceId, collaborator.id, role, Date.now()).run();
}
