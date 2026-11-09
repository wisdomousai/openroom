import { expect, test, type Page } from '@playwright/test';
import { hostAccounts } from '../fixtures/hosts';
import { officeHostFixture } from '../fixtures/office';
import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
type OfficeFile = { presentationTags: Record<string, string>; slides: Record<string, Record<string, string>> };
const file = (page: Page) => page.evaluate(() => (window as unknown as { __officeFile: { read(): OfficeFile } }).__officeFile.read());
const select = (page: Page, id: string) => page.evaluate((id) => (window as unknown as { __officeFile: { select(id: string): void } }).__officeFile.select(id), id);

test.beforeAll(async () => { await waitForWorker(); });
test('creates and edits questions in the pane and in the slide, then starts a session with them', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const accounts = hostAccounts(), errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await accounts.owner.signIn(context); await officeHostFixture(context);
    const space = await (await page.request.post('/api/my/spaces', { headers: CSRF, data: { name: 'Quarterly review', experience: 'training' } })).json();
    await page.setViewportSize({ width: 340, height: 820 });
    await page.goto('/office/taskpane.html');
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Sign in to OpenRoom', exact: true }).click();
    await (await popup).getByRole('button', { name: 'Approve connection', exact: true }).click();

    // A new presentation: the first question creates its deck in the chosen space.
    const question = page.getByRole('region', { name: 'Question on the selected slide' });
    await expect(question.getByRole('heading', { name: 'Add a question', exact: true })).toBeVisible();
    await expect(question.getByRole('combobox', { name: 'Save questions in' })).toHaveValue(space.id);
    await question.getByRole('textbox', { name: 'Question' }).fill('Which topic should we cover first?');
    await question.getByRole('textbox', { name: 'Option 1' }).fill('Pricing');
    await question.getByRole('textbox', { name: 'Option 2' }).fill('Onboarding');
    await page.screenshot({ path: testInfo.outputPath('powerpoint-add-question.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await question.getByRole('button', { name: 'Add to selected slide', exact: true }).click();
    await expect(page.locator('.notice[role="status"]')).toContainText('Question added to this slide.');
    await expect(question.getByRole('heading', { name: 'Edit question', exact: true })).toBeVisible();
    const first = await file(page);
    const reference = JSON.parse(first.presentationTags.OPENROOM_DECK!);
    expect(reference).toEqual({ version: 1, presentationId: first.presentationTags.OPENROOM_PRESENTATION, spaceId: space.id, deckId: expect.any(String) });
    const binding = JSON.parse(first.slides['42']!.OPENROOM_ACTIVITY!);
    expect(binding).toMatchObject({ slideId: '42', spaceId: space.id, deckId: reference.deckId, presentationId: reference.presentationId });
    const saved = async () => (await (await page.request.get(`/api/decks/${reference.deckId}`)).json());
    let deck = await saved();
    expect(deck.deck).toMatchObject({ title: 'PowerPoint questions', spaceId: space.id });
    const choice = deck.content.interactions[0];
    expect(choice).toMatchObject({ type: 'choice', prompt: 'Which topic should we cover first?', options: [{ label: 'Pricing' }, { label: 'Onboarding' }] });
    expect(choice.options).toHaveLength(2);

    // Later questions go to the same deck. The form reports what is missing.
    await select(page, '99');
    await expect(question.getByRole('heading', { name: 'Add a question', exact: true })).toBeVisible();
    await expect(question.getByRole('combobox', { name: 'Save questions in' })).toHaveCount(0);
    await question.getByText('Word cloud', { exact: true }).click();
    await expect(question.getByRole('radio', { name: 'Word cloud', exact: true })).toBeChecked();
    await question.getByRole('button', { name: 'Add to selected slide', exact: true }).click();
    await expect(question.getByRole('alert')).toHaveText('Write the question.');
    await question.getByRole('textbox', { name: 'Question' }).fill('One word for today');
    await question.getByRole('button', { name: 'Add to selected slide', exact: true }).click();
    await expect(question.getByRole('heading', { name: 'Edit question', exact: true })).toBeVisible();
    deck = await saved();
    expect(deck.content.steps).toHaveLength(2);
    expect(deck.content.interactions[1]).toMatchObject({ type: 'text', display: 'word-cloud', prompt: 'One word for today' });
    expect(JSON.parse((await file(page)).slides['99']!.OPENROOM_ACTIVITY!).deckId).toBe(reference.deckId);

    // Editing keeps the question and answer IDs that sessions and bindings use.
    await select(page, '42');
    await expect(question.getByRole('textbox', { name: 'Question' })).toHaveValue('Which topic should we cover first?');
    await question.getByRole('textbox', { name: 'Question' }).fill('Which topic first?');
    await question.getByRole('button', { name: 'Add option', exact: true }).click();
    await question.getByRole('textbox', { name: 'Option 3' }).fill('Pricing');
    await question.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(question.getByRole('alert')).toHaveText('Give each option a different text.');
    await question.getByRole('textbox', { name: 'Option 3' }).fill('Support');
    // Unsaved work in the deck editor is never replaced by a save from the pane.
    const draftUrl = `/api/decks/${reference.deckId}/draft`;
    expect((await page.request.put(draftUrl, { headers: CSRF, data: { source: 'version: 1', baseVersion: deck.contentVersion } })).status()).toBe(200);
    await question.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('.notice.error')).toHaveText('This deck has unsaved changes in the OpenRoom editor. Save them there first.');
    expect((await saved()).content.interactions[0].prompt).toBe('Which topic should we cover first?');
    expect((await page.request.delete(draftUrl, { headers: CSRF })).status()).toBe(204);
    await question.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('.notice[role="status"]')).toHaveText('Question saved.');
    deck = await saved();
    const edited = deck.content.interactions[0];
    expect(edited).toMatchObject({ id: choice.id, prompt: 'Which topic first?', options: [{ id: choice.options[0].id, label: 'Pricing' }, { id: choice.options[1].id, label: 'Onboarding' }, { label: 'Support' }] });
    await page.screenshot({ path: testInfo.outputPath('powerpoint-edit-question.png'), fullPage: true });

    // Both created questions start with the presentation.
    const started = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/presentations/start');
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    const reply = await started; expect(reply.status(), await reply.text()).toBe(201);
    const live = await reply.json();
    const resumed = await (await page.request.post(`/api/sessions/${live.sessionId}/resume`, { headers: CSRF, data: {} })).json();
    expect(resumed.presentation.activities.map((item: { slideId: string; deckId: string }) => [item.slideId, item.deckId])).toEqual([['42', reference.deckId], ['99', reference.deckId]]);

    // In the slide: an empty OpenRoom Slide opens the same form and shows the question once added.
    const document = await file(page);
    const display = await context.newPage(); display.on('pageerror', (error) => errors.push(error.message));
    await display.addInitScript((document) => sessionStorage.setItem('test-office-file', JSON.stringify({ ...document, slides: { ...document.slides, '120': {} }, order: [...Object.keys(document.slides), '120'], selected: ['120'] })), document);
    await display.setViewportSize({ width: 960, height: 540 }); await display.goto('/office/content.html');
    const chooser = display.frameLocator('iframe[title="Add or edit the OpenRoom question"]');
    await expect(chooser.getByRole('heading', { name: 'Add a question', exact: true })).toBeVisible();
    await expect(chooser.getByRole('button', { name: 'Sign in to OpenRoom', exact: true })).toHaveCount(0);
    await chooser.getByText('Scale', { exact: true }).click();
    await expect(chooser.getByRole('radio', { name: 'Scale', exact: true })).toBeChecked();
    await chooser.getByRole('textbox', { name: 'Question' }).fill('How confident do you feel?');
    await display.screenshot({ path: testInfo.outputPath('powerpoint-slide-form.png') });
    await chooser.getByRole('button', { name: 'Add to this slide', exact: true }).click();
    await expect(display.getByText('How confident do you feel?', { exact: true })).toBeVisible();
    const settings = await display.evaluate(() => (window as unknown as { __officeFile: { settings(): Record<string, string> } }).__officeFile.settings());
    expect(JSON.parse(settings['openroom.activity']!)).toMatchObject({ deckId: reference.deckId, slideId: '120' });
    deck = await saved();
    expect(deck.content.interactions[2]).toMatchObject({ type: 'scale', min: 1, max: 5, prompt: 'How confident do you feel?' });
    await display.screenshot({ path: testInfo.outputPath('powerpoint-slide-question.png') });
    expect(errors).toEqual([]);
  } finally { accounts.cleanup(); }
});
