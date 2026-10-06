import { test, expect, type Page, type Route } from '@playwright/test';
import { joinInBrowser, stageUrl, waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
const entry = (word: string) => ({
  word, lemma: word === 'rate' ? 'rater' : word, lang: 'fr', pos: word === 'rate' ? 'verb' : 'noun',
  headword: word === 'rate' ? 'rater' : word, labels: [], senses: [{ gloss: word === 'rate' ? 'to miss' : 'train' }],
  sections: word === 'rate' ? [
    { key: 'present', label: 'Indicative present', columnLabels: ['singular', 'plural'], rows: [{ label: '1st person', cells: ['rate', 'ratons'] }] },
    { key: 'past', label: 'Past participle', columnLabels: [], rows: [{ label: 'participle', cells: ['raté'] }] },
  ] : [],
  source: { name: 'Wiktionary', url: 'https://fr.wiktionary.org/wiki/rater' },
});
test.beforeAll(async () => { await waitForWorker(); });

async function expectWordCircle(surface: Page) {
  const word = surface.locator('[data-part="header"] [data-token="1"]');
  const circle = surface.locator('.ink-overlay ellipse, .learner-ink ellipse');
  await expect(circle).toHaveCount(1);
  await expect.poll(async () => {
    const [text, mark] = await Promise.all([word.boundingBox(), circle.boundingBox()]);
    if (!text || !mark) return Infinity;
    return Math.hypot(text.x + text.width / 2 - mark.x - mark.width / 2, text.y + text.height / 2 - mark.y - mark.height / 2);
  }, { message: 'The circle stays centred on the selected word after layout changes.' }).toBeLessThan(2);
}

test('lookup drafts stay private; selected forms publish atomically and stale lookups cannot replace a word', async ({ page, browser }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'bob', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  const { context } = await (await page.request.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: 'Camille', kind: 'person', experience: 'tutoring' } })).json();
  const { deck } = await (await page.request.post('/api/decks', { headers: CSRF, data: { contextId: context.id, spaceId: context.spaceId,
    content: { version: 1, meta: { title: 'Les verbes du voyage' }, defaults: { identityMode: 'pseudonymous' }, steps: [{ id: 'one', kind: 'title', title: 'Je rate le train' }, { id: 'two', kind: 'title', title: 'La suite' }], interactions: [] },
  } })).json();
  let releaseLate!: () => void;
  const late = new Promise<void>((resolve) => { releaseLate = resolve; });
  let firstRate = true;
  await page.route('**/api/tutoring/dictionary', async (route) => {
    const word = route.request().postDataJSON().word as string;
    if (word === 'rate' && firstRate) { firstRate = false; await late; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entry: entry(word), meaning: word === 'rate' ? 'to miss' : 'train' }) }).catch(() => {});
  });
  await page.goto(`/host/#/decks/${deck.id}/edit`);
  const launched = page.waitForResponse((response) => /\/sessions\/[^/]+\/launch$/.test(response.url()) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  const launchResponse = await launched;
  expect(launchResponse.status(), await launchResponse.text()).toBe(201);
  const session = await launchResponse.json();
  const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
  await expect(presenter.locator('.stage-mirror [data-token="1"]')).toHaveText('rate');
  const stage = await browser.newPage();
  await stage.goto(stageUrl(session));
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await joinInBrowser(phone, session.code);
  await expect(phone.getByText('Je rate le train', { exact: true })).toBeVisible();
  const lookup = async (token: number, picking = false) => {
    const word = presenter.locator(`.stage-mirror [data-part="header"] [data-token="${token}"]`);
    const ink = presenter.locator('.stage-mirror .ink-overlay');
    const wordBox = await word.boundingBox();
    const inkBox = await ink.boundingBox();
    if (!wordBox || !inkBox) throw new Error('The word must be visible on the slide.');
    // Ink owns the pointer and locates the underlying word, just as a tutor's click does.
    await ink.click({ button: picking ? 'left' : 'right', position: { x: wordBox.x + wordBox.width / 2 - inkBox.x, y: wordBox.y + wordBox.height / 2 - inkBox.y } });
    if (!picking) await page.getByRole('menuitem', { name: 'Look up', exact: true }).click();
  };
  await lookup(1);
  const rate = page.getByRole('dialog', { name: 'Meaning: rate', exact: true });
  await expect(rate.getByText('looking it up…', { exact: true })).toBeVisible();
  await rate.getByRole('button', { name: 'Close', exact: true }).click();
  await lookup(3);
  const train = page.getByRole('dialog', { name: 'Meaning: train', exact: true });
  await expect(train.getByRole('button', { name: /On .*screen/ })).toBeEnabled();
  releaseLate();
  await expect(train).toBeVisible();
  await expect(stage.locator('.meaning-card')).toHaveCount(0);
  await expect(phone.locator('.meaning-card')).toHaveCount(0);
  await train.getByRole('button', { name: /On .*screen/ }).click();
  for (const surface of [stage, phone]) await expect(surface.locator('.meaning-card')).toContainText('train');
  await train.getByRole('button', { name: 'Close', exact: true }).click();

  await presenter.getByRole('tab', { name: 'Review', exact: true }).click();
  await presenter.getByRole('button', { name: 'Look up a word', exact: true }).click();
  await expect(presenter.locator('.stage-mirror .meaning-card')).toHaveCount(0);
  for (const surface of [stage, phone]) await expect(surface.locator('.meaning-card')).toContainText('train');
  await presenter.getByRole('button', { name: 'Picking word…', exact: true }).click();
  await expect(presenter.locator('.stage-mirror .meaning-card')).toContainText('train');
  await presenter.getByRole('button', { name: 'Look up a word', exact: true }).click();
  await lookup(1, true);
  await rate.getByRole('tab', { name: /^Forms/ }).click();
  await expect(rate.getByRole('checkbox', { name: 'Show Indicative present', exact: true })).not.toBeChecked();
  await rate.getByRole('checkbox', { name: 'Show Indicative present', exact: true }).check();
  const denyOnce = async (route: Route) => {
    if (route.request().postDataJSON().command?.command !== 'meaning.publish') { await route.fallback(); return; }
    await page.unroute('**/commands', denyOnce);
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'E_TEMPORARY', message: 'Temporary failure' } }) });
  };
  await page.route('**/commands', denyOnce);
  await rate.getByRole('button', { name: /On .*screen/ }).click();
  await expect(rate.getByRole('alert')).toContainText('Your draft is still here');
  await expect(stage.locator('.meaning-card')).toContainText('train');
  await expect(stage.locator('.meaning-card')).not.toContainText('ratons');
  await rate.getByRole('button', { name: /On .*screen/ }).click();
  for (const surface of [stage, phone]) {
    await expect(surface.locator('.meaning-card')).toContainText('to miss');
    await expect(surface.locator('.meaning-card')).toContainText('ratons');
    await expect(surface.locator('.meaning-card')).not.toContainText('Past participle');
  }
  await page.screenshot({ path: testInfo.outputPath('selected-forms-host.png') });
  await phone.screenshot({ path: testInfo.outputPath('selected-forms-phone.png'), fullPage: true });
  // Editing remains private until an explicit update, which replaces the forms too.
  await rate.getByRole('button', { name: 'Type a meaning instead', exact: true }).click();
  await rate.getByRole('textbox', { name: 'Meaning', exact: true }).fill('ne pas réussir à prendre le train');
  await expect(stage.locator('.meaning-card')).toContainText('ratons');
  await rate.getByRole('button', { name: /Update .*screen/ }).click();
  for (const surface of [stage, phone]) {
    await expect(surface.locator('.meaning-card')).toContainText('ne pas réussir');
    await expect(surface.locator('.meaning-card')).not.toContainText('ratons');
  }
  await rate.getByRole('button', { name: /Take off .*screen/ }).click();
  for (const surface of [stage, phone]) await expect(surface.locator('.meaning-card')).toHaveCount(0);
  await expectWordCircle(stage);
  await expectWordCircle(phone);
  await phone.getByRole('button', { name: 'Slide', exact: true }).click();
  await expectWordCircle(phone);
  await phone.setViewportSize({ width: 320, height: 700 });
  await expectWordCircle(phone);
  await phone.getByRole('button', { name: 'Reading', exact: true }).click();
  await expectWordCircle(phone);
  await rate.getByRole('button', { name: /On .*screen/ }).click();
  await expect(stage.locator('.meaning-card')).toContainText('ne pas réussir');
  await rate.getByRole('button', { name: 'Close', exact: true }).click();
  await presenter.locator('.stage-mirror').click();
  await page.keyboard.press('ArrowRight');
  await expect(stage.getByText('La suite', { exact: true })).toBeVisible();
  for (const surface of [stage, phone]) await expect(surface.locator('.meaning-card')).toHaveCount(0);
  await stage.close(); await phone.close();
});
