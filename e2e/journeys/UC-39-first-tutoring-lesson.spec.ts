import { expect, devices, type Page, type TestInfo } from '@playwright/test';
import { test } from '../fixtures/learner-browser';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
import { loadExampleSession, waitForWorker } from '../fixtures/session';
import type { Outline } from '@openroom/schema';

// Every teaching record and credential in this journey is created through the UI.
// The disposable runner enables local demo authentication; Google remains a separate check.
test.beforeAll(async () => { await waitForWorker(); });
test.use({ actionTimeout: 15_000, trace: 'retain-on-failure' });

async function audit(page: Page, testInfo: TestInfo, step: string) {
  await page.screenshot({ path: testInfo.outputPath(`${step}.png`), fullPage: true });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const evidence = testInfo.outputPath(`${step}-accessibility.json`);
  await writeFile(evidence, JSON.stringify(results, null, 2));
  await testInfo.attach(`${step}-accessibility`, { path: evidence, contentType: 'application/json' });
  expect.soft(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), step).toEqual([]);
}

test('first tutoring lesson: UI setup, live teaching, phone homework, feedback and next deck', async ({ page, learnerBrowser }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/host/');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await audit(page, testInfo, '01-sign-in');
  await page.getByLabel('Username', { exact: true }).fill('cara');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('demo');
  await password.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('link', { name: 'Choose experience', exact: true }).click();
  await page.getByRole('radio', { name: /^Tutoring / }).check();
  await page.getByRole('button', { name: 'Save experience', exact: true }).click();
  await page.getByRole('link', { name: 'Add student or group', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter a name.');
  await page.getByLabel('Name', { exact: true }).fill('Camille First Lesson');
  await page.getByRole('button', { name: 'B1', exact: true }).click();
  await page.getByLabel('Goal', { exact: true }).fill('Explain a travel problem in French.');
  await audit(page, testInfo, '02-student-setup');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Camille First Lesson', exact: true })).toBeVisible();
  await page.getByText('Student access links', { exact: true }).click();
  await page.getByRole('link', { name: 'Create link', exact: true }).click();
  await page.getByRole('button', { name: 'Create link', exact: true }).click();
  const learnerUrl = await page.locator('code').filter({ hasText: '#/learn?token=' }).innerText();
  await page.getByRole('link', { name: 'Done', exact: true }).click();
  await page.getByRole('link', { name: 'Sample lessons', exact: true }).click();
  await page.getByRole('group', { name: 'Lesson language' }).getByRole('button', { name: 'Français', exact: true }).click();
  await page.getByRole('group', { name: 'Lesson level' }).getByRole('button', { name: 'B1', exact: true }).click();
  await audit(page, testInfo, '03-sample-lesson');
  await page.getByRole('button', { name: 'Open Le train est parti', exact: true }).click();
  const editorSlides = page.getByRole('list', { name: 'Slides', exact: true }).getByRole('button');
  await expect(editorSlides).toHaveCount(12);
  for (let index = 0; index < 12; index++) {
    await editorSlides.nth(index).click();
    await expect(editorSlides.nth(index)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-slide-overflow]'), `Editor slide ${index + 1}`).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
  await expect(presenter).toBeVisible();
  await presenter.getByRole('button', { name: 'Session menu', exact: true }).click();
  const joinUrl = await page.getByRole('menuitem', { name: 'Join page', exact: true }).getAttribute('href');
  expect(joinUrl).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(presenter).toBeVisible();
  await expect(presenter.getByRole('button', { name: 'Session menu', exact: true })).toBeFocused();
  const phone = await learnerBrowser.newContext({ ...devices['iPhone 13'], locale: 'en-GB', reducedMotion: 'reduce' });
  const participant = await phone.newPage();
  await participant.goto(joinUrl!);
  await participant.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(participant.getByRole('heading', { name: 'Le train est parti', exact: true })).toBeVisible();
  const participantName = await participant.getByTitle('Your session name', { exact: true }).innerText();
  const companion = await learnerBrowser.newPage({ viewport: { width: 1024, height: 768 }, locale: 'en-GB', reducedMotion: 'reduce' });
  await companion.goto(joinUrl!);
  await companion.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(companion.getByTitle('Your session name', { exact: true })).not.toHaveText(participantName);
  await expect(presenter.locator('header')).toContainText('2 joined');
  await audit(participant, testInfo, '04-phone-live-lesson');
  const liveSlides = presenter.getByRole('tablist', { name: 'Slides', exact: true }).getByRole('tab');
  await liveSlides.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(liveSlides.nth(1)).toBeFocused();
  await expect(liveSlides.nth(1)).toHaveAttribute('aria-selected', 'true');
  for (let index = 0; index < 12; index++) {
    await liveSlides.nth(index).click();
    await expect(liveSlides.nth(index)).toHaveAttribute('aria-selected', 'true');
    if (index === 3) {
      await participant.getByRole('button', { name: 'Reading', exact: true }).click();
      await expect(participant.getByText(/Il pleuvait et le bus avançait lentement/)).toBeVisible();
      await audit(participant, testInfo, '05-phone-reading');
    }
    if (index === 4) {
      const answer = participant.getByRole('radio', { name: 'Arriver avant 18 h.', exact: true });
      await answer.focus();
      await participant.keyboard.press('Space');
      await expect(participant.getByText('Answer received', { exact: true })).toBeVisible();
      await companion.getByRole('radio', { name: 'Éviter toute correspondance.', exact: true }).click();
      await expect(companion.getByText('Answer received', { exact: true })).toBeVisible();
      await participant.reload();
      await expect(participant.getByTitle('Your session name', { exact: true })).toHaveText(participantName);
      await expect(participant.getByText('Answered: Arriver avant 18 h.', { exact: true })).toBeVisible();
      await expect(companion.getByText('Answered: Éviter toute correspondance.', { exact: true })).toBeVisible();
      await expect(presenter.locator('header')).toContainText('2 joined · 2 answered');
      await presenter.getByRole('button', { name: 'Reveal the results', exact: true }).click();
      const labels = presenter.locator('.stage-mirror .barrow__label');
      await expect(labels).toHaveCount(3);
      const boxes = await labels.evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom };
      }));
      for (let row = 1; row < boxes.length; row++) expect(boxes[row]!.top, 'Result labels must not overlap').toBeGreaterThanOrEqual(boxes[row - 1]!.bottom - 1);
      await audit(page, testInfo, '06-tutor-results');
      await audit(participant, testInfo, '07-phone-results');
    }
    if (index === 5) {
      await phone.setOffline(true);
      await participant.reload({ timeout: 5000 }).catch(() => {});
    }
    if (index === 6) {
      await phone.setOffline(false);
      await participant.goto(joinUrl!);
      await expect(participant.getByTitle('Your session name', { exact: true })).toHaveText(participantName);
      await expect(presenter.locator('header')).toContainText('2 joined');
      await participant.getByRole('textbox', { name: 'Gap weather', exact: true }).fill('pleuvait');
      await participant.getByRole('textbox', { name: 'Gap aux', exact: true }).fill('a');
      await participant.getByRole('button', { name: 'Send answer', exact: true }).click();
      await expect(participant.getByText('Answer received', { exact: true })).toBeVisible();
      await presenter.getByRole('button', { name: 'Reveal the results', exact: true }).click();
      await expect(participant.getByRole('region', { name: 'Results', exact: true })).toBeVisible();
      await audit(participant, testInfo, '08-phone-gap-feedback');
    }
  }
  await presenter.getByRole('textbox', { name: 'Private notes', exact: true }).fill('PRIVATE TUTOR NOTE: revisit the past tense.');
  await presenter.locator('header').getByRole('button', { name: 'End session', exact: true }).click();
  await page.getByRole('dialog', { name: 'End this session?', exact: true }).getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.getByLabel('Tutor notes', { exact: true })).toHaveValue('PRIVATE TUTOR NOTE: revisit the past tense.');
  await page.getByLabel('Outcomes (one per line)', { exact: true }).fill('You explained the delay and found another route.');
  await page.getByLabel('Next step', { exact: true }).fill('PRIVATE NEXT STEP');
  await audit(page, testInfo, '09-session-notes');
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Review learner work', exact: true })).toBeVisible();
  const learner = await phone.newPage();
  await learner.goto(learnerUrl);
  await expect(learner.getByRole('heading', { name: 'Camille First Lesson', exact: true })).toBeVisible();
  await expect(learner.getByText('You explained the delay and found another route.', { exact: true })).toBeVisible();
  await expect(learner.getByText(/PRIVATE TUTOR NOTE|PRIVATE NEXT STEP/)).toHaveCount(0);
  for (const width of [320, 390, 768]) {
    await learner.setViewportSize({ width, height: 844 });
    await expect(learner.locator('body')).toHaveJSProperty('scrollWidth', width);
    await audit(learner, testInfo, `10-homework-${width}`);
  }
  await learner.setViewportSize({ width: 390, height: 844 });
  const writing = learner.getByRole('textbox', { name: 'Racontez un trajet qui ne s’est pas passé comme prévu (100 à 130 mots).', exact: true });
  await writing.fill('Il pleuvait. Je suis allé à la gare, mais le train était déjà parti.');
  await learner.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(learner.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await learner.getByRole('tab', { name: 'Practice', exact: true }).focus();
  await learner.keyboard.press('Enter');
  await learner.getByRole('textbox', { name: 'Gap 1', exact: true }).fill('pleuvait');
  await learner.getByRole('textbox', { name: 'Gap 2', exact: true }).fill('a');
  await learner.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(learner.getByText('Correct.', { exact: true })).toBeVisible();
  await learner.getByRole('button', { name: 'Good', exact: true }).click();
  await audit(learner, testInfo, '11-practice');
  await page.getByRole('link', { name: 'Review learner work', exact: true }).click();
  await page.getByRole('link', { name: /Camille First Lesson.*Review response/s }).click();
  await page.getByLabel('Feedback', { exact: true }).fill('Votre récit est clair. Attention à l’accord.');
  await page.getByRole('button', { name: 'Add correction', exact: true }).click();
  await page.getByLabel('Their words', { exact: true }).fill('allé');
  await page.getByLabel('Suggested wording', { exact: true }).fill('allée');
  await page.getByLabel('Why', { exact: true }).fill('Avec être, le participe passé s’accorde avec le sujet.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  await learner.getByRole('tab', { name: 'Feedback', exact: true }).click();
  await expect(learner.getByText('Your tutor’s feedback will appear here.')).toBeVisible();
  await audit(page, testInfo, '12-feedback-draft');
  await page.getByRole('button', { name: 'Share feedback', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Feedback shared with Camille First Lesson.' })).toBeVisible();
  await learner.reload();
  await learner.getByRole('tab', { name: 'Feedback', exact: true }).click();
  await expect(learner.getByText('Votre récit est clair. Attention à l’accord.', { exact: true })).toBeVisible();
  await audit(learner, testInfo, '13-phone-feedback');
  await page.getByRole('link', { name: 'Back to learner work', exact: true }).click();
  await page.getByRole('link', { name: 'Back to Library', exact: true }).click();
  await page.getByRole('link', { name: 'New deck', exact: true }).last().click();
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByText('Camille First Lesson · allé', { exact: true }).click();
  await page.getByRole('button', { name: 'Add correction to deck', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Slides' }).getByRole('button')).toHaveCount(2);
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Review learner work', exact: true })).toBeVisible();
  await phone.close();
  await companion.close();
});

test('all eight language samples fit the editor and revealed live results', async ({ page, learnerBrowser }, testInfo) => {
  test.setTimeout(240_000);
  await page.goto('/host/');
  await page.getByLabel('Username', { exact: true }).fill('bob');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Switch space', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New space', exact: true }).click();
  await page.getByRole('textbox', { name: 'Space name', exact: true }).fill('Language sample rehearsal');
  await page.getByRole('radio', { name: /^Tutoring / }).check();
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await page.getByRole('link', { name: 'Add student or group', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Sample lesson rehearsal');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('link', { name: 'Sample lessons', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(8);
  const titles = await page.getByRole('article').getByRole('heading', { level: 2 }).allTextContents();
  expect(titles).toHaveLength(8);
  const outlines = ['french', 'german'].flatMap((language) => ['a1', 'a2', 'b1', 'b2'].map((level) => loadExampleSession(`tutoring/${language}-${level}`) as Outline));
  for (const [sample, title] of titles.entries()) {
    const outline = outlines.find((outline) => outline.meta.title === title)!;
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click();
    const slides = page.getByRole('list', { name: 'Slides', exact: true }).getByRole('button');
    await expect(slides.first()).toBeVisible();
    const count = await slides.count();
    expect(count).toBeGreaterThanOrEqual(11);
    for (let index = 0; index < count; index++) {
      await slides.nth(index).click();
      await expect(slides.nth(index)).toHaveAttribute('aria-current', 'true');
      await expect.soft(page.locator('[data-slide-overflow]'), `${title}, slide ${index + 1}`).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
    await presenter.getByRole('button', { name: 'Session menu', exact: true }).click();
    const joinUrl = await page.getByRole('menuitem', { name: 'Join page', exact: true }).getAttribute('href');
    await page.keyboard.press('Escape');
    const participant = await learnerBrowser.newPage({ ...devices['iPhone 13'], locale: 'en-GB', reducedMotion: 'reduce' });
    await participant.goto(joinUrl!);
    await participant.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(participant.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const liveSlides = presenter.getByRole('tablist', { name: 'Slides', exact: true }).getByRole('tab');
    await expect(liveSlides).toHaveCount(count);
    for (let index = 0; index < count; index++) {
      await liveSlides.nth(index).click();
      await expect(liveSlides.nth(index)).toHaveAttribute('aria-selected', 'true');
      const step = outline.steps[index]!;
      if (step.kind === 'interaction') {
        const question = outline.interactions.find((question) => question.id === step.interactionId)!;
        if (question.type === 'choice') {
          const option = question.options.find((option) => option.correct) ?? question.options[0]!;
          await participant.getByRole('radio', { name: option.label, exact: true }).click();
        } else if (question.type === 'fill-the-gaps') {
          for (const gap of question.gaps) await participant.getByRole('textbox', { name: `Gap ${gap.id}`, exact: true }).fill(gap.answers[0]!);
          await participant.getByRole('button', { name: 'Send answer', exact: true }).click();
        } else if (question.type === 'ranking') {
          await expect(participant.getByRole('heading', { name: question.prompt, exact: true })).toBeVisible();
          await participant.getByRole('button', { name: 'Send ranking', exact: true }).click();
        } else throw new Error(`Add a visible answer path for ${question.type}`);
        await expect(participant.getByText('Answer received', { exact: true })).toBeVisible();
        await presenter.getByRole('button', { name: 'Reveal the results', exact: true }).click();
        await expect(presenter.locator('.stage-mirror .or-chart-viz')).toBeVisible();
        const labels = presenter.locator('.stage-mirror .or-bars-chart .barrow__label');
        if (question.type === 'choice') await expect(labels).toHaveCount(question.options.length);
        const boxes = await labels.evaluateAll((elements) => elements.map((element) => {
          const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom };
        }));
        for (let row = 1; row < boxes.length; row++) expect.soft(boxes[row]!.top, `${title}: result labels must not overlap`).toBeGreaterThanOrEqual(boxes[row - 1]!.bottom - 1);
        await page.screenshot({ path: testInfo.outputPath(`sample-${sample + 1}-question-${index + 1}.png`) });
        await expect(participant.getByRole('region', { name: 'Results', exact: true })).toBeVisible();
        await expect(participant.locator('body')).toHaveJSProperty('scrollWidth', 390);
        if (question.type === 'choice') {
          for (const width of [320, 390]) {
            await participant.setViewportSize({ width, height: 844 });
            const learnerLabels = participant.locator('.results .or-bars-chart .barrow__label');
            await expect(learnerLabels).toHaveCount(question.options.length);
            const bounds = await learnerLabels.evaluateAll((elements) => elements.map((element) => {
              const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom };
            }));
            for (let row = 1; row < bounds.length; row++) expect.soft(bounds[row]!.top, `${title}: learner results at ${width}px must not overlap`).toBeGreaterThanOrEqual(bounds[row - 1]!.bottom - 1);
            await expect(participant.locator('body')).toHaveJSProperty('scrollWidth', width);
          }
          await participant.screenshot({ path: testInfo.outputPath(`sample-${sample + 1}-question-${index + 1}-learner.png`), fullPage: true });
        }
      }
    }
    await presenter.locator('header').getByRole('button', { name: 'End session', exact: true }).click();
    await page.getByRole('dialog', { name: 'End this session?', exact: true }).getByRole('button', { name: 'End session', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Reading assignment', exact: true }).getByLabel('Reading', { exact: true })).not.toBeEmpty();
    await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Review learner work', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Sample lessons', exact: true }).click();
    await participant.close();
  }
});
