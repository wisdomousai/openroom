/**
 * UC-50 — Chart labels on the Stage wall.
 * Contract: docs/journeys/UC-50-wall-chart-labels.md
 *
 * On the wall a ranking names every item next to its rank, a column chart
 * names every column under it, a scale keeps both end labels apart, and a
 * number histogram marks the correct value and says it in its note. Nothing
 * overlaps and nothing leaves the plate at 1920 and 1280 wide.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';

import { command, createSession, join, stageUrl, waitForWorker } from '../fixtures/session';

test.beforeAll(async () => {
  await waitForWorker();
});

type Box = { left: number; top: number; right: number; bottom: number };

async function boxesOf(locator: Locator): Promise<Box[]> {
  return locator.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }));
}

/** Every box lies inside the plate and no two boxes cross, give or take a pixel. */
async function laidOut(page: Page, inner: Locator): Promise<string | null> {
  const plate = await page.locator('.plate').first().boundingBox();
  if (!plate) return 'no plate';
  const boxes = await boxesOf(inner);
  if (boxes.length === 0) return 'no labels';
  for (const box of boxes) {
    if (box.left < plate.x - 1 || box.top < plate.y - 1 || box.right > plate.x + plate.width + 1 || box.bottom > plate.y + plate.height + 1) return 'outside the plate';
  }
  for (const [index, a] of boxes.entries()) {
    for (const b of boxes.slice(index + 1)) {
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) return 'overlap';
    }
  }
  return null;
}

const sentences = [
  'Die Geschwindigkeitsbegrenzungsschilder wurden gestern ausgetauscht',
  'Ich hätte gern einen Tisch für vier Personen am Fenster',
  'Wenn ich mehr Zeit gehabt hätte, wäre ich nach Österreich gefahren',
  'Der Bundesgesundheitsminister hat die Verordnung unterschrieben',
  'Könnten Sie mir bitte sagen, wie ich zum Hauptbahnhof komme?',
  'Obwohl es stark regnete, gingen sie weiter spazieren',
];
const options = sentences.map((label, index) => ({ id: `o${index + 1}`, label }));

test('rankings, columns, scale ends and the number histogram keep every label readable on the wall', async ({ browser }, testInfo) => {
  const interactions = [
    { id: 'rank', type: 'ranking', display: 'sentence', prompt: 'Ordnen Sie die Sätze nach Höflichkeit', options },
    { id: 'cols', type: 'choice', display: 'columns', prompt: 'Welcher Satz ist am höflichsten?', options: options.map((option, index) => (index === 4 ? { ...option, correct: true } : option)) },
    { id: 'scale', type: 'scale', prompt: 'Wie sicher fühlen Sie sich beim Konjunktiv II?', min: 0, max: 10, minLabel: 'Ich verstehe die Bildung der Formen noch überhaupt nicht', maxLabel: 'Ich kann ihn spontan in freier Rede verwenden' },
    { id: 'year', type: 'numeric', display: 'number', prompt: 'In welchem Jahr fiel die Berliner Mauer?', correct: 1989 },
  ];
  const session = await createSession({
    version: 1, meta: { title: 'Wall labels' }, defaults: { resultVisibility: 'live' }, interactions,
    steps: interactions.map((item) => ({ id: item.id, kind: 'interaction', interactionId: item.id })),
  });
  await command(session.sessionCode, session.hostToken, { command: 'session.start' });
  const people = await Promise.all(Array.from({ length: 5 }, () => join(session.code)));
  const ids = options.map((option) => option.id);
  const answer = (id: string, n: number) => id === 'rank'
    ? { kind: 'ranking', optionIds: [...ids.slice(n), ...ids.slice(0, n)] }
    : id === 'cols'
      ? { kind: 'choice', optionIds: [ids[(n + 1) % 6]!] }
      : id === 'scale'
        ? { kind: 'scale', value: [5, 2, 8, 5, 10][n]! }
        : { kind: 'numeric', value: [1989, 1989, 1961, 1990, 1989][n]! };
  for (const item of interactions) {
    await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: item.id });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: item.id });
    for (const [n, person] of people.entries()) {
      await command(session.sessionCode, person.participantToken, { command: 'answer.submit', interactionId: item.id, answer: answer(item.id, n) });
    }
    await command(session.sessionCode, session.hostToken, { command: 'interaction.close', interactionId: item.id });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.reveal', interactionId: item.id });
  }

  /* Going to a slide puts its question back on screen; the results are shown again there. */
  const show = async (id: string) => {
    await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: id });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.reveal', interactionId: id });
  };
  const stage = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
  await stage.goto(stageUrl(session));
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    await stage.setViewportSize(viewport);

    // A ranking names each item beside its rank.
    await show('rank');
    const rankRows = stage.locator('.or-rank-chart .barrow__label');
    await expect(rankRows).toHaveCount(6);
    for (const sentence of sentences) await expect(stage.locator('.or-rank-chart').getByText(sentence, { exact: false })).toBeVisible();
    await expect(rankRows.first().locator('.barrow__rank')).toHaveText('1.');
    await expect.poll(() => laidOut(stage, rankRows), { message: `ranking labels at ${viewport.width}px` }).toBeNull();
    await stage.screenshot({ path: testInfo.outputPath(`ranking-${viewport.width}.png`) });

    // A column chart names every column under it and marks the correct one.
    await show('cols');
    const columns = stage.locator('.or-cols-chart__labels .barrow');
    await expect(columns).toHaveCount(6);
    await expect(stage.locator('.or-cols-chart__labels .barrow[data-or-correct]')).toContainText('Hauptbahnhof');
    await expect.poll(() => laidOut(stage, stage.locator('.or-cols-chart__labels .barrow__label')), { message: `column labels at ${viewport.width}px` }).toBeNull();
    await stage.screenshot({ path: testInfo.outputPath(`columns-${viewport.width}.png`) });

    // A scale keeps its two end labels apart.
    await show('scale');
    await expect(stage.locator('.or-scale-ends__min')).toContainText('überhaupt nicht');
    await expect(stage.locator('.or-scale-ends__max')).toContainText('freier Rede');
    await expect.poll(() => laidOut(stage, stage.locator('.or-scale-ends__min, .or-scale-ends__max')), { message: `scale ends at ${viewport.width}px` }).toBeNull();
    await stage.screenshot({ path: testInfo.outputPath(`scale-${viewport.width}.png`) });

    // A number histogram marks the correct value and says it in its note.
    await show('year');
    await expect(stage.locator('.or-hist-note')).toContainText('5 answers');
    await expect(stage.locator('.or-hist-note__correct')).toContainText('1989');
    await expect.poll(() => laidOut(stage, stage.locator('.or-hist-note')), { message: `histogram note at ${viewport.width}px` }).toBeNull();
    await stage.screenshot({ path: testInfo.outputPath(`histogram-${viewport.width}.png`) });
  }
  await stage.close();
});
