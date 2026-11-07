/**
 * UC-50 — Chart labels on the Stage wall.
 * Contract: docs/journeys/UC-50-wall-chart-labels.md
 *
 * On the wall a ranking names every item next to its rank, a column chart
 * names every column under it, eight long options keep their bars beside
 * them, a scale keeps both end labels apart, and a number histogram marks the
 * correct value and says it in its note. Nothing overlaps, nothing leaves the
 * plate, and no chart text is smaller than the wall's label floor (LD12) at
 * 1920 and 1280 wide.
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

/** The label floor of the wall type ramp (DESIGN.md): 1.1 cqw of the stage. */
const FLOOR = 0.011;

/** The smallest font size of any visible text in the plate body, as a share of the stage width. */
async function smallestText(page: Page): Promise<number> {
  return page.evaluate(() => {
    const stage = document.querySelector('.stage')?.getBoundingClientRect().width ?? 0;
    let smallest = Number.POSITIVE_INFINITY;
    for (const element of document.querySelectorAll('.plate__body *')) {
      const ownText = Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
      const box = element.getBoundingClientRect();
      // Screen-reader-only text is a 1 px box; a style element has no box.
      if (!ownText || box.width < 2 || box.height < 2) continue;
      smallest = Math.min(smallest, Number.parseFloat(getComputedStyle(element).fontSize));
    }
    return stage > 0 && Number.isFinite(smallest) ? smallest / stage : 0;
  });
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
const eight = [
  ...sentences,
  'Hätten Sie vielleicht einen Moment Zeit, mir kurz zu helfen?',
  'Es wäre schön, wenn wir uns nächste Woche wieder treffen könnten',
].map((label, index) => ({ id: `o${index + 1}`, label, ...(index === 3 ? { correct: true } : {}) }));

test('rankings, columns, eight long bars, scale ends and the number histogram keep every label readable on the wall', async ({ browser }, testInfo) => {
  const interactions = [
    { id: 'rank', type: 'ranking', display: 'sentence', prompt: 'Ordnen Sie die Sätze nach Höflichkeit', options },
    { id: 'cols', type: 'choice', display: 'columns', prompt: 'Welcher Satz ist am höflichsten?', options: options.map((option, index) => (index === 4 ? { ...option, correct: true } : option)) },
    { id: 'bars', type: 'choice', prompt: 'Welcher Satz ist am höflichsten, wenn man im Restaurant nach einem Tisch fragt?', options: eight },
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
      : id === 'bars'
        ? { kind: 'choice', optionIds: [eight[(n * 3) % 8]!.id] }
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
    const readable = (chart: string) => expect.poll(() => smallestText(stage), { message: `${chart} text at ${viewport.width}px is at least 1.1% of the stage width` }).toBeGreaterThanOrEqual(FLOOR - 0.0001);

    // A ranking names each item beside its rank.
    await show('rank');
    const rankRows = stage.locator('.or-rank-chart .barrow__label');
    await expect(rankRows).toHaveCount(6);
    for (const sentence of sentences) await expect(stage.locator('.or-rank-chart').getByText(sentence, { exact: false })).toBeVisible();
    await expect(rankRows.first().locator('.barrow__rank')).toHaveText('1.');
    await expect.poll(() => laidOut(stage, rankRows), { message: `ranking labels at ${viewport.width}px` }).toBeNull();
    await readable('ranking');
    await stage.screenshot({ path: testInfo.outputPath(`ranking-${viewport.width}.png`) });

    // A column chart names every column under it and marks the correct one.
    await show('cols');
    const columns = stage.locator('.or-cols-chart__labels .barrow');
    await expect(columns).toHaveCount(6);
    await expect(stage.locator('.or-cols-chart__labels .barrow[data-or-correct]')).toContainText('Hauptbahnhof');
    await expect.poll(() => laidOut(stage, stage.locator('.or-cols-chart__labels .barrow__label')), { message: `column labels at ${viewport.width}px` }).toBeNull();
    await readable('column');
    await stage.screenshot({ path: testInfo.outputPath(`columns-${viewport.width}.png`) });

    // Eight long options keep each name beside its bar, with the correct one marked.
    await show('bars');
    const barLabels = stage.locator('.or-bars-chart .barrow__label');
    await expect(barLabels).toHaveCount(8);
    await expect(stage.locator('.or-bars-chart .barrow[data-or-correct]')).toContainText('Bundesgesundheitsminister');
    await expect.poll(() => laidOut(stage, stage.locator('.or-bars-chart .barrow__label, .or-bars-chart svg text')), { message: `bar labels and values at ${viewport.width}px` }).toBeNull();
    await readable('bar');
    await stage.screenshot({ path: testInfo.outputPath(`bars-${viewport.width}.png`) });

    // A scale keeps its two end labels apart and below the tick numbers.
    await show('scale');
    await expect(stage.locator('.or-scale-ends__min')).toContainText('überhaupt nicht');
    await expect(stage.locator('.or-scale-ends__max')).toContainText('freier Rede');
    const ticks = stage.locator('.or-scale-chart svg text[data-ts-key^="x-tick-label"]');
    const ends = stage.locator('.or-scale-ends__min, .or-scale-ends__max');
    await expect(ticks).toHaveCount(11);
    await expect.poll(() => laidOut(stage, stage.locator('.or-scale-chart svg text[data-ts-key^="x-tick-label"], .or-scale-ends__min, .or-scale-ends__max')), { message: `scale ticks and ends at ${viewport.width}px` }).toBeNull();
    await expect.poll(async () => {
      const lowestTick = Math.max(...(await boxesOf(ticks)).map((box) => box.bottom));
      return Math.min(...(await boxesOf(ends)).map((box) => box.top)) >= lowestTick - 1;
    }, { message: `scale ends below the ticks at ${viewport.width}px` }).toBe(true);
    await readable('scale');
    await stage.screenshot({ path: testInfo.outputPath(`scale-${viewport.width}.png`) });

    // A number histogram marks the correct value and says it in its note.
    await show('year');
    await expect(stage.locator('.or-hist-note')).toContainText('5 answers');
    await expect(stage.locator('.or-hist-note__correct')).toContainText('1989');
    await expect(stage.locator('.or-hist-chart [data-ts-key="numeric-correct"] line')).toHaveCount(1);
    await expect.poll(() => laidOut(stage, stage.locator('.or-hist-note')), { message: `histogram note at ${viewport.width}px` }).toBeNull();
    await readable('histogram');
    await stage.screenshot({ path: testInfo.outputPath(`histogram-${viewport.width}.png`) });
  }
  await stage.close();
});
