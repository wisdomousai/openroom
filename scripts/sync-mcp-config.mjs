/**
 * One server declaration, three files that must agree.
 *
 * `plugin/mcp.json` is the source: the Agent-Plugins-spec manifest a client
 * installs. The other two are mechanical copies of the same `mcpServers` block:
 *
 *   plugin/.mcp.json  — because plugin/.codex-plugin/plugin.json points at
 *                       "./.mcp.json", a path relative to the plugin directory.
 *   .mcp.json         — so a client opened on this repo reaches the same server
 *                       without installing the plugin first.
 *
 * Hand-maintaining three copies of one URL is how the same list rots twice.
 * Run `node scripts/sync-mcp-config.mjs` after editing the source; `--check`
 * fails instead of writing, which is what the test uses.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SOURCE = 'plugin/mcp.json';
/** Files generated from SOURCE's `mcpServers`, in the order they are written. */
export const DERIVED = ['plugin/.mcp.json', '.mcp.json'];

export function readSourceServers() {
  const source = JSON.parse(readFileSync(resolve(root, SOURCE), 'utf8'));
  if (typeof source.mcpServers !== 'object' || source.mcpServers === null) {
    throw new Error(`${SOURCE} has no mcpServers object`);
  }
  return source.mcpServers;
}

/** The exact bytes a derived file must contain for the given servers. */
export function renderDerived(mcpServers) {
  return `${JSON.stringify({ mcpServers }, null, 2)}\n`;
}

function main() {
  const check = process.argv.includes('--check');
  const expected = renderDerived(readSourceServers());
  const stale = [];
  for (const relative of DERIVED) {
    const path = resolve(root, relative);
    let actual = null;
    try {
      actual = readFileSync(path, 'utf8');
    } catch {
      // Missing counts as stale; it is written below unless checking.
    }
    if (actual === expected) continue;
    stale.push(relative);
    if (!check) writeFileSync(path, expected);
  }

  if (check && stale.length > 0) {
    console.error(
      `[sync-mcp-config] out of date with ${SOURCE}: ${stale.join(', ')}\n` +
        'Run: node scripts/sync-mcp-config.mjs',
    );
    process.exit(1);
  }
  console.log(
    stale.length === 0
      ? '[sync-mcp-config] up to date'
      : `[sync-mcp-config] wrote ${stale.join(', ')}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
