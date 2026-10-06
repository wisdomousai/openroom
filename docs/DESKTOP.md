# Desktop client

OpenRoom Desktop is a client of the same application services as the browser, CLI, MCP, and direct API. It adds operating-system capabilities; it does not add a local server, a second deck model, or its own AI provider. Desktop embeds the Claude and Codex harnesses and adds an API-key host that calls a provider directly, so the teacher chats inside OpenRoom instead of being sent to another app. Claude and Codex use the teacher's own subscription sign-in. The API-key host uses the teacher's own key: it is encrypted with the OS keychain, stays on that computer, and is sent only to the provider it belongs to — never to OpenRoom, never into the environment of the subscription harnesses. Each deck has a local persistent agent workspace and chat history under Desktop's application data; vendor resume handles reconnect follow-up turns after reopening the deck. School attachments stay on this computer in a separate temporary area that is removed on close or restart; referenced folders are read in place and never copied. The hosted control plane still stores only the typed outline, so agent workspaces and transcripts remain local to this device.

## File contract

`.openroom` is a teacher-owned ZIP package, like a PowerPoint file. It contains a versioned `deck.yaml` manifest plus copied bytes under `resources/`:

- `fileId` is a stable UUID and survives rename or move.
- `localRevision` advances on an atomic native save.
- `remote` links the file to one online deck and records the common outline used for deterministic three-way merge.
- `resources` maps stable UUIDs to a package path, original display name, MIME type, byte count, and SHA-256. Entries cannot be absolute or escape `resources/`.
- Embedded PDF, PNG, JPEG, WebP, GIF, and AVIF resources are capped at 20 MiB each, 50 MiB total, and 100 entries. SVG is rejected.
- Desktop can open a source PDF up to 100 MiB, extract an inclusive page range locally, and put only that smaller PDF into the package. The source PDF is not copied or uploaded.
- A resource gains a retained R2 asset id only when a linked deck is synced online. A local-only file remains local until the teacher starts a synchronized session.

The executable contract and merge algorithm live in `packages/schema/src/openroom-file.ts`. The visual deck editor never exposes YAML; API, CLI, MCP, and file clients still exchange the serialized contract.

## Native responsibilities

`apps/desktop` is an Electron shell around the built React host client (`apps/host`, copied in by `apps/desktop/scripts/copy-host.mjs`). The deck editor, presenter and live console in that client come from `packages/editor`; the host wraps the document window (`#/desktop/file`) in `DesktopFileEditorServices`, which offers no draft saves, learner work or brand kits because a local file has no space or person. The editor reaches the preload bridge only as the `desktop` member of `EditorServices`. It owns:

- macOS and Windows `.openroom` file association;
- one native window per open file and OS recent documents;
- explicit Save and Save As using write, fsync, and atomic rename;
- a private recovery copy under Electron `userData`, removed after a successful save;
- verified package extraction and local embedded-resource resolution without exposing filesystem access to the renderer;
- display enumeration and a separate full-screen audience window;
- a presenter strip on the teacher window, with keyboard and button navigation;
- an allowlisted same-origin `/api` proxy to the configured OpenRoom origin;
- running an agent chat through the embedded Claude or Codex harness, or the in-process API-key host, against the open file through the desktop MCP socket. Auth is the teacher's own subscription sign-in or their own provider API key; the key is stored in the OS keychain and reaches only that provider.

The renderer has context isolation, sandboxing, no Node integration, and a narrow preload bridge. Offline file editing and offline presentation require no account. The online workspace remains the hosted client and uses the ordinary `or_session` credential boundary. Google sign-in is the browser-only interactive authentication: Desktop opens `/api/auth/google?desktop=1` in the system browser and receives the session back on `openroom://auth/desktop?ticket=`. It does not forward Google’s own redirect, which would split the PKCE cookie.

An open file takes a `{file}.openroom.lock` (`host: desktop`). The app also listens on `mcp.sock` under userData. `openroom mcp` probes that socket first and reverse-proxies JSON-RPC there; if the app is not running it hosts the file itself, or falls through to `https://openroom.app/api/mcp`. Headless will not write a file the window has open. Desktop-launched CLIs talk to the same socket through a stdio sidecar (`ELECTRON_RUN_AS_NODE`), so they do not need `openroom` on PATH.

## Link and sync

The first “Put online” action requires a context, space, and optional folder. It creates the deck through the normal control-plane API while binding the existing `fileId`.

A linked file checks the deck on focus and every 30 seconds with `If-None-Match`. No sync Durable Object exists. D1 stores immutable deck versions and the link/location metadata; `SessionDO` remains only for a live session.

When a linked file first syncs an embedded resource, Desktop uploads those bytes to the space's retained R2 media library and records the asset id beside the package hash. When a local-only file starts a synchronized session, Desktop instead uploads the referenced bytes directly to that session's Durable Object in 1 MiB SQLite BLOB chunks. Start is refused until every referenced resource is present. Those live-only bytes follow the session lifecycle: ballot data is purged after 30 minutes and `storage.deleteAll()` removes the complete session, including resources, 24 hours after it ends. Local `Present` does not upload anything.

Reconciliation uses content hashes and the common `baseOutline`:

- one-sided changes apply automatically;
- independent edits merge by stable step and interaction ids;
- overlapping edits, edit/delete, and competing order stop for a teacher choice;
- multiple offline saves become one online version when the client reconnects;
- a path report is scoped to the reporting user, so the browser deck editor can say where that user's latest local copy was seen without leaking it to collaborators.

