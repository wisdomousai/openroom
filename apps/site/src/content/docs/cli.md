---
title: Command-line and file workflows
description: Validate files, revise cloud decks safely, control a session, and find the authoritative API contracts.
section: Account and integrations
order: 250
related: [agents, desktop, results, account]
---

## Run the CLI from a checkout

The current CLI is supplied in the OpenRoom repository. Install repository dependencies and build its packages from the repository root:

```sh
bun install
bun run build:packages
node packages/cli/dist/cli.js --help
```

The examples below use `openroom` as shorthand for `node /absolute/path/to/OpenRoom/packages/cli/dist/cli.js`. Use that full command, or configure a shell alias to it. Run file-related commands in the folder where you want their output.

Use `--help` for the current command list and `--json` for structured output. Exit codes are **0** for success, **1** for validation or command failure, and **2** for usage errors.

## Start with a small session file

```sh
openroom init lesson.yaml
openroom validate lesson.yaml
openroom preview lesson.yaml
```

`init` writes a starter file. An existing file requires `--force` to replace it. `validate` reports errors with locations. `preview` prints host and participant representations so you can check the available content and answer visibility.

This compact format is useful for simple questions. For full decks with slides, layouts, teaching activities, and advanced interactions, use the typed outline format:

```sh
openroom outline validate plan.yaml
```

Keep YAML outline files separate from packaged `.openroom` files. An `.openroom` file is the portable Desktop package, with its manifest and embedded resources.

## Read and revise a cloud deck

Create a personal token in Settings. The examples use `OPENROOM_TOKEN` for a token already stored in your local environment and `DECK_ID` for the target deck identifier. Replace the origin when using another installation.

```sh
openroom deck get DECK_ID --url https://openroom.app --token "$OPENROOM_TOKEN" > plan.yaml
openroom deck versions DECK_ID --url https://openroom.app --token "$OPENROOM_TOKEN"
openroom outline validate plan.yaml
openroom deck save DECK_ID --file plan.yaml --base 3 --url https://openroom.app --token "$OPENROOM_TOKEN"
```

Edit the downloaded file between reading and validating it. Replace `3` with the version you actually read. The save validates the outline and creates a saved version when the content changes. An explicit base version protects against overwriting someone else's intervening change.

For **E_VERSION_CONFLICT**, read the latest version, compare it with your edited file, reconcile the changes, and save against that latest base. Keep a local copy of your intended changes during reconciliation.

Use `deck get DECK_ID --version N` to read a particular saved version. The normal text output is YAML suitable for redirection; `--json` wraps the result for scripts.

## Exchange working drafts

Use `deck draft get`, `deck draft put --file plan.yaml --base N`, and `deck draft discard` with the deck ID, origin, and token. A working draft can contain incomplete or invalid text. Saving a validated deck version is a separate operation.

Coordinate draft changes with anyone currently editing the same deck. After a draft upload, open the editor and review the content and validation state before starting a session.

## Start and control a session

```sh
openroom deck start DECK_ID --url https://openroom.app --token "$OPENROOM_TOKEN" --json
openroom session facilitate SESSION_CODE --url https://openroom.app --token "$OPENROOM_TOKEN"
openroom session status
```

Use the session code returned by the start command in the second command. `deck start` reports the launched session; `session facilitate` attaches the CLI to it and stores its control state in the current directory. Check a returned start warning before assuming participation is open.

The following operations use that attached session:

| Task | Commands |
| --- | --- |
| Open, close, or reveal a question | `session open ID`, `session close ID`, `session reveal ID` |
| Navigate | `session advance`, `session outline-next`, `session outline-previous`, `session outline-goto STEP_ID` |
| Add a prepared slide | `session outline-insert step.json --after STEP_ID --show` |
| Run peer instruction | `session revote ID`, `session undo-revote ID` |
| Freeze or resume participation | `session freeze`, `session unfreeze` |
| Change the live interface theme | `session theme default` (also `chalkboard`, `paper`, `projector`, `sherbet`) |
| Moderate an entry | `session hide INTERACTION_ID PARTICIPANT_ID`, `session unhide INTERACTION_ID PARTICIPANT_ID` |
| Manage groups | `session group-set group.json`, `session group-remove GROUP_ID` |
| Transfer presenter control | `session handoff FACILITATOR_ID`, `session recover` |
| Finish | `session end` |

Use identifiers from the current outline and session state. Presenter and membership requirements apply to CLI commands just as they do in the browser.

The local `.openroom.json` state file contains session credentials. Keep it private and out of version control. Use a different working directory for another session to keep the control state separate.

## Issue named roster invitations

Roster administration uses the live-session API. Prepare a deck with roster identity, start it using an entitled account, and retain its session code and host capability. Use the current session's host token in these requests.

| Request | Purpose |
| --- | --- |
| `POST /api/sessions/SESSION_CODE/roster/seats` with JSON `{"displayName":"Alex"}` | Create a named seat and obtain its one-time displayed invitation token. |
| `GET /api/sessions/SESSION_CODE/roster/seats` | Read the named seats and their redemption/revocation state. |
| `DELETE /api/sessions/SESSION_CODE/roster/seats/SEAT_ID` | Revoke the invitation for that seat. |

Send the requests with `Authorization: Bearer HOST_TOKEN` and a JSON content type for creation. Keep the returned token private. Form the participant address using `https://join.openroom.app/?code=SESSION_CODE&invite=INVITATION_TOKEN`, replacing the origin for your installation.

The roster supports 200 active seats. Names are normalized to single spaces and limited to 64 characters. Send each person their own invitation. Keep the seat identifier so an invitation can be revoked later.

## Export results

```sh
openroom results
openroom export --format csv --out counts.csv
openroom export --format json --out results.json
openroom export --format ballots --out responses.csv
openroom session recap --selection selection.json --format html --out recap.html
```

Individual-response export requires the relevant entitlement. Build a recap selection from the current available entries and review the resulting document before sharing. Live retention limits still apply.

## Connect stdio MCP

Configure the client with the CLI executable and its arguments:

```sh
openroom mcp
openroom mcp /absolute/path/to/lesson.openroom
```

Use one of these forms for the intended backend. The process communicates over standard input and output; let the MCP client manage it. See [external agent setup](/docs/agents/) for backend selection and access.

## Use the API reference

`openroom api METHOD /api/... --url ORIGIN --token TOKEN` sends an authenticated control-plane request. Supply a body through `--file request.json` or `--body` as needed.

Use the deployed [OpenAPI document](/openapi.json) for routes and request/response contracts, and the [MCP endpoint](/api/mcp) through an MCP client for its tool descriptions. These are generated with the running application. The repository's [agent guide](https://github.com/wisdomousai/openroom/blob/main/docs/AGENT.md) supplies integration background when that repository is available to you.

Use account credentials for account work, the session capability for its live controls, and the appropriate learner credential for learner access. A permanent deletion request produces a browser confirmation that must be completed by the signed-in account.
