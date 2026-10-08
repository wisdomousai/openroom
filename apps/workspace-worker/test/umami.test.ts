import { describe, expect, it } from 'vitest';
import { countsPageviews, umamiWebsiteId, withUmami } from '../src/umami';

const WEBSITE_ID = '00000000-0000-4000-8000-000000000000';
const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' ws: wss: https://cloudflareinsights.com; base-uri 'none'";

function page(body: string, pathname = '/docs/'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP },
  });
}

describe('Umami Cloud on the public site', () => {
  it('accepts only a website id', () => {
    expect(umamiWebsiteId(WEBSITE_ID)).toBe(WEBSITE_ID);
    expect(umamiWebsiteId(` ${WEBSITE_ID.toUpperCase()} `)).toBe(WEBSITE_ID);
    expect(umamiWebsiteId('not-a-uuid')).toBeNull();
    expect(umamiWebsiteId('https://cloud.umami.is/script.js')).toBeNull();
    expect(umamiWebsiteId('')).toBeNull();
    expect(umamiWebsiteId(undefined)).toBeNull();
  });

  it('adds the cloud snippet and names its origins in the page policy', async () => {
    const result = await withUmami(
      page('<html><head><title>Docs</title></head><body></body></html>'),
      new URL('https://openroom.app/docs/'),
      WEBSITE_ID,
    );
    const html = await result.text();
    expect(html).toContain(
      `<script defer src="https://cloud.umami.is/script.js" data-website-id="${WEBSITE_ID}"></script></head>`,
    );
    const csp = result.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src https://cloud.umami.is 'self'");
    expect(csp).toContain("connect-src https://gateway.umami.is 'self'");
    expect(csp).toContain('https://static.cloudflareinsights.com');
  });

  it('leaves the workspace, non-HTML, and error pages alone', async () => {
    expect(countsPageviews('/host/')).toBe(false);
    expect(countsPageviews('/')).toBe(true);

    const workspace = await withUmami(
      page('<html><head></head><body>app</body></html>', '/host/'),
      new URL('https://openroom.app/host/'),
      WEBSITE_ID,
    );
    expect(await workspace.text()).not.toContain('cloud.umami.is');

    const markdown = await withUmami(
      new Response('# Docs', { status: 200, headers: { 'content-type': 'text/markdown' } }),
      new URL('https://openroom.app/docs/'),
      WEBSITE_ID,
    );
    expect(await markdown.text()).toBe('# Docs');

    const missing = await withUmami(
      new Response('<html><head></head></html>', { status: 404, headers: { 'content-type': 'text/html' } }),
      new URL('https://openroom.app/missing'),
      WEBSITE_ID,
    );
    expect(await missing.text()).not.toContain('cloud.umami.is');
  });
});
