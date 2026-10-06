---
title: Connect an external agent
description: Author decks and manage your work through an MCP client using your OpenRoom account.
section: Account and integrations
order: 240
related: [desktop-agents, account, cli, limits]
---

## Choose the connection

OpenRoom provides an MCP server for compatible agent clients. Use the server URL shown in **Settings → Connect an agent (MCP)** for your installation. The hosted service uses `https://openroom.app/api/mcp`.

| Connection | Use it for |
| --- | --- |
| Hosted MCP with account consent | A client that supports OpenRoom's browser sign-in and authorization flow. |
| Hosted MCP with a personal token | A client that accepts an HTTP server URL and Authorization header. |
| Local stdio MCP | An agent working with the open Desktop file or a local `.openroom` file. |

Your agent runs in your chosen client. OpenRoom receives the resulting deck and account operations. Supply source documents to your own agent in accordance with their handling requirements.

## Connect with account consent

In a compatible client, add the MCP URL as a connection. Follow the browser sign-in flow, review the requested access, and approve the intended account. Return to the client and refresh its available tools.

Client support and account requirements vary. For a client that requests a token header instead, use the token procedure below. Manage consent-based connections in [Connected apps](/docs/account/#manage-connected-apps).

## Connect with a personal token

Create a [personal API token](/docs/account/#create-and-revoke-personal-api-tokens), then configure:

```text
Server URL: https://openroom.app/api/mcp
Authorization header: Bearer YOUR_PERSONAL_TOKEN
```

Use your installation's origin if it differs. In clients that ask for the complete header, enter `Authorization: Bearer YOUR_PERSONAL_TOKEN`. Keep the secret in the client's protected configuration.

Settings includes **Copy command** for Claude Code and **Copy URL** / **Copy header** helpers for compatible clients. Copy the command offered by the current app rather than adapting an old configuration by hand.

After connecting, ask the agent to read its OpenRoom instructions and list the spaces available to your account. Confirm the destination before asking it to create or change a deck.

## Prepare and revise a deck

A useful request includes the destination, audience, teaching objective, source material, and desired output. For example:

> In the French tutoring space, create a deck in Camille's folder for a 30-minute B1 lesson about travel disruptions. Use my attached passage, include comprehension and past-tense practice, and add a writing task. Keep the source wording and explain any changes you make.

Open the resulting deck in the editor. Check slide fit, answer keys, accepted variants, and follow-up work. For a revision, identify the existing deck and explain the changes so the agent can update the correct file.

The MCP server supplies the current tool descriptions, argument contracts, and validation errors directly to the client. Have the agent use those descriptions when saving, resolving a version conflict, starting a session, or recovering an operation. They are the authoritative reference for the agent surface.

## Work on a local file

Configure a stdio client to launch the repository's CLI with `mcp`; see [CLI setup](/docs/cli/#run-the-cli-from-a-checkout). Add the path to an `.openroom` file when working headlessly.

The local connection first uses a running Desktop instance. Otherwise, an explicit file path opens the local file backend; without either, the CLI uses the configured hosted backend. Confirm the active document before requesting edits. A local file lock can require closing another writer before saving.

For authenticated cloud work, configure the direct HTTP MCP connection with account consent or a personal token as described above. The stdio hosted fallback supplies public server discovery. `OPENROOM_ORIGIN` selects its server origin.

Keep original reference documents in your own storage. Review and save the resulting deck before sharing it with learners or starting participation.

## Resolve access failures

For an authentication failure, check the origin and token or repeat the consent flow. For a permissions failure, confirm current membership and role in the destination space. For an entitlement message, review the owner's current plan.

Recoverable deletion uses Trash. Permanent deletion ends in a short-lived browser confirmation, where the signed-in account reviews the item. Follow that confirmation only when you intend to remove the item permanently.