## Build

```bash
bun desktop         # local worker on http://127.0.0.1:8787, then the Desktop client
bun run --filter openroom-desktop start
bun run --filter openroom-desktop make
```

`OPENROOM_ORIGIN` selects the hosted control plane and defaults to `https://openroom.app`. `bun desktop` binds the worker on every interface and points Desktop at `http://<your-LAN-IP>:8787` so phones on the same Wi-Fi can open the join link. Sign-in there uses the local demo accounts (`alice` / `bob` / `cara`, password `demo`) — not Google. Override the origin with `OPENROOM_ORIGIN` if you need a specific address.
Packaged Mac/Windows clients check `OPENROOM_UPDATE_URL` (or the reserved `/desktop/updates/{platform}/{arch}/{version}` path on that origin) after one minute and every four hours. The feed must use HTTPS. A pending check cannot start a second download; synchronous and asynchronous failures produce a fixed diagnostic and permit a later retry. A downloaded update waits for the next normal launch, preserving the teacher's control over open decks. This follows the [Electron updater lifecycle](https://www.electronjs.org/docs/latest/api/auto-updater). The default server endpoint and public update feeds are not implemented yet.

### Local packages and signed release candidates

`make` stages the built renderer, main/preload bundles, local-agent skills and real
agent runtime files in `apps/desktop/.forge-app`. Its explicit Forge project marker
prevents Forge from walking up and packaging workspace dependency symlinks. The
staged app reads its product version from `apps/desktop/package.json` and pins the
Electron version installed by the lockfile. One shared Forge configuration owns
packaging, file association, signing and makers. Agent executables remain unpacked.
Outputs are under `.forge-app/out/`; a Mac ZIP is under
`.forge-app/out/make/zip/darwin/{arch}/`.

An ordinary Mac `make` uses an ad-hoc signature unless
`OPENROOM_MAC_SIGN_IDENTITY` is set. For a distributable release candidate, run
`bun run --filter openroom-desktop make:release` on the target operating system and
architecture. It validates the following configuration before building:

| Platform | Required environment variables |
| --- | --- |
| macOS | `OPENROOM_MAC_SIGN_IDENTITY` (an installed `Developer ID Application: …` identity), `OPENROOM_APPLE_API_KEY` (absolute path to a readable `.p8`), `OPENROOM_APPLE_API_KEY_ID`, `OPENROOM_APPLE_API_ISSUER` |
| Windows | `OPENROOM_WINDOWS_CERTIFICATE_FILE` (absolute path to a readable certificate file), `OPENROOM_WINDOWS_CERTIFICATE_PASSWORD` |

Mac release candidates use [Forge signing and Apple notarization](https://www.electronforge.io/guides/code-signing/code-signing-macos).
Windows candidates use the [Squirrel.Windows maker's certificate signing](https://www.electronforge.io/config/makers/squirrel.windows).
`make:release` sets `OPENROOM_DESKTOP_RELEASE=1`; missing credentials cannot silently
produce an ad-hoc release. Credentials are read from the build environment and are
not written into the staged configuration. The command builds artifacts locally;
it does not publish downloads or update feeds.

Native verification can exercise the actual executable instead of the development
shell. From `e2e`, set `RUN_DESKTOP_JOURNEY=1` and
`OPENROOM_DESKTOP_EXECUTABLE` to the packaged executable's absolute path, then run
the UC-11, UC-25 and UC-28 journeys. Each launch gets an isolated profile and checks
`app.isPackaged`; the same flows cover file edits/save/reload, audio playback and
transcripts, portable design assets, and an audience window. For entirely offline
checks, point `OPENROOM_URL` at an unused loopback port such as
`http://127.0.0.1:18789`.

Public distribution still requires signed/notarized native builds, real installation
and upgrade tests, update-feed hosting and release CI. Windows installer lifecycle,
file associations and taskbar integration also need implementation/native acceptance;
the Mac ad-hoc package is not evidence for those Windows behaviors.

The Claude and Codex harnesses are found on the teacher's own computer: Desktop adopts the login shell's PATH at startup, because a launch from Finder, the Dock, or Spotlight inherits only the system directories, and it also looks in the usual Homebrew, nvm, volta, bun, and npm-global locations. A CLI that runs but is too old is reported as such instead of being shown as missing. Desktop never runs `npm install` on a teacher's computer and never downloads a runtime in the background.

The API-key host needs no CLI: it runs in the main process on the Vercel AI SDK and talks to OpenAI, Google, Anthropic, Mistral, Groq, OpenRouter, or Cloudflare Workers AI. Model ids are the AI SDK's own `provider:model` composites, so the picker value and the registry lookup are the same string; the picker also accepts a typed id for anything not in the starter list. Keys live in `agent-keys.json` under Desktop's application data, encrypted with Electron `safeStorage` and written `0600` — the file holds no plaintext key, and a computer with no OS keychain is told so rather than falling back to plaintext. `OPENROOM_BYOK_{PROVIDER}_API_KEY` (with `OPENROOM_BYOK_CLOUDFLARE_ACCOUNT_ID` where needed) supplies a key from the environment for computers without a keychain and for CI; it is read, never written. That host gets the same MCP tool set as the CLI hosts, with the same `deck_preview` deny filter, plus one read-only `read_file` restricted to the conversation workspace and the folders the tutor referenced this turn.
