import { test, expect } from '@playwright/test';

test('every manual link, anchor and screenshot resolves and text editions contain each chapter', async ({ page, request }) => {
  const index = await (await request.get('/docs/search-index.json')).json() as { title: string; url: string }[];
  expect(index.length).toBeGreaterThan(25);
  const full = await (await request.get('/llms-full.txt')).text();
  const directory = await (await request.get('/llms.txt')).text();
  const ids = new Map<string, Set<string>>();
  const targets: { from: string; path: string; hash: string }[] = [];
  for (const entry of [{ title: 'OpenRoom user manual', url: '/docs/' }, ...index]) {
    const response = await page.goto(entry.url);
    expect(response?.status(), entry.url).toBe(200);
    await expect(page.getByRole('heading', { name: entry.title, exact: true, level: 1 })).toBeVisible();
    const snapshot = await page.evaluate(() => ({
      ids: [...document.querySelectorAll('[id]')].map((node) => node.id),
      links: [...document.querySelectorAll<HTMLAnchorElement>('main a')].map((node) => node.href),
      images: [...document.querySelectorAll<HTMLImageElement>('main img')].map((node) => ({ src: node.src, alt: node.alt, loaded: node.complete && node.naturalWidth > 0 })),
    }));
    ids.set(entry.url, new Set(snapshot.ids));
    for (const link of snapshot.links) {
      const url = new URL(link);
      if (url.pathname.startsWith('/docs/') && !url.pathname.startsWith('/docs/search')) targets.push({ from: entry.url, path: url.pathname, hash: decodeURIComponent(url.hash.slice(1)) });
    }
    for (const image of snapshot.images) { expect(image.alt, image.src).toBeTruthy(); expect(image.loaded, image.src).toBe(true); }
    if (entry.url !== '/docs/') { expect(full).toContain(entry.title); expect(directory).toContain(entry.url); }
  }
  for (const target of targets) {
    expect(ids.has(target.path), `${target.from} → ${target.path}`).toBe(true);
    if (target.hash) expect(ids.get(target.path)?.has(target.hash), `${target.from} → ${target.path}#${target.hash}`).toBe(true);
  }
  const negotiated = await request.get('/docs/learner/', { headers: { Accept: 'text/markdown' } });
  expect(negotiated.headers()['content-type']).toContain('text/markdown');
  expect(await negotiated.text()).toContain('Feedback');
});

test('search supports keyboard submission, back navigation, empty results, and recovery', async ({ page }) => {
  await page.goto('/docs/');
  const input = page.getByRole('searchbox', { name: 'Search the manual' });
  await input.fill('voice');
  await input.press('Enter');
  await expect(page.locator('#search-results')).toContainText('homework');
  await input.fill('zznomatchingmanualterm');
  await input.press('Enter');
  await expect(page.getByRole('status')).toContainText('No pages found');
  await page.goBack();
  await expect(input).toHaveValue('voice');
  await expect(page.locator('#search-results li').first()).toBeVisible();
  await page.route('**/docs/search-index.json', (route) => route.abort());
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Search could not load');
  await page.unroute('**/docs/search-index.json');
  await input.press('Enter');
  await expect(page.locator('#search-results li').first()).toBeVisible();
});

test('mobile chapters, legacy bookmarks and printed pages remain usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const path of ['/docs/', '/docs/questions/', '/docs/cli/', '/docs/learner/']) {
    await page.goto(path);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 320);
    await expect(page.locator('.manual-navigation')).not.toHaveAttribute('open');
    await page.getByText('Browse topics', { exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Manual chapters' })).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath('manual-mobile.png'), fullPage: true });
  await page.goto('/docs/#privacy');
  await expect(page.locator('#privacy a')).toBeVisible();
  await page.locator('#privacy a').click();
  await expect(page.getByRole('heading', { name: 'Privacy, retention, and limits', exact: true, level: 1 })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/docs/deck-editor/');
  await page.screenshot({ path: info.outputPath('manual-desktop.png') });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.manual-sidebar')).toBeHidden();
  await expect(page.locator('.manual-prose')).toBeVisible();
});

test('workspace Settings opens the public manual', async ({ page }) => {
  await page.goto('/host/');
  await page.getByLabel('Username', { exact: true }).fill('alice');
  await page.getByLabel('Password', { exact: true }).fill('demo');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Documentation', exact: true }).click();
  const manual = await popup;
  await expect(manual.getByRole('heading', { name: 'OpenRoom user manual', level: 1, exact: true })).toBeVisible();
  await manual.close();
});
