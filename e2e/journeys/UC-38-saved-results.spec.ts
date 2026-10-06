import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { facilitatorAccounts } from '../fixtures/facilitators';
import { hostUrl, waitForWorker } from '../fixtures/session';

const csrf = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

test('opens retained result files from their deck, downloads a readable report and enforces current sharing after downgrade', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const accounts = facilitatorAccounts({ keep: true, rawExport: true });
  const helper = await browser.newContext({ baseURL: process.env.OPENROOM_URL ?? 'http://127.0.0.1:8787' });
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  try {
    await accounts.owner.signIn(page.context()); await accounts.helper.signIn(helper);
    const createdSpace = await page.request.post('/api/my/spaces', { headers: csrf, data: { name: 'Workshop results', experience: 'training' } });
    expect(createdSpace.status()).toBe(201); const space = await createdSpace.json();
    const invitation = await (await page.request.post(`/api/my/spaces/${space.id}/invites`, { headers: csrf, data: { email: accounts.helper.email, role: 'presenter' } })).json();
    expect((await helper.request.post(`/api/my/invites/${invitation.id}/accept`, { headers: csrf, data: {} })).status()).toBe(200);
    const content = { version: 1, meta: { title: 'Pilot decisions' }, steps: [{ id: 'choice-slide', kind: 'interaction', interactionId: 'decision' }, { id: 'text-slide', kind: 'interaction', interactionId: 'idea' }], interactions: [
      { id: 'decision', type: 'choice', prompt: 'Where should we start?', options: [{ id: 'a', label: 'One team', correct: true }, { id: 'b', label: 'Every team' }], notes: 'PRIVATE_GUIDANCE' },
      { id: 'idea', type: 'text', prompt: 'What would help?' },
    ] };
    const createdDeck = await page.request.post('/api/decks', { headers: csrf, data: { spaceId: space.id, content } });
    expect(createdDeck.status()).toBe(201); const { deck } = await createdDeck.json();
    const started = await helper.request.post(`/api/decks/${deck.id}/start`, { headers: csrf, data: { requestId: crypto.randomUUID() } });
    expect(started.status()).toBe(201); const live = await started.json(); accounts.trackArchive(live.sessionCode);
    const cmd = async (token: string, command: object) => {
      const response = await page.request.post(`/api/sessions/${live.sessionCode}/commands`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: crypto.randomUUID(), command } });
      expect(response.status(), await response.text()).toBe(200);
    };
    const person = await (await page.request.post('/api/join', { data: { code: live.sessionCode } })).json();
    await cmd(person.participantToken, { command: 'answer.submit', interactionId: 'decision', answer: { kind: 'choice', optionIds: ['a'] } });
    await cmd(live.hostToken, { command: 'interaction.open', interactionId: 'idea' });
    const quote = 'Try a pilot <img src=x onerror="window.UNSAFE=1">';
    await cmd(person.participantToken, { command: 'answer.submit', interactionId: 'idea', answer: { kind: 'text', text: quote } });
    const hidden = await (await page.request.post('/api/join', { data: { code: live.sessionCode } })).json();
    await cmd(hidden.participantToken, { command: 'answer.submit', interactionId: 'idea', answer: { kind: 'text', text: 'HIDDEN_RESPONSE' } });
    await cmd(live.hostToken, { command: 'text.hide', interactionId: 'idea', participantId: hidden.participantId });
    const helperPage = await helper.newPage();
    helperPage.on('pageerror', (error) => errors.push(error.message));
    await helperPage.goto(hostUrl(live));
    const privateNote = 'Follow up with the pilot team privately.';
    await helperPage.getByRole('textbox', { name: 'Private notes', exact: true }).fill(privateNote);
    await helperPage.getByRole('button', { name: 'End session', exact: true }).click();
    await helperPage.getByRole('dialog', { name: 'End this session?' }).getByRole('button', { name: 'End session', exact: true }).click();
    await expect(helperPage).toHaveURL(new RegExp(`/sessions/${live.sessionId}/record$`));
    await expect(helperPage.getByRole('textbox', { name: 'Notes on this device', exact: true })).toHaveValue(privateNote);
    await expect(helperPage.getByRole('button', { name: 'Save notes', exact: true })).toHaveCount(0);
    await helperPage.reload();
    await expect(helperPage.getByRole('textbox', { name: 'Notes on this device', exact: true })).toHaveValue(privateNote);
    expect((await (await page.request.get(`/api/sessions/${live.sessionId}/record`)).json()).record).toBeNull();
    const [privateDownload] = await Promise.all([helperPage.waitForEvent('download'), helperPage.getByRole('button', { name: 'Download private notes', exact: true }).click()]);
    const privatePath = testInfo.outputPath('private-notes.txt'); await privateDownload.saveAs(privatePath);
    expect(readFileSync(privatePath, 'utf8')).toBe(privateNote);
    await helperPage.screenshot({ path: testInfo.outputPath('presenter-notes.png'), fullPage: true });
    const setRole = async (role: 'editor' | 'presenter') => expect((await page.request.patch(`/api/my/spaces/${space.id}/members/${accounts.helper.id}`, { headers: csrf, data: { role } })).status()).toBe(200);
    await setRole('editor'); await helperPage.reload();
    await expect(helperPage.getByRole('textbox', { name: 'Private notes', exact: true })).toHaveValue(privateNote);
    const revisedNote = `${privateNote} Bring the pilot outline.`;
    await helperPage.getByRole('textbox', { name: 'Private notes', exact: true }).fill(revisedNote);
    await setRole('presenter');
    await helperPage.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(helperPage.getByRole('alert')).toContainText('Your access changed');
    await expect(helperPage.getByRole('textbox', { name: 'Private notes', exact: true })).toHaveValue(revisedNote);
    await expect(helperPage.getByRole('button', { name: 'Save notes', exact: true })).toBeDisabled();
    expect((await (await page.request.get(`/api/sessions/${live.sessionId}/record`)).json()).record).toBeNull();
    await helperPage.reload();
    await expect(helperPage.getByRole('textbox', { name: 'Notes on this device', exact: true })).toHaveValue(revisedNote);
    await setRole('editor'); await helperPage.reload();
    await helperPage.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(helperPage).toHaveURL(new RegExp(`space/${space.id}.*itemId=${deck.id}`));
    expect((await (await page.request.get(`/api/sessions/${live.sessionId}/record`)).json()).record.notes).toBe(revisedNote);
    await setRole('presenter'); await helperPage.goto(`/host/#/sessions/${live.sessionId}/record`);
    await expect(helperPage.getByRole('region', { name: 'Saved session notes', exact: true })).toContainText(revisedNote);
    await expect(helperPage.getByRole('textbox', { name: 'Notes on this device', exact: true })).toHaveValue('');
    await helperPage.getByRole('link', { name: 'Back to library', exact: true }).click();
    await expect.poll(async () => (await page.request.get(`/api/my/archives/${live.sessionCode}/document`)).status()).toBe(200);
    accounts.downgradeOwner();

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/host/#/space/${space.id}?itemId=${deck.id}`);
    const files = page.getByRole('region', { name: 'Saved results', exact: true });
    await files.getByRole('link', { name: /Pilot decisions/ }).click();
    await expect(page).toHaveURL(new RegExp(`/results/${live.sessionCode}$`));
    await expect(page.getByRole('heading', { name: 'Pilot decisions', exact: true })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: 'One team', exact: true })).toBeVisible();
    await expect(page.getByText(quote, { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('PRIVATE_GUIDANCE');
    await expect(page.locator('body')).not.toContainText('HIDDEN_RESPONSE');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Pilot decisions', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('saved-results-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('saved-results-mobile.png'), fullPage: true });

    const [report] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download report', exact: true }).click()]);
    const reportPath = testInfo.outputPath('saved-results.html'); await report.saveAs(reportPath);
    const html = readFileSync(reportPath, 'utf8');
    for (const secret of ['PRIVATE_GUIDANCE', 'HIDDEN_RESPONSE', person.participantId, live.hostToken, '<img']) expect(html).not.toContain(secret);
    expect(html).toContain('&lt;img');
    const document = await page.context().newPage(); await document.setViewportSize({ width: 1000, height: 1000 }); await document.setContent(html);
    await expect(document.getByRole('heading', { name: 'Pilot decisions', exact: true })).toBeVisible();
    expect(await document.evaluate(() => 'UNSAFE' in window)).toBe(false);
    await document.screenshot({ path: testInfo.outputPath('downloaded-report.png'), fullPage: true }); await document.close();

    await page.route('**/api/my/archives/*?format=ballots', (route) => route.fulfill({ status: 503, body: '{}' }));
    await page.getByRole('button', { name: 'Download individual responses' }).click();
    await expect(page.getByRole('alert')).toContainText('could not be downloaded');
    await page.unroute('**/api/my/archives/*?format=ballots');
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download individual responses' }).click()]);
    const csvPath = testInfo.outputPath('responses.csv'); await csv.saveAs(csvPath);
    expect(readFileSync(csvPath, 'utf8')).toContain('HIDDEN_RESPONSE');
    await page.getByRole('link', { name: 'Back to library', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`space/${space.id}.*itemId=${deck.id}`));

    await helperPage.goto(`/host/#/results/${live.sessionCode}`);
    await expect(helperPage.getByRole('heading', { name: 'Pilot decisions', exact: true })).toBeVisible();
    expect((await page.request.delete(`/api/my/spaces/${space.id}/members/${accounts.helper.id}`, { headers: csrf })).status()).toBe(200);
    await helperPage.reload();
    await expect(helperPage.getByRole('heading', { name: 'Saved results unavailable', exact: true })).toBeVisible();
    await expect(helperPage.getByRole('button', { name: 'Download report', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await helper.close(); accounts.cleanup(); }
});
