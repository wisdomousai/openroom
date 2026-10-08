/**
 * Pageview counter for the public website, pointed at Umami Cloud.
 *
 * The script is added when the HTML is served, not baked into the site build,
 * so a deployment without `UMAMI_WEBSITE_ID` ships the same pages with no
 * tracker. `/host` (the workspace, including the learner page) is skipped.
 * Join and stage are served by the relay and never reach this function.
 *
 * The cloud script loads from `cloud.umami.is` and posts page views to
 * `gateway.umami.is`. A page that already has a Content-Security-Policy must
 * name both origins.
 */

const SCRIPT = 'https://cloud.umami.is/script.js';
const SCRIPT_ORIGIN = 'https://cloud.umami.is';
const COLLECT_ORIGIN = 'https://gateway.umami.is';
const WEBSITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A Umami website id, or null when the deployment should not track. */
export function umamiWebsiteId(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toLowerCase();
  return WEBSITE_ID.test(id) ? id : null;
}

export function countsPageviews(pathname: string): boolean {
  return !pathname.startsWith('/host');
}

/**
 * Insert the Umami snippet and allow its origins in `script-src` and
 * `connect-src`. Non-HTML, non-200, and workspace responses pass through.
 */
export async function withUmami(response: Response, page: URL, websiteId: string): Promise<Response> {
  if (!countsPageviews(page.pathname) || response.status !== 200) return response;
  const type = response.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('text/html')) return response;

  const html = await response.text();
  if (!html.includes('</head>') || html.includes('data-website-id=')) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  const tag = `<script defer src="${SCRIPT}" data-website-id="${websiteId}"></script>`;
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  const csp = headers.get('content-security-policy');
  if (csp) headers.set('content-security-policy', allowUmami(csp));

  return new Response(html.replace('</head>', `${tag}</head>`), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function allowUmami(csp: string): string {
  return csp.replaceAll(/(script-src|connect-src)([^;]*)/g, (match, directive: string, rest: string) => {
    const origin = directive === 'script-src' ? SCRIPT_ORIGIN : COLLECT_ORIGIN;
    const tokens = rest.split(/\s+/).filter((token) => token !== '');
    if (tokens.includes(origin)) return match;
    return `${directive} ${origin}${rest}`;
  });
}
