import { expect, test } from '@playwright/test';
import { facilitatorAccounts } from '../fixtures/facilitators';
import { officeHostFixture } from '../fixtures/office';
import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });
test('connects through real browser consent, binds and copies a slide, then revokes access from Settings', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const accounts = facilitatorAccounts();
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  try {
    await accounts.owner.signIn(page.context()); await officeHostFixture(page.context());
    const spaceReply = await page.request.post('/api/my/spaces', { headers: CSRF, data: { name: 'Northstar training', experience: 'training' } });
    expect(spaceReply.status()).toBe(201); const space = await spaceReply.json();
    const deckReply = await page.request.post('/api/decks', { headers: CSRF, data: { spaceId: space.id, content: {
      version: 1, meta: { title: 'A better customer conversation' },
      steps: [{ id: 'choose-response', kind: 'interaction', interactionId: 'response' }],
      interactions: [{ id: 'response', type: 'choice', prompt: 'What would you say first?', options: [{ id: 'listen', label: 'Ask what matters most' }, { id: 'explain', label: 'Explain the process' }] }],
    } } });
    expect(deckReply.status()).toBe(201); const { deck } = await deckReply.json();
    await page.setViewportSize({ width: 340, height: 820 });
    const pane = await page.goto('/office/taskpane.html');
    expect(pane!.status()).toBe(200);
    await expect(page).toHaveURL(/\/office\/taskpane\.html$/);
    expect(pane!.headers()['x-frame-options']).toBeUndefined();
    expect(pane!.headers()['content-security-policy']).toContain('https://*.officeapps.live.com');
    await page.screenshot({ path: testInfo.outputPath('powerpoint-sign-in.png'), fullPage: true });
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Sign in to OpenRoom', exact: true }).click();
    const consent = await popupPromise;
    const consentUrl = new URL(consent.url());
    expect(consentUrl.searchParams.get('redirect_uri')).toBe(`${new URL(page.url()).origin}/office/callback.html`);
    await expect(consent.getByRole('heading', { name: 'Connect OpenRoom for PowerPoint' })).toBeVisible();
    await expect(consent.getByText(accounts.owner.email, { exact: true })).toBeVisible();
    const approvalReply = consent.waitForResponse((response) => new URL(response.url()).pathname === '/api/mcp/authorize' && response.request().method() === 'POST');
    await consent.getByRole('button', { name: 'Approve connection', exact: true }).click();
    const approved = await approvalReply;
    expect(approved.status(), `Consent POST Origin: ${approved.request().headers().origin}`).toBe(302);
    await page.getByRole('button', { name: 'Northstar training', exact: false }).click();
    await page.getByRole('button', { name: 'A better customer conversation', exact: false }).click();
    await page.getByRole('button', { name: 'Use on selected slide', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Selected for this slide', exact: true })).toBeDisabled();
    const file = () => page.evaluate(() => (window as unknown as { __officeFile: { read(): { presentationTags: Record<string, string>; slides: Record<string, Record<string, string>> } } }).__officeFile.read());
    const original = await file(); const binding = JSON.parse(original.slides['42']!.OPENROOM_ACTIVITY!);
    expect(binding).toEqual({ version: 1, presentationId: expect.any(String), slideId: '42', spaceId: space.id, deckId: deck.id, stepId: 'choose-response' });
    await page.screenshot({ path: testInfo.outputPath('powerpoint-connected.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => (window as unknown as { __officeFile: { copy(from: string, to: string): void } }).__officeFile.copy('42', '88'));
    await expect(page.getByText('This slide was copied.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Use on selected slide', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Selected for this slide', exact: true })).toBeDisabled();
    const copied = await file(); expect(JSON.parse(copied.slides['88']!.OPENROOM_ACTIVITY!).slideId).toBe('88');
    expect(copied.slides['42']).toEqual(original.slides['42']);
    const settings = await page.context().newPage();
    const hostPage = await settings.goto('/host/#/settings');
    expect(hostPage!.headers()['x-frame-options']).toBe('DENY');
    await expect(settings.getByRole('heading', { name: 'Connected applications', exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Revoke OpenRoom for PowerPoint', exact: true }).click();
    await expect(settings.getByText('No connected applications.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Spaces', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('no longer active');
    await expect(page.getByRole('button', { name: 'Sign in to OpenRoom', exact: true })).toBeVisible();
    expect(await file()).toEqual(copied);
    expect((await page.request.get('/api/my/spaces')).status()).toBe(200);
    expect(errors).toEqual([]);
  } finally { accounts.cleanup(); }
});
