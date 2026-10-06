# OpenRoom narrated walkthroughs

This directory is the product walkthrough, not the regression suite. It drives a real browser through the local OpenRoom worker with the Playwright CLI, records screenshots, snapshots, traces, and video, then turns the chapter narration into MiMo audio.

The scenarios and starting outlines are data. Add or change a walkthrough by editing `scenarios/*.json` and, when needed, `seeds/*.json`. The TypeScript under `src/` is the reusable runner, API seeder, MiMo adapter, renderer, and verifier; it should not become a second list of product journeys.

## Prerequisites

- the OpenRoom worker running at `http://127.0.0.1:8787` (or set `OPENROOM_URL`)
- local D1 migrations applied (`cd apps/workspace-worker && bunx wrangler d1 migrations apply openroom --local`)
- Bun, `npx`, FFmpeg, and FFprobe
- local demo credentials enabled by the worker when using authoring journeys
- `docs/walkthrough/.env.local` containing the MiMo key for narration

The key file is ignored. Copy `.env.local.example` only if you need a fresh local configuration.

## Commands

```sh
docs/walkthrough/run.sh list
docs/walkthrough/run.sh validate
docs/walkthrough/run.sh capture public-discovery
docs/walkthrough/run.sh capture live-classroom
docs/walkthrough/run.sh narrate live-classroom
docs/walkthrough/run.sh render live-classroom
docs/walkthrough/run.sh verify live-classroom
```

`capture` seeds a new session when a scenario declares a seed. It does not reuse a previous session. `narrate` caches each chapter by its narration, voice, model, and style hash. `render` combines the captured WebM and chapter MP3 files into an MP4 plus a VTT caption file.

For a complete pass over every scripted scenario:

```sh
docs/walkthrough/run.sh all
```

That is intentionally explicit because it opens several browser sessions and calls the TTS provider. Run one journey first when the machine is under memory pressure.

## Output boundary

All generated artifacts stay under `docs/walkthrough/output/<journey-id>/`:

- `screenshots/` and `snapshots/` for chapter evidence
- `<journey-id>.webm` and `.playwright-cli/traces/` for the browser capture
- `audio/`, `audio-manifest.json`, and cached chapter metadata for MiMo
- `<journey-id>.mp4` and `<journey-id>.vtt` after rendering
- `browser-issues.json`, `timeline.json`, and verification metadata

The output is ignored and there is no repository-root `/output` directory.

## Coverage and findings

`src/inventory.ts` records implemented, planned, and deliberately unavailable product surfaces. `src/findings.ts` records the inconsistencies observed during the baseline capture; the open set from that capture is now marked fixed in `FINDINGS.md` (signed-out `/api/me`, favicon, live-host landmarks, sample preview labeling, WebGL console noise, journey status board, Q&A editor toggle, local D1 drift, and tutor submit buttons).

The verifier reports browser issues rather than hiding them. To inspect the artifact while allowing known browser-console noise to pass, use `WALKTHROUGH_ALLOW_BROWSER_ISSUES=1`. Set `WALKTHROUGH_REQUIRE_NARRATION=1` and `WALKTHROUGH_REQUIRE_RENDERED=1` for a strict narrated-deliverable gate.
