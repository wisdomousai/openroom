# Walkthrough findings

These are observations from the local browser capture on 9 August 2026. `fixed` means the product or docs were corrected after the baseline capture; re-run the walkthrough to confirm the evidence is gone.

| ID | Severity | Status | Finding | Evidence / consequence |
| --- | --- | --- | --- | --- |
| OW-001 | low | fixed | Signed-out host bootstrap logged a 401 as a browser error | `/api/me` now returns `200 { user: null }` when signed out, so the normal host bootstrap is not a console failure. |
| OW-002 | low | fixed | Favicon was missing | Worker keeps `/favicon.svg`, serves `/favicon.ico` from it, and host/participant/stage link the SVG icon. |
| OW-003 | medium | fixed | Live host had nested `main` landmarks | Embedded `StageView` uses a `div` for the stage body so LiveHost keeps a single page `main`. |
| OW-004 | medium | fixed | New-session preview showed unlabeled sample metrics | Chart panel labels the placeholder as “Sample preview · not live answers”. |
| OW-005 | low | fixed | Live host emitted Three.js console noise | Embedded stage-mirror skips WebGL ambient; WebGL probe no longer calls `loseContext()`. |
| OW-006 | medium | fixed | Journey status board disagreed with shipped UC-05 | `docs/journeys/README.md` UC-05 row now matches session Q&A (`UC-05-session-qna.spec.ts`, green). |
| OW-007 | medium | fixed | Session-wide Q&A was not discoverable in the browser editor | Session settings expose an Audience Q&A toggle that writes `qna.enabled`. |
| OW-009 | high | fixed | Browser-started launch hit local D1 schema drift | Authoring sign-in, deck save, and version save succeed; `POST /api/sessions` returned 500 because local `sessions` lacked `deck_id`. Applied locally with `wrangler d1 migrations apply openroom --local`. |
| OW-010 | high | fixed | Tutor create forms never submitted | Trace shows the context form filled and Save visible, but no create POST. Host `Button` defaults to `type="button"`; Context, deck and session form primary actions omitted `type="submit"`, so click Save was a no-op. |

The raw evidence is under each journey in `output/`: `browser-issues.json`, `cli-console.txt`, `cli-requests.txt`, snapshots, traces, and the captured WebM. `src/findings.ts` is the machine-readable catalog used by `run.sh validate` and `run.sh list`.
