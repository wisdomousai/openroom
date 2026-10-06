import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createSession, command, hostUrl, join, waitForWorker } from '../fixtures/session';

test.beforeAll(async () => { await waitForWorker(); });

test('facilitator selects, reviews and downloads a private-data-free recap, refreshing stale choices explicitly', async ({ page, context }, testInfo) => {
  const session = await createSession({ version: 1, meta: { title: 'Making the pilot work' }, qna: { enabled: true }, interactions: [
    { id: 'decision', type: 'choice', prompt: 'Where should we start?', options: [{ id: 'a', label: 'One team', correct: true }, { id: 'b', label: 'Every team', misconception: 'PRIVATE answer guidance' }], notes: 'PRIVATE teaching note' },
    { id: 'ideas', type: 'text', prompt: 'What would make this useful?' },
  ] });
  const participant = await join(session.code), hidden = await join(session.code);
  await command(session.code, session.hostToken, { command: 'session.start' });
  await command(session.code, session.hostToken, { command: 'interaction.open', interactionId: 'decision' });
  await command(session.code, participant.participantToken, { command: 'answer.submit', interactionId: 'decision', answer: { kind: 'choice', optionIds: ['a'] } });
  await command(session.code, session.hostToken, { command: 'interaction.open', interactionId: 'ideas' });
  await command(session.code, participant.participantToken, { command: 'answer.submit', interactionId: 'ideas', answer: { kind: 'text', text: 'Try a small pilot with a clear owner' } });
  await command(session.code, hidden.participantToken, { command: 'answer.submit', interactionId: 'ideas', answer: { kind: 'text', text: 'MODERATED answer' } });
  await command(session.code, session.hostToken, { command: 'text.hide', interactionId: 'ideas', participantId: hidden.participantId });
  await command(session.code, participant.participantToken, { command: 'qna.ask', questionId: 'help', text: 'Who will support the first team?' });
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(hostUrl(session));
  await page.getByRole('button', { name: 'Session menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Prepare workshop recap' }).click();
  await expect(page.getByRole('heading', { name: 'Workshop recap', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review recap', exact: true })).toBeDisabled();
  const choose = async () => {
    await page.getByRole('checkbox', { name: /Where should we start/ }).check();
    await page.getByRole('checkbox', { name: /Try a small pilot/ }).check();
    await page.getByRole('checkbox', { name: /Who will support/ }).check();
  };
  await choose();
  await page.getByLabel('Discussion summary', { exact: true }).fill('Start with one team and collect suggestions.');
  await page.getByLabel('Shared follow-up', { exact: true }).fill('Alex will prepare the pilot briefing.');
  // Ending the live source after selecting changes its revision. No silent reselection.
  await command(session.code, session.hostToken, { command: 'session.end' });
  await page.getByRole('button', { name: 'Review recap', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The session changed');
  await page.getByRole('button', { name: 'Refresh available content' }).click();
  await expect(page.getByRole('checkbox', { name: /Where should we start/ })).not.toBeChecked();
  await expect(page.getByLabel('Shared follow-up', { exact: true })).toHaveValue('Alex will prepare the pilot briefing.');
  await choose();
  await page.getByRole('button', { name: 'Review recap', exact: true }).click();
  const preview = page.frameLocator('iframe[title="Shareable recap"]');
  await expect(preview.getByRole('heading', { name: 'Making the pilot work' })).toBeVisible();
  await expect(preview.getByText('Who will support the first team?', { exact: true })).toBeVisible();
  await expect(preview.getByText('1 response', { exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Workshop recap', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('recap-review.png'), fullPage: true });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download recap', exact: true }).click()]);
  const destination = testInfo.outputPath('workshop-recap.html'); await download.saveAs(destination);
  const html = readFileSync(destination, 'utf8');
  for (const secret of ['PRIVATE', 'MODERATED', participant.participantId, hidden.participantId, session.hostToken, session.code]) expect(html).not.toContain(secret);
  const shared = await context.newPage(); await shared.setViewportSize({ width: 980, height: 1100 });
  await shared.setContent(html);
  await expect(shared.getByText('Alex will prepare the pilot briefing.', { exact: true })).toBeVisible();
  await shared.screenshot({ path: testInfo.outputPath('recap-document.png'), fullPage: true });
  await shared.setViewportSize({ width: 390, height: 844 });
  expect(await shared.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shared.close();
  // Editing invalidates the reviewed download, preventing an out-of-date artifact.
  await page.getByLabel('Shared follow-up', { exact: true }).fill('Review revised action');
  await expect(page.getByRole('button', { name: 'Download recap', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
