/** Read-only production verification against the exact assets in the release. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const assets = resolve(root, 'apps/workspace-worker/public');
// The stage and participant apps ship with the relay; openroom.app forwards to it.
const relayAssets = resolve(root, 'apps/relay/public');
const assetRoot = (path) => (/^\/(?:join|stage)\//.test(path) ? relayAssets : assets);
const origin = new URL(process.argv[2] ?? 'https://openroom.app');
assert.equal(origin.protocol, 'https:', 'A production HTTPS origin is required');
assert.equal(origin.pathname, '/', 'Pass an origin without a path');
assert.ok(!origin.username && !origin.password && !origin.search && !origin.hash, 'Pass a plain origin');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Cloudflare adds request-specific challenge and analytics scripts after upload.
// The Worker adds an Umami Cloud snippet on public-site HTML when
// UMAMI_WEBSITE_ID is set. Preserve application scripts and text while
// excluding those known additions.
function htmlContent(bytes) {
  return bytes.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (script) => {
    if (/\bsrc=["']https:\/\/static\.cloudflareinsights\.com\//.test(script)) return '';
    if (script.includes('window.__CF$cv$params=') && script.includes('/cdn-cgi/challenge-platform/scripts/jsd/main.js')) return '';
    if (/\bsrc=["']https:\/\/cloud\.umami\.is\/script\.js["']/.test(script) && /\bdata-website-id=/.test(script)) return '';
    return script;
  }).replace(/>\s+</g, '><').trim();
}

async function request(path, check) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(new URL(path, origin), {
        headers: { Accept: path.endsWith('.json') ? 'application/json' : 'text/html,*/*;q=0.8', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(20_000),
      });
      assert.equal(new URL(response.url).origin, origin.origin, `${path}: unexpected redirect`);
      assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      await check(response, bytes);
      return bytes;
    } catch (error) {
      failure = error;
      if (attempt < 2) await new Promise((done) => setTimeout(done, 2000));
    }
  }
  throw failure;
}

await request('/api/health', (response, bytes) => {
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(JSON.parse(bytes).status, 'ok', 'Worker health must be ok');
});
const entries = JSON.parse(await readFile(resolve(assets, 'docs/search-index.json'), 'utf8'));
assert.ok(Array.isArray(entries) && entries.length > 0, 'The local manual search index must contain chapters');
const pending = new Set(['/', '/host/', '/join/', '/stage/', '/office/taskpane.html', '/docs/', '/docs/search/',
  '/docs/search-index.json', '/llms.txt', '/llms-full.txt', ...entries.map((entry) => entry.url)]);
const checked = new Set();
for (const path of pending) {
  assert.ok(path.startsWith('/') && !path.startsWith('//'), `Expected a local asset: ${path}`);
  const base = assetRoot(path);
  const file = resolve(base, `.${path.endsWith('/') ? `${path}index.html` : path}`);
  assert.ok(file.startsWith(`${base}/`), `Asset outside public directory: ${path}`);
  const expected = await readFile(file);
  const comparable = file.endsWith('.html') ? htmlContent : (bytes) => bytes;
  await request(path, (_response, bytes) => assert.equal(digest(comparable(bytes)), digest(comparable(expected)), `${path}: deployed asset differs from the build`));
  checked.add(path);
  if (file.endsWith('.html')) {
    for (const match of expected.toString().matchAll(/(?:src|href)="([^"#]+)"/g)) {
      const url = new URL(match[1], new URL(path, origin));
      if (url.origin === origin.origin && /\.(?:js|css|png|svg|webp|jpg|woff2?)$/.test(url.pathname)) pending.add(url.pathname);
    }
  }
}
console.log(`Production verified: health and ${checked.size} build assets at ${origin.origin} (known Cloudflare HTML injections excluded).`);
