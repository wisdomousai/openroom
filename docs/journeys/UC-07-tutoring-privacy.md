# UC-07 — Tutoring privacy

Status: green on local Chromium.

Purpose: in an identified tutoring session the host sees the learner's name,
while the stage and the learner plane receive no handles, signals, private
notes or session code.

Fixture: demo account alice. A tutoring context "Léa {stamp}" (fr, B1,
speaking) and a tutoring deck "Privacy journey {stamp}" with
`identityMode: 'identified'`: a title step "Bienvenue" and an interaction step
"check" with the choice "Ready to start?" (Yes, No). The session is launched
with `start: true` and a learner access link is made for the context. Join
uses `OPENROOM_JOIN_URL` when set, else `{base}/join`.

Surfaces: learner join page opened with `?code=` and `?link=`, host state API,
stage state API, stage page at 1280 × 720, `/api/learner/sessions`.

Lifecycle: create context and deck with a session → launch → create access
link → learner opens the join URL → read host and stage state → open the stage
→ `outline.goto` the "check" step → `session.end` → save the session record
with outcomes, notes and homework → read the learner session list.

Acceptance:

- The learner sees "Bienvenue" or "Ready to start". The join code does not
  appear on the learner page, and there is no "I’m stuck" button.
- Host state has no `signals` property. When it has `handles`, one name starts
  with "Léa".
- Stage state returns 200 and its body contains neither `"handles"` nor
  `"signals"`.
- The stage shows "Bienvenue" and does not show the join code or any QR
  (`.rail__qr`, `.idle__qr`, title "QR code to join").
- After `outline.goto` to "check" the stage shows "Ready to start?" and still
  no join code.
- `session.end` is accepted, and saving the record returns 200.
- `/api/learner/sessions` with the access link returns 200 and its body
  contains neither the private note text ("Private tutor note"), the join
  code, a `"notes"` key, nor a `"sessionCode"` or `"room_code"` key.

Playwright: `e2e/journeys/UC-07-tutoring-privacy.spec.ts`.
