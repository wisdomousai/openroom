# OpenRoom for PowerPoint

Insert **OpenRoom Slide** from PowerPoint's Add-ins menu. Choose any slide from an
OpenRoom deck inside the embedded surface, or paste a code copied with **Copy embed
code** in the OpenRoom editor. Content, freeform objects, media, exercises, questions,
and detail slides all use the shared audience renderer. Choosing a slide previews it
immediately without starting participation. No OpenRoom slide type is excluded.

The task pane provides the same picker and paste field, plus session controls.
Choosing there also configures a subsequently inserted OpenRoom Slide without a
second connection step. Start session gathers the selected OpenRoom slides in native
presentation order into one frozen session and audience code. A visible content
add-in in Slide Show requests activation through the signed-in pane; questions open
responses, while other slides run their usual behavior. Editing never activates a
live question. Repeated activation notifications do not reopen a question the host
has closed. The companion remains available when Office cannot deliver the events
or share the runtime channel.

This build is not a released Office add-in. Native cross-webview communication,
slideshow lifecycle, full-presentation copy handling, and marketplace distribution
still require native acceptance. Verification for this change is headless; it does
not launch PowerPoint or OpenRoom Desktop.

## Install locally on a Mac

From the repository root:

```sh
bun run office:install
```

This installs Microsoft's localhost development certificate, builds the apps,
starts `https://localhost:3443`, and installs both manifests in PowerPoint's
`~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef` directory.
Restart PowerPoint, open a presentation, and choose **Home → Add-ins**. The two
entries are **OpenRoom for PowerPoint** and **OpenRoom Slide**.

Keep the command running while using these local add-ins. On later runs use
`bun run dev:office`; add `--skip-build` when the current apps are already built.
The server binds only to this Mac. Phones cannot join its local sessions.
Local demo sign-in is `alice` / `demo`; its data persists in the ignored
`.wrangler/office/state` directory. This environment does not load the developer's
provider secrets or production configuration. It is separate from normal local
development and disposable browser verification.
The connection dialog offers **Sign in with demo account** on this local server.
Google is offered only when configured. Signing in returns to a fresh consent form;
the connection is created only after approving access for the signed-in account.

