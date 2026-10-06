/** Prepare a support repair file. Deliberately has no network/database client. */
import { readFile, writeFile } from 'node:fs/promises';
import { billingRetrySql } from '../apps/worker/src/billing/support-retry';

const [caseFile, outputFile, ...extra] = process.argv.slice(2);
if (!caseFile || !outputFile || extra.length) throw new Error('Usage: bun run billing:retry <case.json> <repair.sql>');
const sql = billingRetrySql(JSON.parse(await readFile(caseFile, 'utf8')));
await writeFile(outputFile, sql, { flag: 'wx', mode: 0o600 });
console.log('Prepared a conditional repair file. No database or Paddle request was made.');
