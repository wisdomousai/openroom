
export const CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

const CORS = { 'access-control-allow-origin': '*' } as const;

export function catalogHeaders(): HeadersInit {
  return {
    'content-type': CATALOG_CONTENT_TYPE,
    'cache-control': 'public, max-age=300',
    'x-content-type-options': 'nosniff',
    ...CORS,
  };
}

export function jsonHeaders(contentType = 'application/json; charset=utf-8'): HeadersInit {
  return {
    'content-type': contentType,
    'cache-control': 'public, max-age=300',
    'x-content-type-options': 'nosniff',
    ...CORS,
  };
}

