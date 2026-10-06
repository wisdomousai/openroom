/**
 * RFC 9727 API Catalog — /.well-known/api-catalog + OpenAPI + health.
 */
import { describe, expect, it } from 'vitest';

import { call, BASE } from './helpers.js';

describe('RFC 9727 API catalog', () => {
  it('serves /.well-known/api-catalog as application/linkset+json', async () => {
    const res = await call('/.well-known/api-catalog');
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toMatch(/^application\/linkset\+json/);
    expect(ct).toContain('profile="https://www.rfc-editor.org/info/rfc9727"');

    const body = (await res.json()) as {
      linkset: Array<{
        anchor: string;
        'service-desc'?: Array<{ href: string; type?: string }>;
        'service-doc'?: Array<{ href: string; type?: string }>;
        status?: Array<{ href: string; type?: string }>;
      }>;
    };
    expect(Array.isArray(body.linkset)).toBe(true);
    expect(body.linkset.length).toBeGreaterThanOrEqual(1);

    for (const entry of body.linkset) {
      expect(entry.anchor).toMatch(/^https:\/\//);
      expect(entry['service-desc']?.[0]?.href).toMatch(/^https:\/\//);
      expect(entry['service-doc']?.length).toBeGreaterThanOrEqual(1);
      expect(entry.status?.[0]?.href).toBe(`${BASE}/api/health`);
    }

    const anchors = body.linkset.map((e) => e.anchor);
    expect(anchors).toContain(`${BASE}/api`);
    expect(anchors).toContain(`${BASE}/api/mcp`);
    expect(anchors).toContain(`${BASE}/api/a2a`);

    const a2a = body.linkset.find((e) => e.anchor === `${BASE}/api/a2a`);
    expect(a2a?.['service-desc']?.[0]?.href).toBe(`${BASE}/.well-known/agent-card.json`);
  });

  it('serves OpenAPI at /openapi.json', async () => {
    const res = await call('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(body.openapi).toMatch(/^3\./);
    expect(body.paths['/api/sessions']).toBeTruthy();
    expect(body.paths['/api/mcp']).toBeTruthy();
    expect(body.paths['/api/a2a']).toBeTruthy();
    expect(body.paths['/api/tutoring/contexts']).toBeTruthy();
    expect(body.paths['/api/decks']).toBeTruthy();
    expect(body.paths['/api/decks/{deckId}/versions']).toBeTruthy();
    expect(body.paths['/api/sessions']).toBeTruthy();
    expect(body.paths['/api/sessions/{sessionId}/launch']).toBeTruthy();
  });

  it('documents session-local handle recovery on the join endpoint', async () => {
    const res = await call('/openapi.json');
    const body = (await res.json()) as {
      paths: Record<
        string,
        {
          post?: {
            requestBody?: {
              content?: Record<string, { schema?: { properties?: Record<string, unknown> } }>;
            };
          };
        }
      >;
    };
    const properties =
      body.paths['/api/join']?.post?.requestBody?.content?.['application/json']?.schema?.properties;

    expect(properties?.recoveryHandle).toBeTruthy();
  });

  it('documents the credentials accepted by the session-creation route', async () => {
    const res = await call('/openapi.json');
    const body = (await res.json()) as {
      paths: Record<string, { post?: { security?: Array<Record<string, unknown>> } }>;
      components?: { securitySchemes?: Record<string, unknown> };
    };

    // One POST creates both kinds of session — live from an outline or outline
    // (admin key or cookie), durable from a deck (PAT or cookie) — so all three
    // credentials are documented on the one operation.
    expect(body.paths['/api/sessions']?.post?.security).toEqual([
      { AdminKey: [] },
      { UserBearer: [] },
      { SessionCookie: [], CsrfHeader: [] },
    ]);
    expect(body.components?.securitySchemes?.SessionCookie).toBeTruthy();
    expect(body.components?.securitySchemes?.CsrfHeader).toBeTruthy();
  });

  it('serves /api/health', async () => {
    const res = await call('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('answers HEAD on the catalog', async () => {
    const res = await call('/.well-known/api-catalog', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/^application\/linkset\+json/);
  });
});
