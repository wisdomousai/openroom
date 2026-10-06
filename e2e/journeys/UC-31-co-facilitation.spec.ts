import { test, expect } from '@playwright/test';
import { facilitatorAccounts } from '../fixtures/facilitators';
import { command, hostUrl, stageUrl, waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });
test('shared facilitators moderate, pass presentation, use a phone remote, recover and lose access on removal', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const accounts = facilitatorAccounts();
  const helperContext = await browser.newContext(), remoteContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let live: Awaited<ReturnType<typeof import('../fixtures/session').createSession>> | undefined;
  try {
    await accounts.owner.signIn(page.context());
    await accounts.helper.signIn(helperContext);
    await accounts.helper.signIn(remoteContext);
    const helper = await helperContext.newPage(), remote = await remoteContext.newPage(), stage = await browser.newPage();
    const spaceResponse = await page.request.post('/api/my/spaces', { headers: CSRF, data: { name: 'Co-facilitation workshop', experience: 'training' } });
    expect(spaceResponse.status()).toBe(201);
    const space = await spaceResponse.json();
    const invitation = await page.request.post(`/api/my/spaces/${space.id}/invites`, { headers: CSRF, data: { email: accounts.helper.email, role: 'presenter' } });
    expect(invitation.status()).toBe(201);
    const invite = await invitation.json();
    expect((await helper.request.post(`/api/my/invites/${invite.id}/accept`, { headers: CSRF })).ok()).toBe(true);
    const created = await page.request.post('/api/sessions', { headers: CSRF, data: { spaceId: space.id, outline: {
      version: 1, meta: { title: 'Better decisions together' }, interactions: [{ id: 'proposal', type: 'text', prompt: 'What should we try?', responseMode: 'group' }],
      steps: [{ id: 'welcome', kind: 'statement', title: 'Better decisions together', body: 'Choose one change worth trying.' }, { id: 'debrief', kind: 'statement', title: 'Make it practical', body: 'Name the first step.' }, { id: 'proposal', kind: 'interaction', interactionId: 'proposal' }],
    } } });
    expect(created.status()).toBe(201);
    live = await created.json();
    await command(live!.code, live!.hostToken, { command: 'session.start' });
    await page.goto(hostUrl(live!));
    await stage.goto(stageUrl(live!));
    await helper.goto(`/host/#/space/${space.id}`);
    await helper.getByRole('button', { name: 'Join session Better decisions together', exact: true }).click();
    await expect(helper.getByRole('region', { name: 'Facilitators' }).getByText('Alex is presenting')).toBeVisible();
    await expect(helper.getByRole('button', { name: 'Next', exact: true }).first()).toBeDisabled();
    await helper.getByRole('button', { name: 'Groups', exact: true }).click();
    await helper.getByRole('button', { name: 'New group', exact: true }).click();
    await helper.getByLabel('Group name', { exact: true }).fill('Workshop team');
    await helper.getByRole('button', { name: 'Save group', exact: true }).click();
    await expect(helper.getByText('Workshop team', { exact: true })).toBeVisible();
    await helper.keyboard.press('ArrowRight');
    await expect(stage.getByText('Better decisions together', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pass presentation', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sam', exact: true }).click();
    await expect(helper.getByText('You are presenting', { exact: true })).toBeVisible();
    await expect(page.getByText('Sam is presenting', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('facilitator-handoff.png') });
    const capability = await (await remote.request.post(`/api/my/sessions/${live!.code}/facilitate`, { headers: CSRF })).json();
    await remote.goto(hostUrl({ ...live!, ...capability }));
    await remote.getByRole('button', { name: 'Presenter view', exact: true }).click();
    await expect(remote.getByText('You are presenting', { exact: true })).toBeVisible();
    await remote.getByRole('button', { name: 'Next →', exact: true }).click();
    await expect(stage.getByText('Make it practical', { exact: true })).toBeVisible();
    await remote.screenshot({ path: testInfo.outputPath('facilitator-remote.png') });
    await page.getByRole('button', { name: 'Take back presentation', exact: true }).click();
    await expect(page.getByText('You are presenting', { exact: true })).toBeVisible();
    await expect(remote.getByRole('button', { name: '← Back', exact: true })).toBeDisabled();
    await expect(stage.getByText('Make it practical', { exact: true })).toBeVisible();
    expect((await page.request.delete(`/api/my/spaces/${space.id}/members/${accounts.helper.id}`, { headers: CSRF })).ok()).toBe(true);
    const denied = await remote.request.get(`/api/sessions/${live!.code}/state?afterRevision=999999`, { headers: { authorization: `Bearer ${capability.hostToken}` } });
    expect(denied.status()).toBe(403);
    await stage.close();
  } finally {
    if (live) await command(live.code, live.hostToken, { command: 'session.end' });
    await helperContext.close(); await remoteContext.close();
    accounts.cleanup();
  }
});
