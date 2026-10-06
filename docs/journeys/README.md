# Journey contracts

OpenRoom's results surfaces (stage, host console, participant phone) must
tell the **same story** at three scales. This directory is the source of that
story: each use case is a written contract; each contract is enforced by a
Playwright journey under `e2e/journeys/`.

## Loop

```
document → encode as Playwright → fix UI until green → only then next UC
```

1. Write `docs/journeys/UC-NN-*.md` (status: **draft**).
2. Add `e2e/journeys/UC-NN-*.spec.ts` that fails against current UI (**red**).
3. Change product UI until the journey passes (**green**).
4. Commit contract + test + UI together.

Domain math, reveal security, and HTTP/WS behaviour stay in vitest
(`packages/domain`, `apps/worker/test`). Playwright owns **browser visibility
and visual grammar**, not aggregate arithmetic.

## Visual north star

Stage leads. Console and pocket apply the same ink (DESIGN.md — *The Inked
Scoreboard*): solid chart fills, 1px borders, label + tabular count/% above a
full-width track, multi-signal correctness, honest empty states. Peer instruction
shows both rounds after reveal (hollow R1 / solid R2). No shadows, gradients, or
glow in chart marks or application furniture. Authored deck backgrounds, masters
and themes are document content and may use the saved design system's gradients.

## Status board

