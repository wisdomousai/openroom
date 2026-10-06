/**
 * UC-01 — Hidden-until-close choice → reveal
 * Contract: docs/journeys/UC-01-choice-reveal.md
 */
import { test, expect, type Page } from '@playwright/test';
import {
  command,
  createSession,
  loadExampleSession,
  hostUrl,
  join,
  joinInBrowser,
  stageUrl,
  waitForWorker,
  type CreatedSession,
} from '../fixtures/session';

const INTERACTION = 'myth-great-idea';
const LABEL_TRUE = 'True — the idea is the hard part';
const LABEL_FALSE = 'False — finding a customer who pays is the hard part';

test.beforeAll(async () => {
  await waitForWorker();
});

async function seedChoiceReveal(): Promise<CreatedSession> {
  const sessionDoc = loadExampleSession('seg-camp');
  const session = await createSession(sessionDoc);
  await command(session.sessionCode, session.hostToken, { command: 'session.start' });
  await command(session.sessionCode, session.hostToken, {
    command: 'interaction.open',
    interactionId: INTERACTION,
  });

  const votes = ['true-hardest', 'true-hardest', 'false-execution', 'false-execution'] as const;
  for (const optionId of votes) {
    const p = await join(session.code);
    await command(session.sessionCode, p.participantToken, {
      command: 'answer.submit',
      interactionId: INTERACTION,
      answer: { kind: 'choice', optionIds: [optionId] },
    });
  }
  return session;
}

async function closeAndReveal(session: CreatedSession): Promise<void> {
  await command(session.sessionCode, session.hostToken, {
    command: 'interaction.close',
    interactionId: INTERACTION,
  });
  await command(session.sessionCode, session.hostToken, {
    command: 'interaction.reveal',
    interactionId: INTERACTION,
  });
}

test.describe('UC-01 choice reveal', () => {
  test('stage hides results until reveal, then shows bars + correct mark', async ({
    page,
  }) => {
    const session = await seedChoiceReveal();
    await page.goto(stageUrl(session));

    // Pre-reveal: pending counter, no option result bars.
    // Aria summary is sr-only (not painted on stage) — still queryable.
    const summary = page.locator('figcaption[role="status"]');
    await expect(summary).toContainText(/hidden/i);
    await expect(summary).toContainText(/4 answers/i);
    await expect(page.locator('[data-or-chart="bars"]')).toHaveCount(0);
    await expect(page.locator('.barrow')).toHaveCount(0);
    await expect(page.locator('.barrow__label', { hasText: LABEL_TRUE })).toHaveCount(0);

    await closeAndReveal(session);

    // Post-reveal: shadcn/Recharts bars + HTML option legend (correct tag).
    await expect(page.locator('[data-or-chart="bars"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.barrow')).toHaveCount(2);
    await expect(page.locator('.barrow__label', { hasText: LABEL_TRUE })).toBeVisible();
    await expect(page.locator('.barrow__label', { hasText: LABEL_FALSE })).toBeVisible();

    await expect(summary).toContainText(/4 answers/i);
    await expect(summary).toContainText(/50%/);
    await expect(summary).toContainText(/correct/i);

    await expect(page.locator('.tag-correct')).toHaveCount(1);
    await expect(page.locator('.barrow--correct')).toHaveCount(1);
    await expect(page.locator('[data-or-correct]')).toHaveCount(1);
    await expect(page.locator('.barrow--correct')).toContainText(LABEL_FALSE);
  });

  test('participant has no results pre-reveal; bars + correct after', async ({ page }) => {
    const session = await seedChoiceReveal();
    await joinInBrowser(page, session.code);

    // Join is an explicit click; ?code= only prefills the form.
    await expect(page.getByText(/myth|hardest part|great idea/i).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('region', { name: 'Results' })).toHaveCount(0);

    await closeAndReveal(session);

    const results = page.getByRole('region', { name: 'Results' });
    await expect(results).toBeVisible({ timeout: 20_000 });
    await expect(results).toContainText(LABEL_TRUE);
    await expect(results).toContainText(LABEL_FALSE);
    // Correct multi-signal: shared chart correct marker.
    await expect(results.locator('[data-or-correct], .barrow--correct')).toHaveCount(1);
    await expect(results.locator('[data-or-correct], .barrow--correct')).toContainText(LABEL_FALSE);
  });

  test('host always sees live labels and counts; correct after reveal', async ({
    page,
  }) => {
    const session = await seedChoiceReveal();
    await openHostConsole(page, session);

    // Live counts live in the header. The desk is a stage-mirror: hidden until reveal.
    await expect(page.locator('header')).toContainText('answered', { timeout: 20_000 });
    await expect(page.locator('header')).toContainText('4');

    const desk = page.locator('.stage-mirror');
    await expect(desk).toBeVisible({ timeout: 20_000 });
    await expect(desk).toContainText(/hidden/i);
    await expect(desk.locator('[data-or-chart="bars"]')).toHaveCount(0);

    await closeAndReveal(session);

    await expect(desk.locator('[data-or-chart="bars"]')).toBeVisible({ timeout: 20_000 });
    await expect(desk.locator('.barrow__label', { hasText: LABEL_TRUE })).toBeVisible();
    await expect(desk.locator('.barrow__label', { hasText: LABEL_FALSE })).toBeVisible();
    await expect(desk.locator('.barrow--correct')).toContainText(LABEL_FALSE);
  });
});

async function openHostConsole(page: Page, session: CreatedSession): Promise<void> {
  // Token-in-URL recovery (#/sessions/:id?token=) is enough; seed localStorage too
  // so a reload still has credentials.
  await page.goto(`${new URL(hostUrl(session)).origin}/host/`);
  await page.evaluate(
    ({ sessionCode, code, hostToken, stageToken }) => {
      localStorage.setItem(
        `openroom.host.session.${sessionCode}`,
        JSON.stringify({
          sessionCode,
          code,
          hostToken,
          stageToken,
          createdAt: Date.now(),
        }),
      );
    },
    {
      sessionCode: session.sessionCode,
      code: session.code,
      hostToken: session.hostToken,
      stageToken: session.stageToken,
    },
  );
  await page.goto(hostUrl(session));
}
