# UC-39 — First tutoring lesson, from sign-in to the next deck

Purpose: establish that a new tutor can teach and follow up using the product's
visible controls, without a pre-populated workspace or API-created teaching records.

## Fixture and boundaries

Run with `bun run verify:browser UC-39-first-tutoring-lesson` after building the apps.
The runner creates disposable local D1/R2/DO storage and enables demo sign-in.
Cara is reserved for the first-use journey; other journeys must use another demo
account. The sample rehearsal creates its own tutoring space through the UI.

Both journeys use real browser interactions and local application services. There
is no injected authentication, database seeding, request interception or API write
in UC-39. The catalog check reads the authored YAML only to select visible answers.
Local demo authentication does not establish that Google OAuth works.

The tutor and learners run in separate browser processes. Each learner has its own
cookie/storage context and live connection. The first lesson uses a narrow learner
and a second learner at 1024 × 768; homework also runs at 320, 390 and 768 CSS pixels.
Chromium is the default learner engine. Set `OPENROOM_E2E_LEARNER_ENGINE=webkit`
to use WebKit learners with a Chromium tutor (install Playwright WebKit first).
Separate browsers are the accepted substitute for a physical phone in this
functional walkthrough. Hardware-specific touch, audio and OS behavior remain
follow-up checks; WebKit automation does not establish native Safari behavior.

## Acceptance

1. A signed-out visitor sees the enabled sign-in method and can sign in with the
   keyboard. Their empty personal Library offers an experience choice.
2. Choose Tutoring, create a student with a language level, and create a personal
   learner link. Missing names produce an announced error; no account is created
   for the learner.
3. Filter the sample gallery to French B1 and open an editable copy in the student's
   place. All twelve authored slides fit the editor.
4. Start the deck and join two independently identified learners from the separate
   learner browser. Escape dismisses the session menu without closing the presenter;
   the slide tablist supports arrows. Submit different choice answers, reload one
   learner, and verify both names and answers remain distinct. Disconnect that
   learner while the tutor advances, reconnect and continue at the current slide.
5. Walk every slide, read the passage, answer a choice by keyboard, and fill both
   live gaps without losing the page. Revealed labels do not overlap.
6. End the session, carry the private scratchpad into Notes, publish the outcome
   and authored homework, and return to the same student's Library controls.
7. The learner sees the outcome and full reading/writing tasks, with no tutor-private
   Notes or next-step field. The page has no horizontal overflow at the three widths.
8. Submit writing, complete gap practice, and record a self-assessment.
9. Save a private feedback draft and verify that the learner cannot see it. Share
   the correction and verify that the learner can read it on a narrow screen.
10. Open a new deck in the same place and reuse that correction as an editable slide.
    Saving and returning preserve the student context and learner-work link.
11. Open all eight French/German A1–B2 samples. Inspect every editor slide, start
    every deck, walk every live slide, submit each choice/gap/ranking interaction,
    reveal actual results, check presenter label bounds and learner labels at both
    320 and 390 pixels, then save Notes.

## Accessibility and evidence

The first journey runs axe-core against fifteen full-page checkpoints with the
WCAG 2 A/AA, 2.1 A/AA and 2.2 AA rule tags, without element exclusions. Screenshots
and the complete JSON results are retained in its Playwright output directory.
Violations fail the test. Results requiring manual review remain in the JSON;
zero automated violations is not a WCAG conformance claim.

Keyboard assertions cover sign-in, session-menu Escape/focus, the slide tablist,
choice answers and learner tabs. This does not replace a complete screen-reader
walkthrough or testing zoom, touch keyboards, microphone permissions and playback
on actual phones.

The catalog journey captures every revealed interaction after receiving a real
learner answer. It checks the rendered result state before taking each screenshot.

Status: both journeys passed with separate Chromium and WebKit learner browsers on
19 September 2026, including all
96 catalog slides and 16 submitted questions. Fifteen full-page accessibility scans
reported no violations; their incomplete manual-review findings remain in the JSON.

See [the first-use audit](../qa/2026-09-19-first-use.md) for findings, fixes and the
remaining acceptance work. Screenshots alone are not evidence that teaching works;
the journey asserts the transitions and persisted outcomes as well.