| ID | Journey | Fixture | Spec | Status |
| --- | --- | --- | --- | --- |
| UC-01 | Hidden-until-close choice → reveal (teacher closes) | `examples/seg-camp.yaml` · `myth-great-idea` | `e2e/journeys/UC-01-choice-reveal.spec.ts` | green |
| UC-02 | Live choice while open | `examples/seg-camp.yaml` · `pulse-check` | — | planned |
| UC-03 | Peer instruction (discuss, revote, undo, calm reveal) | `examples/peer-instruction.yaml` · `vote-1` | `e2e/journeys/UC-03-peer-instruction.spec.ts` | green |
| UC-04 | Ranking Borda | `examples/ranking.yaml` | — | planned |
| UC-05 | Session-wide audience Q&A (ask, upvote, moderate, spotlight) | `examples/seg-camp.yaml` + `qna.enabled` | `e2e/journeys/UC-05-session-qna.spec.ts` | green |
| UC-06 | Library: tree → select → rename → move → Open | demo space + seeded session | `e2e/journeys/UC-06-library.spec.ts` | green |
| UC-07 | Tutoring privacy: identified join + learner allowlist | identified session + context link | `e2e/journeys/UC-07-tutoring-privacy.spec.ts` | green |
| UC-08 | Deck editor: insert → layout → type → reveal → breakout → draft | tutoring outline | `e2e/journeys/UC-08-deck-editor.spec.ts` | green |
| UC-09 | Private dictionary lookup, selected forms and atomic word cards | delayed lookup + retry + projector/phone | `e2e/journeys/UC-09-dictionary.spec.ts` | green in Chromium; upstream dictionary fixture |
| UC-10 | Standalone presenter and portable download | new deck | `e2e/journeys/UC-10-standalone-presenter.spec.ts` | green |
| UC-11 | Local Desktop file, audience window, save/reload | local file, Paper 4:3 | `e2e/journeys/UC-11-desktop-file.spec.ts` | green on macOS development build |
| UC-12 | Tutoring, Classroom and Training spaces | three experiences | `e2e/journeys/UC-12-workspace-experiences.spec.ts` | green |
| UC-13 | Saved masters and readable mobile view | design + French/German | `e2e/journeys/UC-13-deck-design.spec.ts` | green |
| UC-14 | All slide templates, gallery and persistence | 24-template catalog | `e2e/journeys/UC-14-slide-templates.spec.ts` | green |
| UC-15 | Private group work, link replacement and revocation | two learners | `e2e/journeys/UC-15-learner-links.spec.ts` | green |
| UC-16 | All homework question formats | bilingual phone practice | `e2e/journeys/UC-16-homework-practice.spec.ts` | green |
| UC-17 | Writing review and published feedback | private draft + resubmission | `e2e/journeys/UC-17-writing-feedback.spec.ts` | green |
| UC-18 | Voice recording and timed feedback | private audio + retry + removal | `e2e/journeys/UC-18-voice-homework.spec.ts` | green in Chromium; physical devices pending |
| UC-19 | Shared and individual assignments | group homework + private recipients | `e2e/journeys/UC-19-individual-assignments.spec.ts` | green |
| UC-20 | English/French/German learner interface | preserved drafts + private audio + errors | `e2e/journeys/UC-20-learner-languages.spec.ts` | green in Chromium |
| UC-21 | Complete French/German sample lessons | folder/context + slides + self-contained homework | `e2e/journeys/UC-21-language-lessons.spec.ts` | green for French B1 and German B2 |
| UC-22 | Practice retries and revised assignments | original answers + explicit refresh + withdrawal | `e2e/journeys/UC-22-practice-revisions.spec.ts` | green in Chromium |
| UC-23 | Selected practice in the next lesson | complete exercise keys + private work + presenter-to-Notes | `e2e/journeys/UC-23-practice-next-lesson.spec.ts` | green in Chromium |
| UC-24 | Listening, transcript release and presenter handoff | cloud upload + room/individual playback + retry + phone remote | `e2e/journeys/UC-24-listening.spec.ts` | green in Chromium |
| UC-25 | Portable listening recordings | WAV/MP3/M4A + offline reopen + seek + audience window | `e2e/journeys/UC-25-desktop-listening.spec.ts` | green on macOS development build |
| UC-26 | Annotated reading and controlled reveals | wrapped phrases + 4:3 pen + phone views + reverse reveals | `e2e/journeys/UC-26-annotations-reveal.spec.ts` | green in Chromium |
| UC-27 | Uploaded design images and portable copies | master background/logo + failed export/retry + live delivery | `e2e/journeys/UC-27-design-assets.spec.ts` | green in Chromium |
| UC-28 | Offline design images | native import + independent package/profile reopen + audience window | `e2e/journeys/UC-28-desktop-design-assets.spec.ts` | green on macOS development build |
| UC-29 | Classroom template sizes and themes | 24 templates × six families × three aspects | `e2e/journeys/UC-29-classroom-designs.spec.ts` | green in Chromium |
| UC-34 | PowerPoint connection and slide references | real consent/PKCE + simulated Office adapter + copied slide + Settings revocation | `e2e/journeys/UC-34-powerpoint-connection.spec.ts` | green in Chromium; native Office pending |
| UC-35 | PowerPoint live control and recovery | lost start response + retained answers + reload + deck guard + companion | `e2e/journeys/UC-35-powerpoint-live.spec.ts` | green in Chromium; native Office pending |
| UC-36 | PowerPoint rehearsal and embedded display | local sample responses + stage projection + reveal/hide + copied slide | `e2e/journeys/UC-36-powerpoint-display.spec.ts` | green in Chromium; native runtime communication pending |
| UC-37 | Paddle checkout and account billing | billing API + Paddle.js fixtures; real local account | `e2e/journeys/UC-37-paddle-checkout.spec.ts` | green in Chromium; real Paddle sandbox acceptance pending |
| UC-38 | Saved result files | owner-paid capture, readable report, downloads, downgrade and membership removal | `e2e/journeys/UC-38-saved-results.spec.ts` | green in Chromium with disposable local accounts and real D1/R2/session objects |
| UC-33 | Selected workshop recap | explicit selection + stale-source refresh + preview + HTML download + privacy | `e2e/journeys/UC-33-workshop-recap.spec.ts` | green in Chromium |
| UC-32 | Shared brand kits | contrast + logo/master authoring + deck copy + trash/restore + scrolling | `e2e/journeys/UC-32-brand-kits.spec.ts` | green in Chromium |
| UC-31 | Co-facilitation and presenter handoff | shared access + moderation + remote + recovery + removal | `e2e/journeys/UC-31-co-facilitation.spec.ts` | green in Chromium |
| UC-30 | Workshop sequences and shared group responses | editing + group assignment + spokesperson handoff + private updates | `e2e/journeys/UC-30-workshop-groups.spec.ts` | green in Chromium |

Status values: `planned` · `draft` · `red` · `green`.

## Contract shape

Each journey doc must include:

1. **Purpose** — what a real host/class needs (not “bars render”).
2. **Fixture** — outline file + interaction id.
3. **Surfaces** — stage / host / participant per phase.
4. **Lifecycle** — API command sequence used by the test.
5. **Acceptance criteria** — observable assertions.
6. **Visual notes** — Inked Scoreboard rules that apply.
7. **Playwright map** — path to the spec.
8. **Status**

## Running journeys

```bash
# Terminal A — build static apps into the worker, then serve
bun run build
cd apps/worker && bun run dev

# Terminal B — against http://127.0.0.1:8787 (or OPENROOM_URL)
bun run test:e2e
```

Admin key for session create comes from `apps/worker/.dev.vars` (`ADMIN_KEY`).
Override with `OPENROOM_ADMIN_KEY` if needed.

For the OAuth journey, start Wrangler with `--local-upstream 127.0.0.1:8787` so
the request origin matches the browser despite production custom-domain routes.
UC-34 also needs `OPENROOM_E2E_PERSIST_TO` pointing to the server's local D1
persistence directory. See `apps/office/README.md` for the host-adapter boundary.