Microsoft's development certificate expires after 30 days. Run the install
command again to renew it. To remove only these local add-ins, delete
`openroom-taskpane.xml` and `openroom-display.xml` from the `wef` directory and
restart PowerPoint. Removing manifests does not delete presentations or local data.
The workflow follows Microsoft's [Mac sideloading instructions](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac)
and [development certificate utility](https://github.com/OfficeDev/Office-Addin-Scripts/tree/master/packages/office-addin-dev-certs).

The development Mac is now activated with the user's personal Microsoft 365 licence.
Connected experiences are enabled, and OpenRoom Slide runs inside a
native slide. The control-pane picker has not responded to automated selection;
the task-pane manifest now also supplies a direct **Home → OpenRoom** ribbon button.
Native authentication, live connection and save/reopen acceptance remain unfinished.
The installation command does not change Office policies or account settings.

## Build and local verification

From the repository root, `bun run build` includes the Office app and copies it
to the Worker's assets. The dedicated routes are `/office/taskpane.html`,
`/office/callback.html`, `/office/content.html` and `/office/display.html`.
`/office/manifest.xml` describes the task pane; `/office/content-manifest.xml`
describes the content add-in. Both use the current deployment origin; the callback
must match that origin exactly.

For the isolated Chromium journey, start the local Worker with an explicit
upstream matching its listening origin. Custom-domain routes otherwise make
Wrangler expose the production hostname inside the local request:

```sh
cd apps/workspace-worker
bunx wrangler dev --local --ip 127.0.0.1 --port 8787 --local-upstream 127.0.0.1:8787 --persist-to /tmp/openroom-office-dev
```

Apply the current D1 bootstrap to that same local persistence directory first.
Run `UC-34-powerpoint-connection.spec.ts`, `UC-35-powerpoint-live.spec.ts` and
`UC-36-powerpoint-display.spec.ts` from `e2e` with
`OPENROOM_E2E_PERSIST_TO=/tmp/openroom-office-dev`. The journey simulates only the
Office host adapter; consent, callback, token exchange, account APIs and Settings
are real. It does not prove native Office behavior or the Google sign-in provider.

Actual Office verification needs trusted HTTPS and a sideloaded manifest; use
the matching HTTPS origin throughout. Follow Microsoft's [testing overview](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/test-debug-office-add-ins).
Do not distribute a local HTTP manifest or treat sideloading as store approval.

Manifest validation uses Microsoft's `office-addin-manifest validate` against an
HTTPS localhost origin. The control pane uses manifest version 1.0.1.0 with a
ShowTaskpane ribbon command; the slide content add-in is at 1.0.1.0. Both use 32/64-pixel PNG
icons. The add-in remains unreleased. Local HTTPS health and both manifest origins
were verified with certificate validation enabled.

## Rehearsal and the embedded display

- Rehearse selected slide loads the saved slide once and runs commands in
  memory. Three sample responses cover choice, scale, numeric, text, Q&A, ranking,
  gaps and matching, including group response questions. Close, reveal, reopen,
  countdown expiry and reset stay local. No live session is created or modified.
- The preview frame uses the same `StageView` as the projector. Its state uses
  `packages/domain/src/wire-snapshots.ts`, also used by the Worker. Correct answers
  become available only at reveal; private notes stay excluded.
- After sideloading the manifests, insert **OpenRoom Slide** using PowerPoint's
  Add-ins menu. Sign in and choose a slide, or paste its embed code. The code is a
  versioned deck/slide reference, never a credential. Access is checked by the
  ordinary deck API. A local file must be saved to a workspace before PowerPoint
  can resolve its code. Copying a code saves the current editor content first.
- The embedded picker runs in a same-origin frame and uses its containing Office
  runtime for document operations. Only the audience projection and public binding
  return to the content surface; account credentials stay in the picker runtime.
- Inserting the native content-add-in shape still uses PowerPoint's Add-ins menu;
  the task-pane API does not create that shape. No fake image or link substitutes
  for the embedded slide.
- The pane sends stage-role snapshots through a same-origin `BroadcastChannel`.
  The content add-in fetches no account or live API and receives no account, host
  or stage token. Its document settings contain only the public slide reference.
  It checks the selected native slide binding and current public session reference
  before accepting a publication. A slide can preview before participation; live results are accepted only for its own current composed step.
- Runtime communication must be proven on each native Office host. Same-origin
  browser fixture success does not prove that separate Office webviews share a
  broadcast partition. Keep the pane open; use its browser audience-display link
  when embedded communication is unavailable. Hidden/closed pane and slide-show
  lifecycle are still native acceptance work.
- The content manifest sets `AllowSnapshot` to false so Office does not save an
  image of live audience responses into the presentation. See Microsoft's
  [content add-in guidance](https://learn.microsoft.com/en-us/office/dev/add-ins/design/content-add-ins)
  and [snapshot setting](https://learn.microsoft.com/en-us/javascript/api/manifest/allowsnapshot).

UC-36 uses a simulated Office adapter with real local account/live services. It
checks zero rehearsal writes, sample percentages, private-note and unrevealed-answer
protection, content settings, live reveal/hide and copied-slide rejection. Narrow
rehearsal and embedded-result screenshots were inspected. It does not prove actual
`.pptx` persistence, cross-webview communication or Office installation.

## Document and credential boundary

- Office.js requires PowerPointApi 1.5 for selected slides and DialogOrigin 1.1
  for origin-verified dialog messages. Unsupported hosts get an explicit fallback.
- OAuth uses a same-origin dialog, random state and S256 PKCE. Access tokens live
  only in the task-pane runtime. Reloading requires reconnecting; Settings can
  revoke an abandoned connection. There are no document or browser-storage secrets.
- `OPENROOM_PRESENTATION` is a random presentation reference.
  `OPENROOM_ACTIVITY` contains only version, presentation ID, original slide ID,
  space ID, deck ID and step ID. References do not grant access.
- `OPENROOM_SESSION` contains only version, presentation ID and session ID.
  It is written before Start is sent; retries reuse that ID and the same audience.
  Resume after reconnecting checks current account and space access before issuing
  live capabilities. Ended sessions remain ended; a new audience gets a new ID/code.
  No join code, account credential or session capability is stored in file tags.
- Selecting a slide while editing never sends a live command. Showing it in Slide Show, or choosing Show selected slide in the pane,
  rechecks its binding against the frozen composition; an already-current question is a no-op.
  Revisiting a question reopens answers and keeps existing responses. The session
  keeps its captured questions and source versions; reconnecting a slide does not edit live content.
- Start collects every embedded OpenRoom slide in native presentation order. Source
  decks must belong to one space and share the same optional context and participant
  identity setting. Unconnected PowerPoint slides stay in PowerPoint.
- The durable session stores a frozen activity composition. Native slide references
  map to session step IDs; matching IDs in different decks and a reconnected copy
  each have independent answers. Reordering or deleting slides does not reinterpret
  existing responses. Newly connected/replaced activities need a new session.
- Each selected slide retains attached detail slides, its answer policy and its
  source palette, fonts, backgrounds and masters. Only selected slides and their attached details enter the
  session. Session-wide settings and the shared slide aspect ratio come from the
  first connected activity. Notes/results remain reachable from that source deck.
- A new audience captures the current slide order and saved source versions. Start
  retries reuse the frozen composition, including after an interrupted allocation.
  Presenters can start directly without creating a second library deck.
- The adapter rechecks selected slide identity and the previous tag immediately
  before writing. A copied slide with a different native ID is never silently
  treated as the original. The user reconnects it explicitly.
- Presentation tags can travel with a whole copied file. Full-file identity and
  reuse behavior still need native-host verification. Recovery is an explicit action;
  a copied presentation can explicitly start a new audience instead.
- The pane checks account access and the current saved slide before embedding.
  It does not upload or inspect the original PowerPoint slide content.
- Only `/office/*` gets an Office embedding policy. Account, learner, consent and
  other application surfaces retain their separate policies.

The backend security contract is in `mcp-oauth.ts`, `oauth-connections.ts` and the
session capability verifier. Removing access also denies host commands issued
through that connection, without ending the live session or changing participants.
