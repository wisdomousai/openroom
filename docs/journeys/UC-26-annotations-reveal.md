# UC-26 — Annotated reading and controlled reveals

## Purpose and fixture

A tutor marks a phrase while reading together, draws on the slide, and reveals
or hides teaching material without losing the audience's place. The fixture is
a paper-themed 4:3 deck: a German reading passage followed by a French/German
comparison, with separate reveal groups for its heading and each response.

## Surfaces and lifecycle

The browser editor opens Present, then starts participation through the real local
Worker. The tutor mirror, standalone projector, learner phone and phone presenter
remote follow that session. The learner switches between Reading and Slide views;
the phone narrows from 390 to 320 pixels and the projector changes window size.

The journey uses normal session launch, join, annotation, clear, next and previous
operations. It does not stub live state or geometry.

## Acceptance

- Present opens with the first group visible. Back cannot expose a hidden group.
  Next reveals the passage; Back hides it again before live participation starts.
- A dragged phrase highlights each selected visual line. Every selected word is
  covered, without filling the intervening line breaks. Resize and Reading/Slide
  changes remeasure the same authored words.
- Back hides the annotated passage; Next restores the text and its correctly
  measured marks. Hiding content does not erase its annotations.
- Underlines follow the same phrase. Double-clicking one highlighted line removes
  that whole phrase mark on every connected display.
- A pen stroke has the same normalized position relative to the actual 4:3 slide
  on the tutor mirror, projector and learner Slide view. Letterboxing is excluded
  from its coordinate frame.
- Reading view keeps word-anchored marks and omits freehand strokes, which refer to
  fixed slide coordinates. Returning to Slide restores the strokes.
- Moving to another slide clears ink. Each comparison response reveals separately.
  The phone remote reverses those reveals, returns to the previous slide shown in
  full, and stops at the first slide's first group.

## Visual notes

The presenter frame uses the saved slide aspect. Phrase highlights remain short
swipes over words, including narrow phone reading. No preview-only annotation is
broadcast. The projector and learner do not acquire tutor controls.

## Playwright map and status

`e2e/journeys/UC-26-annotations-reveal.spec.ts`

Green in Chromium against the local Worker. Phone reading, tutor pen, projector
comparison and phone-remote screenshots are inspected as part of acceptance.
UC-09 covers word-card privacy and word-circle alignment after the shared paint
change. UC-11 covers reverse reveals from the native audience window on the macOS
development build. Physical touch/stylus, Safari and signed distributions remain
separate checks.
