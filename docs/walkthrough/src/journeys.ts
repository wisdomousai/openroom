import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { WalkthroughJourney } from './types';

const scenariosDir = resolve(import.meta.dir, '../scenarios');

function parseScenario(value: unknown, filename: string): WalkthroughJourney {
  if (!value || typeof value !== 'object') throw new Error(`Scenario ${filename} is not an object`);
  const journey = value as Partial<WalkthroughJourney>;
  if (!journey.id || !journey.title || !Array.isArray(journey.chapters)) {
    throw new Error(`Scenario ${filename} needs id, title, and chapters`);
  }
  return journey as WalkthroughJourney;
}

export async function loadJourneys(): Promise<WalkthroughJourney[]> {
  const files = (await readdir(scenariosDir))
    .filter((file) => file.endsWith('.json'))
    .sort();
  return Promise.all(files.map(async (file) => {
    const value = await Bun.file(join(scenariosDir, file)).json();
    return parseScenario(value, file);
  }));
}

export async function journeyById(id: string): Promise<WalkthroughJourney> {
  const journey = (await loadJourneys()).find((candidate) => candidate.id === id);
  if (!journey) throw new Error(`Unknown walkthrough journey: ${id}`);
  return journey;
}

