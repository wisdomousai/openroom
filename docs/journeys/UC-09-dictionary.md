# UC-09 — Live word lookup and selected forms

**Spec:** [`e2e/journeys/UC-09-dictionary.spec.ts`](../../e2e/journeys/UC-09-dictionary.spec.ts)

## Purpose and fixture

A tutor explains a French word while teaching from a deck. The private lookup card
belongs to the tutor; choosing a translation or forms changes the audience's card
only after an explicit publication. Replacing a card is one operation.

The two-slide fixture begins with “Je rate le train”. Dictionary responses are fixed:
`rate` resolves to `rater`, “to miss”, a present-tense table and a past participle;
`train` resolves to a noun. The first request is deliberately delayed. Session launch,
live commands, projection, WebSockets and participant joining use the local Worker.

## Surfaces and lifecycle

Open the deck editor and start through the browser presenter. Open an isolated
projector and a 390-pixel learner phone. Use the actual ink layer's right-click menu
and the Review ribbon's “Look up a word” action. Do not bypass the ink layer with a
forced click on text beneath it.

## Acceptance

- Closing a loading card cancels its request. A late response cannot replace a newer
  word, change its chosen meaning or publish anything.
- Lookup results and selected forms remain private until the tutor publishes them.
- Forms start unchecked. Only explicitly selected sections appear on the audience card.
- Starting another lookup exposes the original slide to the tutor while the current
  audience card stays visible. Cancelling that selection restores the tutor's mirror.
- Publishing replaces the complete meaning and forms together. A failed command leaves
  the previous card visible, retains the private draft and exposes retry.
- Typing a replacement meaning clears the old forms only when the tutor publishes it.
- Taking down a card clears both projections. Moving to another slide clears the card
  and its private lookup state. Stale-slide publication is rejected by the domain.
- The circle added during word selection remains centred on the same word on the
  projector and in both learner content views, including a resize to 320 pixels.

## Evidence and limits

The complete lookup/publication journey passed in local Chromium on 2026-09-18
(7.5 seconds), including cancelling word selection and circle alignment through
phone view changes and resizing. Host and phone screenshots were inspected: the tutor sees both form
choices, while the phone shows only the selected tense with the chosen meaning.
The first browser pass exposed a real defect: the audience card covered the tutor's
next word selection. “Look up a word” now temporarily exposes the original slide
locally without changing the audience projection.

Domain suite: 327 passed, including atomic replacement, malformed publication,
stale-slide rejection and taking down an older word without removing a different
card. Worker dictionary normalization/access suites: 37 passed; live ink/projection:
two passed. Host, stage, domain, SDK, Worker and MCP typechecks passed; host/stage/MCP
builds and Worker asset collection passed.

Upstream dictionary availability is not covered by these browser fixtures. Normalization
uses stubbed fetches in `apps/worker/test/dictionary.test.ts`; credential and language
boundaries live in `dictionary-routes.test.ts`. Learners' private dictionary lookup,
physical touch devices, Safari, freehand alignment and wrapped phrase marks need their
own acceptance. No deployment is implied.

## Running it

From `e2e`, with a local demo-auth Worker serving current built assets:

```sh
bunx playwright test journeys/UC-09-dictionary.spec.ts --project=chromium
```

`OPENROOM_URL` defaults to `http://127.0.0.1:8787`. The fixture uses the local `bob`
demo account. Repeated runs can reach the normal daily session limit; use a fresh local
test database rather than weakening the product's guard. Launch failure is asserted
before browser interactions so a quota error is reported directly.
