# UC-43 — Relay-only session

**Status:** green  
**Playwright:** `e2e/journeys/UC-43-relay-only.spec.ts`  
**Fixture:** `examples/seg-camp.yaml` · interaction `myth-great-idea`

## Purpose

An OpenRoom relay (`apps/relay`) deployed alone is a complete live system: a
presenter with the relay key creates a session, participants join on the
relay's own join page, and the stage runs on the relay. There is no
workspace, no sign-in and no D1.

`bun run verify:browser` starts a relay-only runtime on its own port and passes
`OPENROOM_RELAY_URL` and `OPENROOM_RELAY_KEY` (`dev-relay`). Without both, the
journey is skipped.

## Surfaces

| Phase | Stage (relay `/stage/`) | Participant (relay `/join/`) |
| --- | --- | --- |
| Open + 3 answers | Pending counter with 3; no bars | Joined, answered by tapping an option |
| Revealed | Two bars; correct option marked | Results region with both labels |

## Lifecycle

1. `POST /api/sessions` with `Authorization: Bearer <RELAY_KEY>` and the `seg-camp` outline.
2. `session.start`, `interaction.open` · `myth-great-idea` (host token).
3. One browser participant joins on the relay join link and picks the correct option.
4. Two API participants join anonymously and answer `true-hardest` and `false-execution`.
5. `interaction.close`, `interaction.reveal`.
6. `GET /api/sessions/<code>/export?format=ballots` with the host token.

## Acceptance criteria

- `GET /api/health` is `{ status: 'ok' }`.
- Session creation without the key or with a wrong key → 401; with the key → 201 and join link `/join/?code=…`.
- The relay has no host app (`/host/` → 404) and no workspace API (`/api/me` → 404).
- `POST /api/join` with a context link → 403 `identified-join-unavailable`.
- Stage: `3 answers` and no bars before reveal; two bars and the correct mark after.
- Participant: Results region with both option labels after reveal.
- Ballots export: three rows for `myth-great-idea`.

## Visual notes

Same stage and participant bundles as the hosted product; UC-01 owns the reveal visuals.
