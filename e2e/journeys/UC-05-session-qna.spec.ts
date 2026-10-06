/**
 * UC-05 — Session-wide audience Q&A: ask, upvote, moderate, spotlight
 * Session-level `qna.enabled` opens a session-long Q&A surface next to the
 * timed polls: participants ask/upvote from a Q&A tab, a co-host moderates
 * from the Q&A desk, and the host can put the list or a single spotlighted
 * question on the projector.
 */
import { test, expect } from '@playwright/test';
import {
  command,
  createSession,
  loadExampleSession,
  join,
  joinInBrowser,
  stageUrl,
  waitForWorker,
  type CreatedSession,
} from '../fixtures/session';

const QUESTION_TEXT = 'Will the slides be shared afterwards?';

test.beforeAll(async () => {
  await waitForWorker();
});

async function seedQnaSession(): Promise<CreatedSession> {
  const sessionDoc = loadExampleSession('seg-camp') as Record<string, unknown>;
  const session = await createSession({ ...sessionDoc, qna: { enabled: true } });
  await command(session.sessionCode, session.hostToken, { command: 'session.start' });
  return session;
}

function qnaDeskUrl(session: CreatedSession): string {
  const base = (process.env.OPENROOM_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
  return `${base}/host/#/sessions/${encodeURIComponent(session.sessionCode)}/qna?token=${encodeURIComponent(session.hostToken)}`;
}

test.describe('UC-05 session Q&A', () => {
  test('participant asks from the Q&A tab; a second participant sees it and upvotes', async ({
    browser,
    page,
  }) => {
    const session = await seedQnaSession();

    // Asker: join via ?code=, switch to the Q&A tab, send a question.
    await joinInBrowser(page, session.code);
    const qnaTab = page.getByRole('tab', { name: /Q&A/ });
    await expect(qnaTab).toBeVisible({ timeout: 20_000 });
    await qnaTab.click();
    await page.getByLabel('Ask a question').fill(QUESTION_TEXT);
    await page.getByRole('button', { name: 'Send question' }).click();
    await expect(page.locator('.qna__item--own')).toContainText(QUESTION_TEXT, {
      timeout: 20_000,
    });

    // Voter: separate participant sees the question and upvotes once.
    const voterContext = await browser.newContext({ reducedMotion: 'reduce' });
    const voter = await voterContext.newPage();
    try {
      await joinInBrowser(voter, session.code);
      const voterTab = voter.getByRole('tab', { name: /Q&A/ });
      await expect(voterTab).toBeVisible({ timeout: 20_000 });
      await voterTab.click();
      const upvote = voter.getByRole('button', { name: new RegExp(`^Upvote: ${QUESTION_TEXT}`) });
      await expect(upvote).toBeVisible({ timeout: 20_000 });
      await upvote.click();
      await expect(upvote).toContainText('1', { timeout: 20_000 });
      await expect(upvote).toBeDisabled();

      // The vote pushes back to the asker without a manual refresh.
      await expect(page.locator('.qna__vote').first()).toContainText('1', { timeout: 20_000 });
    } finally {
      await voterContext.close();
    }
  });

  test('moderator hides from the Q&A desk; spotlight puts one question on stage', async ({
    browser,
    page,
  }) => {
    const session = await seedQnaSession();

    // Seed two questions + a vote over the API (the ask UI is covered above).
    const asker = await join(session.code);
    await command(session.sessionCode, asker.participantToken, {
      command: 'qna.ask',
      questionId: 'q-share',
      text: QUESTION_TEXT,
    });
    await command(session.sessionCode, asker.participantToken, {
      command: 'qna.ask',
      questionId: 'q-noise',
      text: 'buy my mixtape',
    });
    const voterA = await join(session.code);
    await command(session.sessionCode, voterA.participantToken, {
      command: 'qna.upvote',
      questionId: 'q-share',
    });

    // Moderator surface: token-in-URL route, no localStorage seeding needed.
    await page.goto(qnaDeskUrl(session));
    await expect(page.getByRole('heading', { name: 'Audience Q&A desk' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(QUESTION_TEXT)).toBeVisible({ timeout: 20_000 });

    // Hide the junk question.
    await page.getByRole('button', { name: 'Hide question: buy my mixtape' }).click();
    await expect(page.getByRole('button', { name: 'Unhide question: buy my mixtape' })).toBeVisible(
      { timeout: 20_000 },
    );

    // Hidden questions disappear from participants.
    const participantContext = await browser.newContext({ reducedMotion: 'reduce' });
    const participant = await participantContext.newPage();
    const stageContext = await browser.newContext({ reducedMotion: 'reduce' });
    const stage = await stageContext.newPage();
    try {
      await joinInBrowser(participant, session.code);
      const tab = participant.getByRole('tab', { name: /Q&A/ });
      await expect(tab).toBeVisible({ timeout: 20_000 });
      await tab.click();
      await expect(participant.getByText(QUESTION_TEXT)).toBeVisible({ timeout: 20_000 });
      await expect(participant.getByText('buy my mixtape')).toHaveCount(0);

      // Spotlight the good question from the desk; the stage shows only it.
      await page
        .getByRole('button', { name: `Spotlight on stage: ${QUESTION_TEXT}` })
        .click();
      await stage.goto(stageUrl(session));
      await expect(stage.getByText('Audience Q&A')).toBeVisible({ timeout: 20_000 });
      await expect(stage.locator('.card__text', { hasText: QUESTION_TEXT })).toBeVisible({
        timeout: 20_000,
      });
      await expect(stage.locator('.card')).toHaveCount(1);
      await expect(stage.getByText('buy my mixtape')).toHaveCount(0);

      // Take Q&A off stage again from the desk header.
      await page.getByRole('button', { name: 'Take Q&A off stage' }).click();
      await expect(stage.locator('.card__text', { hasText: QUESTION_TEXT })).toHaveCount(0, {
        timeout: 20_000,
      });
    } finally {
      await participantContext.close();
      await stageContext.close();
    }
  });
});
