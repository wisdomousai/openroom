import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MCP_TOOLS,
  deckDraftPutCommand,
  deckGetCommand,
  deckSaveCommand,
  deckStartCommand,
  deckToolLine,
  deckVersionsCommand,
  outlineValidateCommand,
} from './agent-commands';

/**
 * The deck editor footer's whole claim is that these are the *real* commands, so a test
 * that only compared the strings with themselves would let the CLI rename a flag
 * and leave the UI lying for a release.
 *
 * The sources are read off disk rather than imported: the host is a browser app
 * and has no business taking a package dependency on the CLI to run a test. A
 * moved file fails loudly here, which is the correct outcome — this guard is
 * meant to be maintained.
 */
function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), 'utf8');
}

const CLI_DESIGN = repoFile('packages/cli/src/commands/deck.ts');
const MCP_TOOLS_SOURCE = repoFile('packages/mcp/src/tools.ts');

describe('deck editor agent commands', () => {
  it('echoes the deck id and base version a save actually sends', () => {
    const access = '--url https://openroom.app --token "$OPENROOM_TOKEN"';
    expect(deckSaveCommand('d-42', 7, 'https://openroom.app/')).toBe(`openroom deck save d-42 --file plan.yaml --base 7 ${access}`);
    expect(deckGetCommand('d-42', 'https://openroom.app')).toBe(`openroom deck get d-42 ${access} > plan.yaml`);
    expect(deckGetCommand('d-42', 'https://openroom.app', 3)).toBe(`openroom deck get d-42 --version 3 ${access} > plan.yaml`);
    expect(deckStartCommand('d-42', 'https://openroom.app')).toBe(`openroom deck start d-42 ${access}`);
    expect(outlineValidateCommand()).toBe('openroom outline validate plan.yaml');
  });

  it('uses only subcommands the CLI documents, with every flag their usage line requires', () => {
    const lines = [
      deckGetCommand('d-42', 'https://openroom.app', 3),
      deckSaveCommand('d-42', 7, 'https://openroom.app'),
      deckDraftPutCommand('d-42', 'https://openroom.app'),
      deckVersionsCommand('d-42', 'https://openroom.app'),
      deckStartCommand('d-42', 'https://openroom.app'),
    ];
    for (const line of lines) {
      const [, , sub, second] = line.split(' ');
      const name = sub === 'draft' ? `draft ${second as string}` : (sub as string);
      const usage = CLI_DESIGN.split('\n').find((row) => row.trim().startsWith(`openroom deck ${name} `));
      expect(usage, name).toBeDefined();
      const required = (usage!.replace(/\[[^\]]*\]/g, '').match(/--[a-z-]+/g) ?? []);
      for (const flag of required) expect(line, `${name} needs ${flag}`).toContain(flag);
      for (const flag of line.match(/--[a-z-]+/g) ?? []) expect(usage, `${name} takes ${flag}`).toContain(flag);
    }
  });

  it('names tools MCP actually exposes', () => {
    for (const tool of Object.values(MCP_TOOLS)) {
      expect(MCP_TOOLS_SOURCE).toContain(`name: '${tool}'`);
    }
    expect(deckToolLine(7)).toBe('deck_get → outline_validate → deck_save_version (baseVersion 7) → deck_start');
  });
});
