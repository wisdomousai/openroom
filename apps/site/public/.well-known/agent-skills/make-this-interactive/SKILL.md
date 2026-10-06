---
name: make-this-interactive
description: >-
  Take an OpenRoom outline that already has visuals and add or replace wired
  steps (questions, activities, timers) so the class can answer. Use when the
  tutor says the slides look fine but nothing asks the class.
---

# Make this outline interactive

Do not redraw freeform `elements` unless the tutor asks. Insert or replace
**wired** steps:

- A "check understanding" beat → an `interaction`. Pick the type from what the
  answer actually is: one of a set, a number, a confidence reading, an order, a
  gap in a sentence, a pairing, or free text.
- Pair or group work → `activity`
- Silent minutes → `timer`
- Open questions from the floor → `qna.enabled` or a `qna` interaction

Never put `elements` on `interaction`, `activity`, `timer`, `join`, or `break`.
Those kinds use named layouts.

Add the step that tells the tutor something they did not already know. A
question every learner will get right costs a minute of class time and returns
nothing to act on.

Validate, show the tutor the proposed wired steps, and save only after they
agree.
