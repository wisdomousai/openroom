import { loadJourneys } from './journeys';
import { captureJourneys } from './capture';
import { narrateJourneys } from './narrate';
import { renderJourneys } from './render';
import { validateWalkthrough } from './validate';
import { verifyJourneys } from './verify';
import { FINDINGS } from './findings';
import { INVENTORY } from './inventory';

const [command, ...ids] = process.argv.slice(2);

async function list(): Promise<void> {
  const journeys = await loadJourneys();
  for (const journey of journeys) {
    console.log(`${journey.status.toUpperCase()} ${journey.id}: ${journey.title} (${journey.chapters.length} chapters${journey.seed ? `, seed=${journey.seed}` : ''})`);
    console.log(`  ${journey.purpose}`);
  }
  console.log(`\nInventory: ${INVENTORY.filter((entry) => entry.kind === 'implemented').length} implemented, ${INVENTORY.filter((entry) => entry.kind === 'planned').length} planned, ${INVENTORY.filter((entry) => entry.kind === 'not-available').length} not available.`);
  console.log(`Open findings: ${FINDINGS.filter((finding) => finding.status === 'open').length}`);
}

async function main(): Promise<void> {
  switch (command) {
    case 'list':
      await list();
      return;
    case 'validate':
      await validateWalkthrough();
      return;
    case 'capture':
      await captureJourneys(ids);
      return;
    case 'narrate':
      await narrateJourneys(ids);
      return;
    case 'render':
      await renderJourneys(ids);
      return;
    case 'verify':
      await verifyJourneys(ids);
      return;
    case 'all':
      await validateWalkthrough();
      await captureJourneys(ids);
      await narrateJourneys(ids);
      await renderJourneys(ids);
      await verifyJourneys(ids);
      return;
    default:
      throw new Error('Usage: run.sh <list|validate|capture|narrate|render|verify|all> [journey-id ...]');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

