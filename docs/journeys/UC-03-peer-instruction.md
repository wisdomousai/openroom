# UC-03 — Peer instruction (optional advanced)

**Status:** green  
**Playwright:** `e2e/journeys/UC-03-peer-instruction.spec.ts`  
**Fixture:** `examples/peer-instruction.yaml` · `vote-1`

## Purpose

Optional second-vote cycle for people who really want Mazur-style discussion.
**Default product path is not this** — it is Show results → Next (`docs/AGENT.md`).

Close is teacher-initiated (`interaction.close` / **Close answering**). A
question countdown reaching zero is advisory and never auto-closes the vote.

## Host flow

| State | Primary (always) | Advanced (outline only) |
| --- | --- | --- |
| Open / closed | **Call out the correct answer** | Close answering · **Second vote** (PI + closed first vote) |
| Second vote | **Call out the correct answer** | **Back to first vote** |
| Revealed | Next | **Back to first vote** still available |

## Surfaces

| Phase | Stage | Host | Participant |
| --- | --- | --- | --- |
| First vote open | Counter | Live bars | Vote UI |
| Closed (no second vote yet) | Talk-it-over if PI | Live bars + optional Second vote | Discuss cue if PI |
| Second vote | Counter | Live bars + Back to first vote | Second-vote cue |
| Revealed after second vote | Calm was→now | Same shift | Same was→now |

## Acceptance

1. Primary button is never forced into a discuss/revote path — always Call out the correct answer / Next.
2. **Back to first vote** restores archived tallies after a second vote.
3. Reveal after second vote: label + `% → %` + two bars + sample sizes only.
4. Outlines without `peerInstruction` never show Second vote.

## Domain

- `interaction.revote` / `interaction.undoRevote` only when the outline opts in.
