# UC-62 — Create questions in PowerPoint

Status: **green in isolated Chromium with the Office adapter fixture**. Screenshots
were inspected at 340 pixels for the pane and 960 × 540 for the slide.

## Journey

1. Sign in to the task pane in a presentation with no OpenRoom slides. The pane
   opens on **Add a question** with the owner's space under **Save questions in**.
2. Add a multiple-choice question to the selected slide. The empty third answer is
   dropped. The file gets an `OPENROOM_DECK` tag and the slide an
   `OPENROOM_ACTIVITY` tag for the new deck, named "PowerPoint questions".
3. Select another slide and add a word cloud. The form first reports
   "Write the question." The second question goes to the same deck.
4. Select the first slide again. The pane shows **Edit question** with the saved
   text. A duplicate answer is reported; the corrected edit keeps the question and
   answer IDs.
5. Start session. Both slides start, in presentation order, from the same deck.
6. Open an empty **OpenRoom Slide** on a third slide. It reuses the pane's
   sign-in, shows the same form, and after **Add to this slide** shows the scale
   question in the slide.

## Limits

Only Office APIs are simulated; account consent, deck versions and the session
are real and local. Native PowerPoint, `.pptx` saves and copied files remain
release checks.

Implementation: `e2e/journeys/UC-62-powerpoint-questions-in-place.spec.ts`.
