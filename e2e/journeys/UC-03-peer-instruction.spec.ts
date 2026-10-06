/**
 * UC-03 — Peer instruction: discuss, revote, undo, calm reveal
 * Contract: docs/journeys/UC-03-peer-instruction.md
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
  type JoinedParticipant,
} from '../fixtures/session';

const INTERACTION = 'vote-1';
const LABEL_EQUAL = 'Both exert the same magnitude of force on each other';

test.beforeAll(async () => {
  await waitForWorker();
});

async function seedThroughRound2(): Promise<{
  session: CreatedSession;
  participants: JoinedParticipant[];
}> {
  const sessionDoc = loadExampleSession('peer-instruction');
  const session = await createSession(sessionDoc);
  await command(session.sessionCode, session.hostToken, { command: 'session.start' });
  await command(session.sessionCode, session.hostToken, {
    command: 'interaction.open',
    interactionId: INTERACTION,
  });

  const participants: JoinedParticipant[] = [];
  for (let i = 0; i < 4; i++) participants.push(await join(session.code));

  const r1 = ['truck', 'truck', 'truck', 'equal'] as const;
  for (let i = 0; i < 4; i++) {
    await command(session.sessionCode, participants[i]!.participantToken, {
      command: 'answer.submit',
      interactionId: INTERACTION,
      answer: { kind: 'choice', optionIds: [r1[i]!] },
    });
  }

  await command(session.sessionCode, session.hostToken, {
    command: 'interaction.close',
    interactionId: INTERACTION,
  });
  await command(session.sessionCode, session.hostToken, {
    command: 'interaction.revote',
    interactionId: INTERACTION,
  });

  const r2 = ['truck', 'equal', 'equal', 'equal'] as const;
  for (let i = 0; i < 4; i++) {
    await command(session.sessionCode, participants[i]!.participantToken, {
      command: 'answer.submit',
      interactionId: INTERACTION,
      answer: { kind: 'choice', optionIds: [r2[i]!] },
    });
  }

  return { session, participants };
}

async function reveal(session: CreatedSession): Promise<void> {
  await command(session.sessionCode, session.hostToken, {
    command: 'interaction.close',
    interactionId: INTERACTION,
  });
  await command(session.sessionCode, session.hostToken, {
    command: 'interaction.reveal',
    interactionId: INTERACTION,
  });
}

async function openHostConsole(page: Page, session: CreatedSession): Promise<void> {
  await page.goto(`${new URL(hostUrl(session)).origin}/host/`);
  await page.evaluate(
    ({ sessionCode, code, hostToken, stageToken }) => {
      localStorage.setItem(
        `openroom.host.session.${sessionCode}`,
        JSON.stringify({ sessionCode, code, hostToken, stageToken, createdAt: Date.now() }),
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

test.describe('UC-03 peer instruction', () => {
  test('stage shows discuss after R1 close, then calm was→now after reveal', async ({ page }) => {
    const sessionDoc = loadExampleSession('peer-instruction');
    const session = await createSession(sessionDoc);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.open',
      interactionId: INTERACTION,
    });
    const p = await join(session.code);
    await command(session.sessionCode, p.participantToken, {
      command: 'answer.submit',
      interactionId: INTERACTION,
      answer: { kind: 'choice', optionIds: ['truck'] },
    });
    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.close',
      interactionId: INTERACTION,
    });

    await page.goto(stageUrl(session));
    await expect(page.getByText(/Discuss|picked a different answer/i).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('.shiftrow')).toHaveCount(0);

    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.revote',
      interactionId: INTERACTION,
    });
    await command(session.sessionCode, p.participantToken, {
      command: 'answer.submit',
      interactionId: INTERACTION,
      answer: { kind: 'choice', optionIds: ['equal'] },
    });
    await reveal(session);

    await expect(page.locator('.shiftrow')).toHaveCount(4, { timeout: 20_000 });
    await expect(page.locator('.shiftrow__nums').first()).toContainText('% →');
    await expect(page.locator('.tag-correct')).toHaveCount(1);
    await expect(page.locator('.shiftnote')).toContainText(/Round 1/i);
    // No dashboard chrome
    await expect(page.locator('.rounds__head')).toHaveCount(0);
    await expect(page.locator('.roundrow__delta')).toHaveCount(0);
  });

  test('host can go back to round 1 after revote', async ({ page }) => {
    const { session } = await seedThroughRound2();
    await openHostConsole(page, session);

    await expect(page.getByRole('button', { name: /Back to first vote/i })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: /Back to first vote/i }).click();

    // Undo restores the closed first vote: discuss cue on the desk, not the shift chart.
    const desk = page.locator('.stage-mirror');
    await expect(desk.getByText(/Discuss|picked a different answer/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(desk.locator('.shiftrow')).toHaveCount(0);
    // Advanced control is available again after undo; reveal stays a separate verb.
    await expect(page.getByRole('button', { name: 'Second vote', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /Call out the correct answer/i })).toBeVisible();
  });

  test('participant sees discuss, then second vote, then shift only after reveal', async ({
    page,
  }) => {
    const sessionDoc = loadExampleSession('peer-instruction');
    const session = await createSession(sessionDoc);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.open',
      interactionId: INTERACTION,
    });
    const actor = await join(session.code);
    await command(session.sessionCode, actor.participantToken, {
      command: 'answer.submit',
      interactionId: INTERACTION,
      answer: { kind: 'choice', optionIds: ['equal'] },
    });
    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.close',
      interactionId: INTERACTION,
    });

    await joinInBrowser(page, session.code);
    await expect(page.getByText(/Discuss|disagrees/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('region', { name: 'Results' })).toHaveCount(0);

    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.revote',
      interactionId: INTERACTION,
    });
    await expect(page.getByText(/Second vote/i).first()).toBeVisible({ timeout: 15_000 });

    await command(session.sessionCode, actor.participantToken, {
      command: 'answer.submit',
      interactionId: INTERACTION,
      answer: { kind: 'choice', optionIds: ['equal'] },
    });
    await reveal(session);

    const results = page.getByRole('region', { name: 'Results' });
    await expect(results).toBeVisible({ timeout: 20_000 });
    await expect(results.locator('[data-round="r1"]')).toHaveCount(4);
    await expect(results).toContainText(LABEL_EQUAL);
  });
});
