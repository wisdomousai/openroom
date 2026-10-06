import { expect, test } from '@playwright/test';
import { facilitatorAccounts } from '../fixtures/facilitators';
import { officeHostFixture } from '../fixtures/office';
import { command, join, waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });
test('rehearses locally and projects only the bound activity and released results into an embedded display', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const accounts = facilitatorAccounts(), errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await accounts.owner.signIn(context); await officeHostFixture(context);
    const space = await (await page.request.post('/api/my/spaces', { headers: CSRF, data: { name: 'Display workshop', experience: 'training' } })).json();
    const created = await page.request.post('/api/decks', { headers: CSRF, data: { spaceId: space.id, content: {
      version: 1, meta: { title: 'A constructive conversation' }, defaults: { resultVisibility: 'hidden-until-close' },
      steps: [{ id: 'opening', kind: 'interaction', interactionId: 'question', tutorNotes: 'Private slide guidance' }],
      interactions: [{ id: 'question', type: 'choice', prompt: 'What would you say first?', notes: 'Private facilitator note', options: [{ id: 'a', label: 'Ask what matters most', correct: true }, { id: 'b', label: 'Explain the process' }] }],
    } } });
    expect(created.status()).toBe(201); const { deck } = await created.json();
    await page.setViewportSize({ width: 340, height: 900 }); await page.goto('/office/taskpane.html');
    const popup = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Sign in to OpenRoom', exact: true }).click();
    await (await popup).getByRole('button', { name: 'Approve connection', exact: true }).click();
    await page.getByRole('button', { name: 'Display workshop', exact: false }).click();
    await page.getByRole('button', { name: 'A constructive conversation', exact: false }).click();
    await page.getByRole('button', { name: 'Use on selected slide', exact: true }).click();
    let rehearsalActive = true; const writes: string[] = [];
    page.on('request', (request) => { if (rehearsalActive && request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/')) writes.push(new URL(request.url()).pathname); });
    await page.getByRole('button', { name: 'Rehearse selected slide', exact: true }).click();
    const rehearsal = page.getByRole('region', { name: 'Slide rehearsal' });
    const preview = page.frameLocator('iframe[title="Audience preview"]');
    await expect(preview.getByText('What would you say first?', { exact: true })).toBeVisible();
    await rehearsal.getByRole('button', { name: 'Add sample responses', exact: true }).click();
    await expect(rehearsal.getByRole('status')).toHaveText('3 sample responses · Answers open');
    await rehearsal.getByRole('button', { name: 'Reveal results', exact: true }).click();
    await expect(preview.getByText('Ask what matters most', { exact: false }).first()).toBeVisible();
    await expect(preview.locator('figcaption')).toContainText('3 answers: Ask what matters most 67%');
    await page.screenshot({ path: testInfo.outputPath('powerpoint-rehearsal.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await rehearsal.getByRole('button', { name: 'Reset rehearsal', exact: true }).click();
    await expect(rehearsal.getByRole('status')).toHaveText('0 sample responses · Answers open');
    expect(writes).toEqual([]); rehearsalActive = false;
    await page.getByRole('button', { name: 'Back to presentation', exact: false }).click();

    const started = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/presentations/start');
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    const live = await (await started).json() as { sessionCode: string; sessionId: string; hostToken: string; stageToken: string };
    const document = await page.evaluate(() => (window as unknown as { __officeFile: { read(): { presentationTags: Record<string, string>; slides: Record<string, Record<string, string>> } } }).__officeFile.read());
    const display = await context.newPage(); display.on('pageerror', (error) => errors.push(error.message));
    await display.setViewportSize({ width: 960, height: 540 });
    await display.addInitScript((document) => sessionStorage.setItem('test-office-file', JSON.stringify({ ...document, selected: ['42'] })), document);
    const displayRequests: string[] = []; display.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) displayRequests.push(request.url()); });
    const contentPage = await display.goto('/office/content.html'); expect(contentPage!.status()).toBe(200);
    await expect(display.getByText('What would you say first?', { exact: true })).toBeVisible();
    const settings = await display.evaluate(() => (window as unknown as { __officeFile: { settings(): Record<string, string> } }).__officeFile.settings());
    expect(settings).toEqual({ 'openroom.activity': document.slides['42']!.OPENROOM_ACTIVITY });
    const participant = await join(live.sessionCode);
    await command(live.sessionCode, participant.participantToken, { command: 'answer.submit', interactionId: 'activity-1-question-1', answer: { kind: 'choice', optionIds: ['a'] } });
    const projection = await display.evaluate(async (presentationId) => {
      const channel = new BroadcastChannel(`openroom-display:${presentationId}`);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => { channel.close(); reject(new Error('No audience projection')); }, 10000);
        channel.onmessage = (event) => { if (event.data?.type === 'openroom.display' && event.data.snapshot?.answeredCount === 1) { clearTimeout(timer); channel.close(); resolve(event.data); } };
        channel.postMessage({ type: 'openroom.display.request' });
      });
    }, document.presentationTags.OPENROOM_PRESENTATION!);
    expect(Object.keys(projection).sort()).toEqual(['presentation', 'presentationId', 'sessionId', 'snapshot', 'status', 'type', 'version']);
    expect(projection.snapshot).toMatchObject({ role: 'stage', aggregate: null, answeredCount: 1 });
    expect(JSON.stringify(projection)).not.toContain('Private facilitator note');
    expect(JSON.stringify(projection)).not.toContain('Private slide guidance');
    expect(JSON.stringify(projection)).not.toContain(live.hostToken); expect(JSON.stringify(projection)).not.toContain(live.stageToken);
    const controls = page.getByRole('region', { name: 'Session controls' });
    await controls.getByRole('button', { name: 'Reveal results', exact: true }).click();
    await expect(display.getByText('Ask what matters most', { exact: false }).first()).toBeVisible();
    await expect(display.locator('figcaption')).toContainText('Ask what matters most 100%');
    await display.screenshot({ path: testInfo.outputPath('powerpoint-embedded-results.png') });
    expect(await display.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await controls.getByRole('button', { name: 'Hide results', exact: true }).click();
    await expect(display.locator('figcaption')).toContainText('Results hidden');
    // An un-reconnected copy cannot display the original slide's live answers.
    await display.evaluate(() => (window as unknown as { __officeFile: { copy(from: string, to: string): void } }).__officeFile.copy('42', '88'));
    await expect(display.getByRole('alert')).toContainText('Copied slides');
    await expect(display.getByText('What would you say first?', { exact: true })).toHaveCount(0);
    expect(displayRequests).toEqual([]);
    await display.evaluate(() => (window as unknown as { __officeFile: { select(id: string): void } }).__officeFile.select('42'));
    await expect(display.getByText('What would you say first?', { exact: true })).toBeVisible();
    await page.reload();
    await expect(display.getByText('Preview · Start participation in the OpenRoom pane', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { accounts.cleanup(); }
});

test('copies a saved content slide into the embedded picker and activates a question only in slideshow view', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const accounts = facilitatorAccounts(), errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await accounts.owner.signIn(context); await officeHostFixture(context);
    // Keep test clipboard writes inside this page, away from the user's desktop.
    await page.addInitScript(() => {
      let value = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (text: string) => { value = text; }, readText: async () => value,
      } });
    });
    const created = await page.request.post('/api/decks', { headers: CSRF, data: { content: {
      version: 1, meta: { title: 'Slides to embed' },
      steps: [{ id: 'welcome', kind: 'title', title: 'Original title' }, { id: 'question', kind: 'interaction', interactionId: 'choice' }],
      interactions: [{ id: 'choice', type: 'choice', prompt: 'What happens next?', options: [{ id: 'listen', label: 'Listen' }, { id: 'speak', label: 'Speak' }] }],
    } } });
    expect(created.status()).toBe(201);
    const { deck } = await created.json();
    await page.goto(`/host/#/decks/${deck.id}/edit`);
    const title = page.locator('.slide-canvas__frame [data-part="header"][contenteditable]');
    await title.fill('Ready for PowerPoint'); await title.press('Tab');
    await page.getByRole('button', { name: 'Copy embed code', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Embed this slide in PowerPoint' });
    await expect(dialog.getByRole('textbox', { name: 'Slide embed code' })).toHaveValue(`openroom-slide:1:${deck.id}:welcome`);
    await dialog.getByRole('button', { name: 'Copy embed code', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Embed code copied.');
    const code = await page.evaluate(() => navigator.clipboard.readText());
    expect((await (await page.request.get(`/api/decks/${deck.id}`)).json()).content.steps[0].title).toBe('Ready for PowerPoint');

    const display = await context.newPage(); display.on('pageerror', (error) => errors.push(error.message));
    await display.setViewportSize({ width: 960, height: 540 }); await display.goto('/office/content.html');
    const chooser = display.frameLocator('iframe[title="Choose an OpenRoom slide"]');
    const popup = display.waitForEvent('popup'); await chooser.getByRole('button', { name: 'Sign in to OpenRoom', exact: true }).click();
    await (await popup).getByRole('button', { name: 'Approve connection', exact: true }).click();
    const paste = chooser.getByRole('region', { name: 'Embed a slide by code' });
    await expect(paste.getByRole('button', { name: 'Embed slide', exact: true })).toBeDisabled();
    await paste.getByRole('textbox', { name: 'Slide embed code' }).fill(code);
    await paste.getByRole('button', { name: 'Embed slide', exact: true }).click();
    await expect(display.getByRole('heading', { name: 'Ready for PowerPoint', exact: true })).toBeVisible();
    const document = await display.evaluate(() => (window as any).__officeFile.read());
    const settings = await display.evaluate(() => (window as any).__officeFile.settings());
    expect(JSON.parse(settings['openroom.activity'])).toMatchObject({ deckId: deck.id, stepId: 'welcome', slideId: '42' });
    await display.screenshot({ path: testInfo.outputPath('powerpoint-embedded-content.png') });

    const pane = await context.newPage(); pane.on('pageerror', (error) => errors.push(error.message));
    await pane.addInitScript((document) => sessionStorage.setItem('test-office-file', JSON.stringify({ ...document, selected: ['42'] })), document);
    await pane.goto('/office/taskpane.html');
    const signIn = pane.waitForEvent('popup'); await pane.getByRole('button', { name: 'Sign in to OpenRoom', exact: true }).click();
    await (await signIn).getByRole('button', { name: 'Approve connection', exact: true }).click();
    await pane.evaluate(() => (window as any).__officeFile.select('88'));
    const pasteInPane = pane.getByRole('region', { name: 'Embed a slide by code' });
    await pasteInPane.getByRole('textbox', { name: 'Slide embed code' }).fill(`openroom-slide:1:${deck.id}:question`);
    await pasteInPane.getByRole('button', { name: 'Embed slide', exact: true }).click();
    await expect(pane.getByRole('button', { name: 'Selected for this slide', exact: true })).toBeDisabled();
    await pane.evaluate(() => (window as any).__officeFile.select('42'));
    const started = pane.waitForResponse((response) => new URL(response.url()).pathname === '/api/presentations/start');
    await pane.getByRole('button', { name: 'Start session', exact: true }).click();
    const response = await started; expect(response.status(), await response.text()).toBe(201);
    const live = await response.json();
    const state = async () => (await pane.request.get(`/api/sessions/${live.sessionCode}/state?role=host`, { headers: { authorization: `Bearer ${live.hostToken}` } })).json();
    expect((await state()).activeInteractionId).toBeNull();
    const liveDocument = await pane.evaluate(() => (window as any).__officeFile.read());
    const questionDisplay = await context.newPage(); questionDisplay.on('pageerror', (error) => errors.push(error.message));
    await questionDisplay.addInitScript((document) => sessionStorage.setItem('test-office-file', JSON.stringify({ ...document, slides: { ...document.slides, '88': {} }, selected: ['88'] })), liveDocument);
    await questionDisplay.goto('/office/content.html');
    await expect(questionDisplay.getByTitle('Choose an OpenRoom slide')).toBeVisible();
    // The native tag can arrive after the embedded shape was inserted.
    await questionDisplay.evaluate((document) => (window as any).__officeFile.replace(document), liveDocument);
    await pane.evaluate(() => (window as any).__officeFile.select('88'));
    // Ordinary editing and preview leave the live content slide untouched.
    await expect(questionDisplay.getByText('What happens next?', { exact: true })).toBeVisible();
    expect((await state()).activeInteractionId).toBeNull();
    await questionDisplay.evaluate(() => (window as any).__officeFile.view('read'));
    await expect.poll(async () => (await state()).activeInteractionId).toBe('activity-2-question-1');
    await expect.poll(async () => (await state()).interactionStatus).toBe('open');
    await expect(questionDisplay.getByRole('button', { name: 'Choose slide' })).toHaveCount(0);
    await pane.getByRole('button', { name: 'Close answers', exact: true }).click();
    await expect.poll(async () => (await state()).interactionStatus).toBe('closed');
    // Repeated visibility notifications must not reopen a question the host closed.
    await questionDisplay.evaluate(() => (window as any).__officeFile.view('read'));
    await expect(pane.getByRole('button', { name: 'Reopen answers', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  } finally { accounts.cleanup(); }
});
