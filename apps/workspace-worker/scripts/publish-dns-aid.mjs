#!/usr/bin/env node
/**
 * Publish DNS-AID (DNS for AI Discovery) records for openroom.app.
 *
 * Requires CLOUDFLARE_API_TOKEN with Zone:DNS:Edit on the zone.
 * Optional: CLOUDFLARE_ZONE_ID (otherwise resolved by zone name).
 *
 * Usage:
 *   bun apps/workspace-worker/scripts/publish-dns-aid.mjs
 *   bun apps/workspace-worker/scripts/publish-dns-aid.mjs --dry-run
 *   bun apps/workspace-worker/scripts/publish-dns-aid.mjs --dnssec
 *
 * Spec: docs/dns-aid.md
 */

const ZONE_NAME = process.env.CLOUDFLARE_ZONE_NAME ?? 'openroom.app';
const ORIGIN = `https://${ZONE_NAME}`;
const API = 'https://api.cloudflare.com/client/v4';
const TTL = 3600;

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const enableDnssec = args.has('--dnssec');

const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
if (!token) {
  console.error(
    'Missing CLOUDFLARE_API_TOKEN (Zone → DNS → Edit). See docs/dns-aid.md.',
  );
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
};

async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const body = await res.json();
  if (!body.success) {
    const err = body.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? res.statusText;
    throw new Error(`Cloudflare API ${path}: ${err}`);
  }
  return body.result;
}

/** Desired DNS-AID RRset for this deployment. */
function desiredRecords() {
  const cap = (path) => `key65001="cap=${ORIGIN}${path}"`;
  return [
    {
      type: 'SVCB',
      name: `_a2a._agents.${ZONE_NAME}`,
      ttl: TTL,
      comment: 'DNS-AID: A2A JSON-RPC → /api/a2a (agent-card)',
      data: {
        priority: 1,
        target: ZONE_NAME,
        value: `alpn="a2a,h2,h3" port=443 mandatory=alpn,port ${cap('/.well-known/agent-card.json')}`,
      },
    },
    {
      type: 'SVCB',
      name: `_mcp._agents.${ZONE_NAME}`,
      ttl: TTL,
      comment: 'DNS-AID: MCP Streamable HTTP → /api/mcp (server-card)',
      data: {
        priority: 1,
        target: ZONE_NAME,
        value: `alpn="mcp,h2,h3" port=443 mandatory=alpn,port ${cap('/.well-known/mcp/server-card.json')}`,
      },
    },
    {
      type: 'SVCB',
      name: `_index._agents.${ZONE_NAME}`,
      ttl: TTL,
      comment: 'DNS-AID: org index → agent-skills discovery',
      data: {
        priority: 1,
        target: ZONE_NAME,
        value: `alpn="h2,h3" port=443 mandatory=alpn,port ${cap('/.well-known/agent-skills/index.json')}`,
      },
    },
    {
      type: 'TXT',
      name: `_index._agents.${ZONE_NAME}`,
      ttl: TTL,
      comment: 'DNS-AID: text index of agent:protocol pairs',
      content: 'agents=openroom:a2a,openroom:mcp',
    },
  ];
}

async function resolveZoneId() {
  if (process.env.CLOUDFLARE_ZONE_ID) return process.env.CLOUDFLARE_ZONE_ID;
  const zones = await cf(`/zones?name=${encodeURIComponent(ZONE_NAME)}`);
  const zone = zones[0];
  if (!zone) throw new Error(`Zone not found: ${ZONE_NAME}`);
  return zone.id;
}

async function listMatching(zoneId, name, type) {
  const q = new URLSearchParams({ name, type, per_page: '50' });
  return cf(`/zones/${zoneId}/dns_records?${q}`);
}

async function upsert(zoneId, record) {
  const existing = await listMatching(zoneId, record.name, record.type);
  const payload = { ...record, proxied: false };

  if (dryRun) {
    console.log(`[dry-run] ${existing.length ? 'UPDATE' : 'CREATE'} ${record.type} ${record.name}`);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (existing.length === 0) {
    const created = await cf(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    console.log(`CREATE ${record.type} ${record.name} → ${created.id}`);
    return;
  }

  // Prefer a single authoritative record per name+type for these entrypoints.
  const [primary, ...rest] = existing;
  const updated = await cf(`/zones/${zoneId}/dns_records/${primary.id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  console.log(`UPDATE ${record.type} ${record.name} → ${updated.id}`);
  for (const extra of rest) {
    await cf(`/zones/${zoneId}/dns_records/${extra.id}`, { method: 'DELETE' });
    console.log(`DELETE duplicate ${extra.type} ${extra.name} → ${extra.id}`);
  }
}

async function maybeEnableDnssec(zoneId) {
  if (!enableDnssec) return;
  const status = await cf(`/zones/${zoneId}/dnssec`);
  console.log(`DNSSEC status: ${status.status}`);
  if (status.status === 'active' || status.status === 'pending') {
    console.log('DNSSEC already enabled.');
    if (status.ds) console.log(`DS record (registrar):\n${status.ds}`);
    return;
  }
  if (dryRun) {
    console.log('[dry-run] would PATCH dnssec status=active');
    return;
  }
  const next = await cf(`/zones/${zoneId}/dnssec`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'active' }),
  });
  console.log(`DNSSEC → ${next.status}`);
  if (next.ds) {
    console.log(
      'Add this DS record at your registrar if the domain is not on Cloudflare Registrar:\n' +
        next.ds,
    );
  }
}

async function main() {
  const zoneId = await resolveZoneId();
  console.log(`Zone ${ZONE_NAME} (${zoneId})${dryRun ? ' [dry-run]' : ''}`);
  for (const record of desiredRecords()) {
    await upsert(zoneId, record);
  }
  await maybeEnableDnssec(zoneId);
  console.log('Done. Validate with isitagentready dnsAid or docs/dns-aid.md.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
