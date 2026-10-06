# UC-01 — Hidden-until-close choice → reveal

**Status:** green  
**Playwright:** `e2e/journeys/UC-01-choice-reveal.spec.ts`  
**Fixture:** `examples/seg-camp.yaml` · interaction `myth-great-idea`

## Purpose

A host runs a concept check with a correct answer. While voting is open
(and after close, before reveal), the **projector and phones must not show the
tally** — only that answers are coming in. When the host reveals, the
session sees the distribution and the correct option marked so the discussion can
land. The host console always sees live counts so they can decide when to close.

**The teacher closes.** A question countdown (`timerSec` → `closesAt`) is
advisory only: zero does not auto-close answering. Close is
`interaction.close` from the host (UI: **Close answering**). Reveal is a
separate, later step.

This is the product's fundamental reveal contract (PRD STAGE-03, API-06):
results are a deliberate teaching moment, not a live scoreboard by default.

## Surfaces

| Phase | Stage | Host | Participant |
| --- | --- | --- | --- |
| Open + N answers | Pending counter with N; no option bars; summary says results are hidden | Header live counts (joined / answered). Desk is a **stage-mirror**: same hidden pending as stage | Prompt + answer UI; no results section |
| Closed (pre-reveal) | Still pending; same N | Same header counts; desk still hidden | Closed/waiting copy; no aggregate |
| Revealed | Choice bars for every option; correct option has multi-signal mark; aria-live summary lists labels + % | Desk matches stage (bars + correct). Teacher closed, then revealed (`Call out the correct answer`) | `The class so far` region with labels + counts + correct mark |

## Lifecycle (API seed)

1. `POST /api/sessions` with the validated `seg-camp` outline.
2. `session.start`
3. `interaction.open` · `myth-great-idea`
4. Join 4 participants; submit answers:
   - 2 × `true-hardest`
   - 2 × `false-execution` (correct)
5. Assert UI (open phase).
6. Teacher closes: `interaction.close` (never an elapsed countdown) → assert still hidden on stage/participant.
7. `interaction.reveal` → assert bars + correct on all three surfaces.

## Acceptance criteria

1. **Pre-reveal stage:** body contains “hidden” (or pending framing) and does **not** show option labels as result bars (`True — the idea…` / `False — finding…` absent from the viz summary as percentages). Answer count is 4.
2. **Pre-reveal participant:** no `aria-label="The class so far"` region (or equivalent results section).
3. **Post-reveal stage:**
   - Option labels visible.
   - Summary (`role="status"`) includes total answers and both option labels with percentages (50% / 50% for this seed).
   - Correct option marked with “correct” (tag text) — not colour alone.
4. **Post-reveal participant:** `The class so far` region shows both labels and a correct mark on the execution option.
5. **Host:** header shows live joined / answered counts while voting is open. The desk is a stage-mirror — hidden until the teacher closes and reveals; after reveal, same bars + correct mark as stage.
6. **No shadow/gradient regression** is not asserted in Playwright; it remains a design-system rule. Journeys assert structure and copy.

## Visual notes

- Bar grammar: label + tabular count/% above full-width bordered track; solid `--chart-N` fills.
- Correctness: ✓ + “correct” text (stage tag); never colour alone.
- Waiting: honest copy, not empty tracks pretending to be zero votes.
- Flat design: solid fills only.

## Seed numbers (fixed)

| Option | Votes | Share |
| --- | --- | --- |
| True — the idea is the hard part | 2 | 50% |
| False — finding a customer who pays is the hard part | 2 | 50% (correct) |

## Out of scope for this UC

- Peer-instruction dual-round (UC-03).
- Live visibility while open (UC-02).
- Don't-know ballots.
- Display styles other than `bars`.
