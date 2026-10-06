import { join } from 'node:path';
import { FINDINGS } from './findings';
import { INVENTORY } from './inventory';
import { loadJourneys } from './journeys';

function routeKnown(route: string): boolean {
  return INVENTORY.some((entry) => entry.route === route);
}

export async function validateWalkthrough(): Promise<void> {
  const journeys = await loadJourneys();
  const errors: string[] = [];
  const journeyIds = new Set<string>();
  const chapterIds = new Set<string>();

  for (const journey of journeys) {
    if (journeyIds.has(journey.id)) errors.push(`duplicate journey id: ${journey.id}`);
    journeyIds.add(journey.id);
    if (journey.status === 'scripted' && journey.chapters.length === 0) {
      errors.push(`scripted journey has no chapters: ${journey.id}`);
    }
    for (const route of journey.routes) {
      if (!routeKnown(route)) errors.push(`${journey.id} route is not in inventory: ${route}`);
    }
    if (journey.seed) {
      const seedPath = join(import.meta.dir, '../seeds', `${journey.seed}.json`);
      if (!(await Bun.file(seedPath).exists())) errors.push(`${journey.id} seed file is missing: ${seedPath}`);
    }
    for (const chapter of journey.chapters) {
      const key = `${journey.id}/${chapter.id}`;
      if (chapterIds.has(key)) errors.push(`duplicate chapter id: ${key}`);
      chapterIds.add(key);
      if (chapter.narration.trim() === '') errors.push(`chapter has no narration: ${key}`);
      if (chapter.actions.length === 0) errors.push(`chapter has no actions: ${key}`);
    }
  }

  for (const finding of FINDINGS) {
    for (const journeyId of finding.journeys) {
      if (!journeyIds.has(journeyId)) errors.push(`${finding.id} references unknown journey: ${journeyId}`);
    }
  }

  const scripted = journeys.filter((journey) => journey.status === 'scripted').length;
  const planned = journeys.filter((journey) => journey.status === 'planned').length;
  const openFindings = FINDINGS.filter((finding) => finding.status === 'open').length;
  console.log(`Validated ${journeys.length} scenario files (${scripted} scripted, ${planned} planned).`);
  console.log(`Validated ${chapterIds.size} chapters and ${INVENTORY.length} inventory entries.`);
  console.log(`Tracked ${openFindings} open findings.`);
  if (errors.length > 0) throw new Error(`Walkthrough validation failed:\n- ${errors.join('\n- ')}`);
}

