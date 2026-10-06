import { catalogHeaders, jsonHeaders } from './headers';

/** Linkset document (RFC 9264) listing OpenRoom's public APIs. */
export function apiCatalogDocument(origin: string): unknown {
  return {
    linkset: [
      {
        anchor: `${origin}/api`,
        'service-desc': [
          {
            href: `${origin}/openapi.json`,
            type: 'application/json',
          },
        ],
        'service-doc': [
          {
            href: `${origin}/docs/#http-api`,
            type: 'text/html',
          },
          {
            href: `${origin}/llms-full.txt`,
            type: 'text/plain',
          },
        ],
        status: [
          {
            href: `${origin}/api/health`,
            type: 'application/json',
          },
        ],
      },
      {
        anchor: `${origin}/api/mcp`,
        'service-desc': [
          {
            href: `${origin}/openapi.json`,
            type: 'application/json',
          },
        ],
        'service-doc': [
          {
            href: `${origin}/llms.txt`,
            type: 'text/plain',
          },
          {
            href: `${origin}/docs/`,
            type: 'text/html',
          },
        ],
        status: [
          {
            href: `${origin}/api/health`,
            type: 'application/json',
          },
        ],
      },
      {
        anchor: `${origin}/api/a2a`,
        'service-desc': [
          {
            href: `${origin}/.well-known/agent-card.json`,
            type: 'application/json',
            title: 'A2A agent card',
          },
        ],
        'service-doc': [
          {
            href: `${origin}/llms.txt`,
            type: 'text/plain',
          },
        ],
        status: [
          {
            href: `${origin}/api/health`,
            type: 'application/json',
          },
        ],
      },
    ],
  };
}

export function apiCatalogRoute(origin: string, method: string): Response {
  if (method === 'HEAD') {
    return new Response(null, { status: 200, headers: catalogHeaders() });
  }
  if (method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
      status: 405,
      headers: { ...jsonHeaders(), allow: 'GET, HEAD' },
    });
  }
  return new Response(JSON.stringify(apiCatalogDocument(origin)), {
    status: 200,
    headers: catalogHeaders(),
  });
}

/** OpenAPI 3.1 covering the agent-facing HTTP API and MCP endpoint. */
