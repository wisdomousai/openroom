# UC-30 — Workshop sequences and shared group responses

Status: green in local Chromium (2026-09-18).

The facilitator can add a complete workshop sequence to an ordinary deck, edit its
questions, then collect a single shared response from each explicitly assigned group.

## Editor journey

1. Open a new deck and choose the Business design family.
2. Open New slide → Workshops and insert each of the six sequences.
3. Verify slide references, slide count, inherited design and visible content fit.
4. Change a group question to Individual, wait for Saved and read the acknowledged
   draft. Reload and verify the response mode persisted.
5. Restore One per group and inspect every inserted slide.

## Live journey

1. Open a group text question and join three independent phone clients.
2. Create North, select two joined participants, and explicitly choose a spokesperson.
3. The spokesperson sends a shared answer. Their teammate sees the receipt and wording
   while the unassigned participant and projector still see no result.
4. Reload the teammate's phone. The shared answer and role survive.
5. Change the spokesperson. The former speaker loses the change-answer action; the new
   speaker edits the same ballot. The aggregate still contains one response.
6. Reveal to the room. Move to an individual question and answer separately from both
   group members. Each phone retains only its own unrevealed answer.
7. Dissolve the group. Earlier group responses and the two individual answers remain.

## Supporting contracts

- Group changes are host-only. Unknown members, duplicate members and a spokesperson
  outside the group are rejected. Removed IDs cannot be reused.
- A stale answer bound to the previous group is denied after moving its speaker.
- Answer-change policy, optimistic concurrency, freeze and end gates still apply.
- Hidden group-result updates reach only verified group members. A forged participant
  query parameter cannot change WebSocket tags. Pending private updates survive the
  existing simulated-wake test hook; this is distinct from a hosted idle-hibernation trial.
- Group labels and membership disappear in the normal privacy purge; anonymous aggregates remain.
- Repeated workshop insertion preserves private guidance, question content, unique
  references and YAML round-trip validity through the same writes as the editor.
- The think/discuss/revote sequence hides round one until deliberate reveal and retains
  each participant's own first answer during the second vote.

Executable browser evidence: `e2e/journeys/UC-30-workshop-groups.spec.ts`.
Focused domain/Worker tests cover authorization, projection, coalescing and retention.

This journey does not establish co-facilitator authorization, presenter ownership handoff,
selected recap export, PowerPoint integration, signed Desktop distribution, Safari,
Windows, physical phones, or a production deployment. Those remain separate plan items.

Final verification: both UC-30 journeys and all three UC-03 journeys passed in one
run. The workshop gallery, saved deck, facilitator group pane and phone receipt
were visually inspected. Artifacts: `/tmp/openroom-workshop-verified-20260918/`.
The first editor run caught a stale Saved indicator; the final run checks the
acknowledged draft immediately after Saved before reloading.
