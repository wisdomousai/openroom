import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MCP_TOOLS,
  deckDraftPutCommand,
  deckGetCommand,
  deckSaveCommand,
  deckSaveToolLine,
  deckStartCommand,
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
    expect(deckSaveCommand('d-42', 7)).toBe('openroom deck save d-42 --file plan.yaml --base 7');
    expect(deckGetCommand('d-42')).toBe('openroom deck get d-42 --yaml');
    expect(deckGetCommand('d-42', 3)).toBe('openroom deck get d-42 --version 3 --yaml');
    expect(deckStartCommand('d-42')).toBe('openroom deck start d-42');
    expect(deckVersionsCommand('d-42')).toBe('openroom deck versions d-42');
    expect(deckDraftPutCommand('d-42')).toBe('openroom deck draft put d-42 --file plan.yaml');
    expect(outlineValidateCommand()).toBe('openroom outline validate plan.yaml');
  });

  it('uses only subcommands and flags the CLI documents', () => {
    const lines = [
      deckGetCommand('d-42', 3),
      deckSaveCommand('d-42', 7),
      deckDraftPutCommand('d-42'),
      deckVersionsCommand('d-42'),
      deckStartCommand('d-42'),
    ];
    for (const line of lines) {
      const [, , sub] = line.split(' ');
      expect(CLI_DESIGN).toContain(`openroom deck ${sub as string}`);
      for (const flag of line.match(/--[a-z]+/g) ?? []) {
        // --yaml is `deck get`'s default and documented as optional.
        expect(`${CLI_DESIGN} --yaml`).toContain(flag);
      }
    }
  });

  it('names tools MCP actually exposes', () => {
    for (const tool of Object.values(MCP_TOOLS)) {
      expect(MCP_TOOLS_SOURCE).toContain(`name: '${tool}'`);
    }
    expect(deckSaveToolLine(7)).toBe('outline_validate → deck_save_version (baseVersion 7)');
  });
});
