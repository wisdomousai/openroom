# UC-05 — Session-wide audience Q&A

Status: green on local Chromium.

Purpose: with `qna.enabled` set on the session, participants ask and upvote
questions from a Q&A tab, a co-host hides junk questions from the Q&A desk, and
the host puts one spotlighted question on the projector.

Fixture: the `seg-camp` example session with `qna: { enabled: true }`, created
through the admin API and started with `session.start`. The question text is
"Will the slides be shared afterwards?". The moderation test seeds a second
question, "buy my mixtape", and one vote over the API.

Surfaces: participant Q&A tab, Q&A desk at
`/host/#/sessions/{sessionCode}/qna?token={hostToken}`, stage.

Lifecycle: create and start the session → participant joins with `?code=` and
asks → a second participant joins and upvotes → (second test) two `qna.ask`
commands and one `qna.upvote` → the desk hides one question → a participant and
the stage load → the desk spotlights one question → the desk takes Q&A off
stage.

Acceptance:

- A participant sees a "Q&A" tab, fills "Ask a question", presses "Send
  question", and the question shows as the participant's own item.
- A second participant sees "Upvote: {question}" in the Q&A tab, upvotes once,
  and the button then shows 1 and is disabled.
- The vote reaches the asker without a refresh: the asker's vote count shows 1.
- The Q&A desk shows the heading "Audience Q&A desk" and the seeded question.
- "Hide question: buy my mixtape" turns into "Unhide question: buy my
  mixtape".
- A participant sees "Will the slides be shared afterwards?" and does not see
  "buy my mixtape".
- After "Spotlight on stage: {question}", the stage shows "Audience Q&A" and
  exactly one card holding the question, and not "buy my mixtape".
- "Take Q&A off stage" removes the question card from the stage.

Playwright: `e2e/journeys/UC-05-session-qna.spec.ts`.
