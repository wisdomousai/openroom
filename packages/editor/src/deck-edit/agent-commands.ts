/**
 * The exact CLI lines and MCP tool names for the deck editor's actions.
 *
 * The deck editor claims that the browser, the CLI and MCP are peer clients of
 * one service (`AGENTS.md` §"Product architecture"). A hand-written string in a
 * component is the fastest way to make that claim false: a flag gets renamed in
 * `packages/cli/src/commands/deck.ts` and the UI keeps echoing the old one for
 * a release. So the echo is derived here, from one place.
 *
 * Each function returns the command a *reader* could paste, which means real
 * flags and a real file name. Every deck command needs `--url` and `--token`
 * (the CLI reads neither from the environment), so each line names the origin
 * the deck lives on and the `OPENROOM_TOKEN` variable the command-line page
 * tells the tutor to set. The file placeholder is `plan.yaml`.
 *
 * Keep the strings in lockstep with `packages/cli/src/commands/deck.ts`
 * (`DECK_USAGE`) and `TOOL_DEFINITIONS` in `packages/mcp/src/tools.ts`.
 */

/** Conventional local file name for a deck's plan file. */
export const PLAN_FILE = 'plan.yaml';

/** The two flags every deck command needs. */
function access(origin: string): string {
  return `--url ${origin.replace(/\/+$/, '')} --token "$OPENROOM_TOKEN"`;
}

/** `openroom deck get <id> … > plan.yaml` — read the plan file headlessly. */
export function deckGetCommand(deckId: string, origin: string, version?: number): string {
  const at = version === undefined ? '' : ` --version ${String(version)}`;
  return `openroom deck get ${deckId}${at} ${access(origin)} > ${PLAN_FILE}`;
}

/** `openroom deck save <id> …` — validate locally, then stamp a version. */
export function deckSaveCommand(deckId: string, baseVersion: number, origin: string): string {
  return `openroom deck save ${deckId} --file ${PLAN_FILE} --base ${String(baseVersion)} ${access(origin)}`;
}

/** `openroom deck draft put <id> …` — the CLI half of the editor's auto-save. */
export function deckDraftPutCommand(deckId: string, origin: string): string {
  return `openroom deck draft put ${deckId} --file ${PLAN_FILE} ${access(origin)}`;
}

/** `openroom deck versions <id>` — the stamped history. */
export function deckVersionsCommand(deckId: string, origin: string): string {
  return `openroom deck versions ${deckId} ${access(origin)}`;
}

/** `openroom deck start <id>` — file a session and open the console. */
export function deckStartCommand(deckId: string, origin: string): string {
  return `openroom deck start ${deckId} ${access(origin)}`;
}

/** `openroom outline validate plan.yaml` — the same validator this screen runs. */
export function outlineValidateCommand(): string {
  return `openroom outline validate ${PLAN_FILE}`;
}

/** MCP tool names, exactly as `tools/list` reports them. */
export const MCP_TOOLS = {
  outlineValidate: 'outline_validate',
  deckGet: 'deck_get',
  deckSaveVersion: 'deck_save_version',
  deckDraftPut: 'deck_draft_put',
  deckStart: 'deck_start',
  sessionCoHost: 'session_co_host',
  sessionRecap: 'session_recap',
} as const;

/** The MCP tools for the same read, check, save and start path, in order. */
export function deckToolLine(baseVersion: number): string {
  return `${MCP_TOOLS.deckGet} → ${MCP_TOOLS.outlineValidate} → ${MCP_TOOLS.deckSaveVersion} (baseVersion ${String(baseVersion)}) → ${MCP_TOOLS.deckStart}`;
}
