# Licensing

Copyright (c) 2026 wisdomousai.

OpenRoom is two licences in one repository. The core, which makes and presents
decks and runs live sessions, is MIT. The workspace, which organises decks for a
signed-in teacher and is the web host, is AGPL-3.0-only. Each directory below
carries its licence in its `package.json` and, where marked, a `LICENSE` file.

| Directory | Licence | Licence text |
| --- | --- | --- |
| `packages/*` (every package) | MIT | `LICENSE` in each package |
| `apps/relay` | MIT | `apps/relay/LICENSE` |
| `apps/desktop` | MIT | `apps/desktop/LICENSE` |
| `apps/stage` | MIT | `apps/stage/LICENSE` |
| `apps/participant` | MIT | `apps/participant/LICENSE` |
| `apps/office` | MIT | `apps/office/LICENSE` |
| `examples/` | MIT | `examples/LICENSE` |
| `plugin/` | MIT | `plugin/LICENSE` |
| `apps/workspace` | AGPL-3.0-only | `apps/workspace/LICENSE` |
| `apps/workspace-worker` | AGPL-3.0-only | `apps/workspace-worker/LICENSE` |
| `apps/site` | AGPL-3.0-only | root `LICENSE` |
| `e2e/` | AGPL-3.0-only | root `LICENSE` |

The root [`LICENSE`](LICENSE) holds the GNU Affero General Public License v3
text. It applies only to the directories listed above as AGPL-3.0-only; it does
not relicense the MIT directories. The root `package.json` is repository tooling
(workspaces and scripts), not a package; its `license` field points to this file.

## Commercial licence

Organisations that cannot use the AGPL-licensed workspace, or that want to
self-host with a support agreement, can license OpenRoom commercially. Write to
[hello@openroom.app](mailto:hello@openroom.app).

## Contributions

Contributions to either half are accepted under the
[Contributor License Agreement](CLA.md); see [CONTRIBUTING.md](CONTRIBUTING.md).
