import { test, expect, type Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { WORKSHOP_SEQUENCES } from '../../packages/schema/src/workshop-sequences';
import { createSession, command, hostUrl, joinInBrowser, stageUrl, waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

test('workshop gallery inserts editable, themed sequences and preserves response modes', async ({ page }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'bob', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  await page.goto('/host/#/decks/new');
  await expect(page).toHaveURL(/#\/decks\/[^/]+\/edit$/);
  const id = /decks\/([^/]+)\/edit/.exec(page.url())![1]!;
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.getByRole('button', { name: 'business', exact: true }).click();
  for (const sequence of WORKSHOP_SEQUENCES) {
    await page.getByRole('button', { name: 'New slide', exact: true }).click();
    const gallery = page.getByRole('dialog', { name: 'Choose a slide' });
    await gallery.getByRole('button', { name: 'Workshops', exact: true }).click();
    if (sequence === WORKSHOP_SEQUENCES[0]) await gallery.screenshot({ path: testInfo.outputPath('workshop-gallery.png') });
    await gallery.getByRole('button', { name: `Insert ${sequence.name} workshop`, exact: true }).click();
    await expect(gallery).toHaveCount(0);
    await expect(page.locator('[data-slide-overflow]')).toHaveCount(0);
  }
  const slides = page.getByRole('list', { name: 'Slides' }).getByRole('button');
  await expect(slides).toHaveCount(1 + WORKSHOP_SEQUENCES.reduce((count, item) => count + item.steps.length, 0));
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
  expect(parseYaml((await (await page.request.get(`/api/decks/${id}/draft`)).json()).source).steps.length).toBe(1 + WORKSHOP_SEQUENCES.reduce((count, item) => count + item.steps.length, 0));
  const saved = parseYaml((await (await page.request.get(`/api/decks/${id}/draft`)).json()).source);
  const team = saved.steps.find((step: { interactionId?: string }) => step.interactionId?.startsWith('team-challenge-proposal'));
  const index = saved.steps.findIndex((step: { id: string }) => step.id === team.id);
  await slides.nth(index).click();
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.getByRole('button', { name: 'One per group', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Individual', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Individual', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
  expect(parseYaml((await (await page.request.get(`/api/decks/${id}/draft`)).json()).source).interactions.find((item: { id: string }) => item.id === team.interactionId)?.responseMode).toBe('individual');
  await page.reload();
  await slides.nth(index).click();
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Individual', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'One per group', exact: true }).click();
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
  for (let i = 0; i < saved.steps.length; i++) {
    await slides.nth(i).click();
    await expect(page.locator('[data-slide-overflow]'), `slide ${i + 1}`).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath('workshop-editor.png') });
});

test('facilitator assigns groups, hands off one shared response and returns to individual answers', async ({ page, browser }, testInfo) => {
  const session = await createSession({ version: 1, meta: { title: 'Workshop group decisions' }, defaults: { resultVisibility: 'hidden-until-close' },
    interactions: [
      { id: 'team', type: 'text', prompt: 'What should our group try?', responseMode: 'group', display: 'cards', notes: 'Private group guidance' },
      { id: 'solo', type: 'text', prompt: 'What will you try personally?', display: 'cards' },
    ], steps: [{ id: 'team', kind: 'interaction', interactionId: 'team' }, { id: 'solo', kind: 'interaction', interactionId: 'solo' }] });
  await command(session.code, session.hostToken, { command: 'session.start' });
  await command(session.code, session.hostToken, { command: 'interaction.open', interactionId: 'team' });
  await page.goto('/host/');
  await page.evaluate((s) => localStorage.setItem(`openroom.host.session.${s.sessionCode}`, JSON.stringify({ ...s, createdAt: Date.now() })), session);
  await page.goto(hostUrl(session));
  const first = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const second = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const outsider = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const stage = await browser.newPage();
  await stage.goto(stageUrl(session));
  const joinPhone = async (phone: Page) => {
    await joinInBrowser(phone, session.code);
    await expect(phone.getByText('Your facilitator will assign you to a group.')).toBeVisible();
    const name = (await phone.locator('.topbar .handle').textContent())!.trim();
    const dismiss = phone.getByRole('button', { name: 'Dismiss', exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    return name;
  };
  const name1 = await joinPhone(first), name2 = await joinPhone(second);
  await joinPhone(outsider);
  await page.getByRole('button', { name: 'Groups', exact: true }).click();
  await page.getByRole('button', { name: 'New group', exact: true }).click();
  await page.getByLabel('Group name', { exact: true }).fill('North');
  await page.getByRole('checkbox', { name: name1, exact: true }).check();
  await page.getByRole('checkbox', { name: name2, exact: true }).check();
  await page.getByRole('button', { name: `Make ${name1} spokesperson`, exact: true }).click();
  await page.getByRole('button', { name: 'Save group', exact: true }).click();
  await expect(first.getByText(/You are the spokesperson/)).toBeVisible();
  await expect(second.getByText(/Your spokesperson sends/)).toBeVisible();
  await expect(second.getByRole('button', { name: 'Send answer', exact: true })).toHaveCount(0);
  await first.getByRole('textbox').fill('Try a small pilot');
  await first.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(second.getByText('Group answer received', { exact: true })).toBeVisible();
  await expect(second.getByText('Try a small pilot', { exact: true })).toBeVisible();
  await expect(outsider.getByText('Try a small pilot', { exact: true })).toHaveCount(0);
  await expect(stage.getByText('Try a small pilot', { exact: true })).toHaveCount(0);
  await second.reload();
  await expect(second.getByText('Group answer received', { exact: true })).toBeVisible();
  await page.getByRole('region', { name: 'North', exact: true }).getByRole('button', { name: 'Edit group', exact: true }).click();
  await page.getByRole('button', { name: `Make ${name2} spokesperson`, exact: true }).click();
  await page.getByRole('button', { name: 'Save group', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Change answer', exact: true })).toHaveCount(0);
  await second.getByRole('button', { name: 'Change answer', exact: true }).click();
  await second.getByRole('textbox').fill('Test with one team');
  await second.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(first.getByText('Test with one team', { exact: true })).toBeVisible();
  const state = await (await page.request.get(`/api/sessions/${session.code}/state?view=host`, { headers: { authorization: `Bearer ${session.hostToken}` } })).json();
  expect(state.aggregate.total).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('facilitator-groups.png') });
  await second.screenshot({ path: testInfo.outputPath('group-spokesperson.png'), fullPage: true });
  await command(session.code, session.hostToken, { command: 'interaction.reveal', interactionId: 'team' });
  await expect(stage.getByText('Test with one team', { exact: true })).toBeVisible();
  await command(session.code, session.hostToken, { command: 'interaction.open', interactionId: 'solo' });
  for (const [phone, text] of [[first, 'Ask for feedback'], [second, 'Document the handoff']] as const) {
    await phone.getByRole('textbox').fill(text);
    await phone.getByRole('button', { name: 'Send answer', exact: true }).click();
  }
  await expect(first.getByText('Ask for feedback', { exact: true })).toBeVisible();
  await expect(first.getByText('Document the handoff', { exact: true })).toHaveCount(0);
  await expect(second.getByText('Document the handoff', { exact: true })).toBeVisible();
  await expect(second.getByText('Ask for feedback', { exact: true })).toHaveCount(0);
  await page.getByRole('region', { name: 'North', exact: true }).getByRole('button', { name: 'Dissolve', exact: true }).click();
  await expect(page.getByRole('region', { name: 'North', exact: true })).toHaveCount(0);
  const final = await (await page.request.get(`/api/sessions/${session.code}/state?view=host`, { headers: { authorization: `Bearer ${session.hostToken}` } })).json();
  expect(final.interactions.find((item: { id: string }) => item.id === 'team').aggregate.total).toBe(1);
  expect(final.aggregate.total).toBe(2);
  await first.close(); await second.close(); await outsider.close(); await stage.close();
});
