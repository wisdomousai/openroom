# UC-51 — Notes after a lesson

Status: green on local Chromium at 1280 × 720.

Purpose: after a one-to-one lesson the tutor finds the unwritten Notes at once,
can tell which student they are for, and does not lose private notes or the
student's Next session note.

Fixture: one student, two decks (Au café, Au marché), demo tutor account.

Surfaces: Library prompt and Live now, the Notes page after End session.

Lifecycle: start from the Library → End session → Cancel Notes → open the
prompt → save Notes 1 → a later lesson writes its own Next session note →
reopen Notes 1 with an unsaved device edit → add it and update → a refused save
→ a plan-locked save → a plan-locked load → a failed load → Retry and save.

Acceptance:

- Right after End session and Cancel, the Library shows "Write the notes for
  {student}’s session, {deck}" and offers no Rejoin for the ended lesson.
- The Notes heading names the student and the deck. Next session says it is
  for tutors only and where it appears.
- Tutor notes kept on this device from an unsaved edit show as "Unsaved tutor
  notes" and join the field only on Add to private notes.
- Re-saving an older session's Notes with Next session untouched leaves the
  note a later session wrote.
- When shared saving is refused, the alert names what stays on this device
  (tutor notes) and Download notes saves the outcomes, Next session and tutor
  notes as text.

Visual notes: no dates or counts on the prompt; the alert sits under the form
with Download notes above it.

Playwright: `e2e/journeys/UC-51-notes-after-lesson.spec.ts`. Worker test
`apps/workspace-worker/test/my-home.test.ts` covers the prompt query.
