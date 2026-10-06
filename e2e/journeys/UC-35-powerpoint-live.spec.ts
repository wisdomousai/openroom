import { colorContrast } from '../../packages/schema/src/brand-kit';
import { defaultDeckDesign } from '../../packages/schema/src/deck-design';
import { expect, test, type Page } from '@playwright/test';
import { facilitatorAccounts } from '../fixtures/facilitators';
import { officeHostFixture } from '../fixtures/office';
import { command, join, waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
async function connect(page: Page) {
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Sign in to OpenRoom', exact: true }).click();
  await (await popup).getByRole('button', { name: 'Approve connection', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Choose content' })).toBeVisible();
}
const select = (page: Page, id: string) => page.evaluate((id) => (window as unknown as { __officeFile: { select(id: string): void } }).__officeFile.select(id), id);
const file = (page: Page) => page.evaluate(() => (window as unknown as { __officeFile: { read(): { presentationTags: Record<string, string>; slides: Record<string, Record<string, string>> } } }).__officeFile.read());

test.beforeAll(async () => { await waitForWorker(); });
test('recovers a lost start response, retains answers across revisits and reloads, and shares control with the companion', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const accounts = facilitatorAccounts();
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  try {
    await accounts.owner.signIn(page.context()); await officeHostFixture(page.context());
    const space = await (await page.request.post('/api/my/spaces', { headers: CSRF, data: { name: 'Workshop questions', experience: 'training' } })).json();
    const deckReply = await page.request.post('/api/decks', { headers: CSRF, data: { spaceId: space.id, content: {
      version: 1, meta: { title: 'Customer conversations' },
      steps: [{ id: 'listen', kind: 'interaction', interactionId: 'first' }, { id: 'follow-up', kind: 'interaction', interactionId: 'second' }],
      interactions: [
        { id: 'first', type: 'choice', prompt: 'What would you say first?', options: [{ id: 'a', label: 'Ask what matters most' }, { id: 'b', label: 'Explain the process' }] },
        { id: 'second', type: 'choice', prompt: 'How would you follow up?', options: [{ id: 'a', label: 'Agree a next step' }, { id: 'b', label: 'Send a brochure' }] },
      ],
    } } });
    expect(deckReply.status()).toBe(201); const { deck } = await deckReply.json();
    const otherReply = await page.request.post('/api/decks', { headers: CSRF, data: { spaceId: space.id, content: {
      version: 1, meta: { title: 'Another workshop' }, design: defaultDeckDesign('board'),
      steps: [{ id: 'listen', kind: 'interaction', interactionId: 'first' }],
      interactions: [{ id: 'first', type: 'choice', prompt: 'A different workshop question', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] }],
    } } });
    expect(otherReply.status()).toBe(201); const { deck: otherDeck } = await otherReply.json();
    await page.setViewportSize({ width: 340, height: 900 }); await page.goto('/office/taskpane.html'); await connect(page);
    await page.getByRole('button', { name: 'Workshop questions', exact: false }).click();
    await page.getByRole('button', { name: 'Customer conversations', exact: false }).click();
    await page.getByRole('listitem').filter({ hasText: 'What would you say first?' }).getByRole('button', { name: 'Use on selected slide', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Selected for this slide', exact: true })).toBeDisabled();

    await select(page, '88');
    await page.getByRole('listitem').filter({ hasText: 'How would you follow up?' }).getByRole('button', { name: 'Use on selected slide', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Selected for this slide', exact: true })).toBeDisabled();
    await select(page, '99');
    await page.getByRole('button', { name: 'Workshop questions', exact: false }).click();
    await page.getByRole('button', { name: 'Another workshop', exact: false }).click();
    await page.getByRole('button', { name: 'Use on selected slide', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Selected for this slide', exact: true })).toBeDisabled();
    await page.evaluate(() => (window as any).__officeFile.copy('99', '101'));
    await expect(page.getByText('This slide was copied.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Use on selected slide', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Selected for this slide', exact: true })).toBeDisabled();
    // Native order differs from IDs and connection order. Unconnected slides stay in PowerPoint.
    await select(page, '150');
    await page.evaluate(() => (window as any).__officeFile.reorder(['150', '42', '99', '88', '101']));
    await select(page, '42');

    // The server succeeds but the pane never receives its reply. Resume must recover that audience.
    let firstGrant: { sessionId: string; sessionCode: string; hostToken: string } | undefined;
    await page.route(`**/api/presentations/start`, async (route) => {
      const reply = await route.fetch(); expect(reply.status()).toBe(201); firstGrant = await reply.json();
      await route.abort('connectionreset');
    }, { times: 1 });
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    const controls = page.getByRole('region', { name: 'Session controls' });
    await expect(controls.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Resume session', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Selected slide is live', exact: true })).toBeDisabled();
    expect(firstGrant).toBeDefined();
    const code = firstGrant!.sessionCode;
    const recovered = await (await page.request.post(`/api/sessions/${firstGrant!.sessionId}/resume`, { headers: CSRF, data: {} })).json();
    expect(recovered.presentation.activities.map((item: any) => [item.slideId, item.deckId])).toEqual([['42', deck.id], ['99', otherDeck.id], ['88', deck.id], ['101', otherDeck.id]]);
    await expect(controls.getByText(code, { exact: true })).toBeVisible();
    const state = async () => (await page.request.get(`/api/sessions/${code}/state?role=host`, { headers: { authorization: `Bearer ${firstGrant!.hostToken}` } })).json();
    const participant = await join(code);
    await command(code, participant.participantToken, { command: 'answer.submit', interactionId: 'activity-1-question-1', answer: { kind: 'choice', optionIds: ['a'] } });
    await expect(controls.getByText('1 joined · 1 answered', { exact: true })).toBeVisible();
    await controls.getByRole('button', { name: 'Reveal results', exact: true }).click();
    await expect.poll(async () => (await state()).interactionStatus).toBe('revealed');
    await select(page, '99');
    await controls.getByRole('button', { name: 'Show selected slide', exact: true }).click();
    await expect.poll(async () => (await state()).activeInteractionId).toBe('activity-2-question-1');
    await expect(controls.getByRole('heading', { name: 'A different workshop question', exact: true })).toBeVisible();
    const audiencePopup = page.waitForEvent('popup');
    await controls.getByRole('link', { name: 'Open audience display', exact: false }).click();
    const audience = await audiencePopup;
    await expect(audience.locator('[data-slide-theme="board"]')).toBeVisible();
    await expect(audience.getByText('A different workshop question', { exact: true })).toBeVisible();
    const chartColors = await audience.locator('.or-bars-chart').evaluate((chart) => {
      const style = getComputedStyle(chart);
      return { text: style.getPropertyValue('--foreground').trim(), track: style.getPropertyValue('--muted').trim() };
    });
    expect(colorContrast(chartColors.text, chartColors.track)).toBeGreaterThanOrEqual(4.5);
    await audience.screenshot({ path: testInfo.outputPath('powerpoint-composed-board.png') });
    await audience.close();
    await command(code, participant.participantToken, { command: 'answer.submit', interactionId: 'activity-2-question-1', answer: { kind: 'choice', optionIds: ['b'] } });
    await expect(controls.getByText('1 joined · 1 answered', { exact: true })).toBeVisible();
    await select(page, '101');
    await controls.getByRole('button', { name: 'Show selected slide', exact: true }).click();
    await expect(controls.getByText('1 joined · 0 answered', { exact: true })).toBeVisible();
    await select(page, '88');
    await controls.getByRole('button', { name: 'Show selected slide', exact: true }).click();
    await expect.poll(async () => (await state()).activeInteractionId).toBe('activity-3-question-1');
    await select(page, '42');
    await controls.getByRole('button', { name: 'Show selected slide', exact: true }).click();
    await expect(controls.getByText('1 joined · 1 answered', { exact: true })).toBeVisible();
    await controls.getByRole('button', { name: 'Reveal results', exact: true }).click();
    await expect.poll(async () => (await state()).interactionStatus).toBe('revealed');
    const before = await state(), document = await file(page);
    expect(JSON.parse(document.presentationTags.OPENROOM_SESSION!)).toEqual({ version: 1, presentationId: expect.any(String), sessionId: firstGrant!.sessionId });
    expect(Object.keys(document.presentationTags).sort()).toEqual(['OPENROOM_PRESENTATION', 'OPENROOM_SESSION']);
    await page.reload(); await connect(page);
    await page.getByRole('button', { name: 'Resume session', exact: true }).click();
    await expect(controls.getByText(code, { exact: true })).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Reveal results', exact: true })).toBeDisabled();
    expect((await state()).aggregate).toEqual(before.aggregate);
    expect(await file(page)).toEqual(document);
    await page.screenshot({ path: testInfo.outputPath('powerpoint-live.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Reordering/deleting native slides does not reinterpret answers in the running session.
    await page.evaluate(() => { (window as any).__officeFile.remove('88'); (window as any).__officeFile.reorder(['150', '101', '99', '42']); });
    await select(page, '99');
    await controls.getByRole('button', { name: 'Show selected slide', exact: true }).click();
    await expect(controls.getByText('1 joined · 1 answered', { exact: true })).toBeVisible();
    expect((await state()).activeInteractionId).toBe('activity-2-question-1');
    // A newly connected slide cannot take over a matching source ID in the frozen session.
    await select(page, '120');
    await page.getByRole('button', { name: 'Workshop questions', exact: false }).click();
    await page.getByRole('button', { name: 'Another workshop', exact: false }).click();
    await page.getByRole('button', { name: 'Use on selected slide', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Selected for this slide', exact: true })).toBeDisabled();
    await expect(controls.getByText('This slide was embedded or changed after the session started.', { exact: false })).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Show selected slide', exact: true })).toBeDisabled();
    await select(page, '42');
    await controls.getByRole('button', { name: 'Show selected slide', exact: true }).click();
    expect((await state()).aggregate).toEqual(before.aggregate);
    await controls.getByRole('button', { name: 'Reveal results', exact: true }).click();
    await expect(controls.getByRole('button', { name: 'Reveal results', exact: true })).toBeDisabled();

    const companionPopup = page.waitForEvent('popup');
    await controls.getByRole('link', { name: 'Open companion controls', exact: false }).click();
    const companion = await companionPopup;
    await expect(companion.getByRole('button', { name: 'Close answers', exact: true })).toBeVisible();
    await controls.getByRole('button', { name: 'Reopen answers', exact: true }).click();
    await expect(companion.getByRole('button', { name: 'Close answers', exact: true })).toBeEnabled();
    await companion.getByRole('button', { name: 'Close answers', exact: true }).click();
    await expect(controls.getByRole('button', { name: 'Close answers', exact: true })).toBeDisabled();
    await expect(controls.getByRole('button', { name: 'Reopen answers', exact: true })).toBeEnabled();
    await expect.poll(async () => (await state()).interactionStatus).toBe('closed');
    await controls.getByRole('button', { name: 'End session', exact: true }).click();
    await controls.getByRole('button', { name: 'End for everyone', exact: true }).click();
    await expect(controls.getByRole('heading', { name: 'Session ended', exact: true })).toBeVisible();
    await expect(companion.getByText('Session ended', { exact: true })).toBeVisible();
    await controls.getByRole('button', { name: 'Start a new session', exact: true }).click();
    await expect(controls.getByRole('heading', { name: 'Live session', exact: true })).toBeVisible();
    await expect(controls.getByText('0 joined · 0 answered', { exact: true })).toBeVisible();
    expect(JSON.parse((await file(page)).presentationTags.OPENROOM_SESSION!).sessionId).not.toBe(firstGrant!.sessionId);
    expect(errors).toEqual([]);
  } finally { accounts.cleanup(); }
});
