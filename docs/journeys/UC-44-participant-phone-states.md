# UC-44 — Participant phone states

Status: green on local Chromium.

Purpose: a learner on a phone keeps typed drafts through a pause, types accents
and gaps easily, can reach every control at short, narrow and landscape sizes,
understands join and connection failures, and sees plain messages when a
session ends or a seat is refused. The real soft keyboard is not covered and
stays a physical-device check.

Fixture: the device is the iPhone 13 profile with locale en-GB and reduced
motion. Five tests use four outlines:

- "Phone states" (French): a title "Bonjour", a text question "Écrivez une
  phrase.", a fill-the-gaps question "Je {{g1}} au marché, puis je {{g2}} le
  pain." and a ranking "Order by height" (Sea, Lakes, Mountains, Snow).
- "Phone reach": a steps slide "Phrases utiles" with nine phrases, an
  individual listening slide with a missing recording, a text question and a
  choice with ten long options.
- "Short phone" with Q&A on: a term "la gare" (the railway station), a blank
  slide with the heading "À la gare" and the line "Demandez le prochain train
  pour Lyon.", the phrases slide, an unlabelled listening slide, a text
  question and a choice "Où est la gare ?" with four options.
- "Phone lookup" (identified tutoring session through the demo account alice):
  a statement "Hier" with the body "Il est passé, (vraiment) hier." and a title
  "Fin". The dictionary route is stubbed.

The last test also uses an identified tutoring session with a personal access
link, launched without starting.

Surfaces: participant phone page, host commands over the API.

Lifecycle: create and start the session → `interaction.open`, `outline.goto`,
`session.freeze` and `session.unfreeze`, `interaction.close` and
`interaction.reveal`, `session.end` as each test needs.

Acceptance:

Drafts, accents, gaps, ranking, Leave and ending:

- In the "Answer" field, the accent button "é" in the "Accents" group writes at
  the caret ("Je suis all au parc" becomes "Je suis allé au parc") and the
  field stays focused. The field has `lang="fr"`, `autocorrect="off"` and
  `spellcheck="false"`.
- After `session.freeze` the phone shows "Answers paused.", the field is
  disabled and keeps its text. After `session.unfreeze` the field is enabled
  with the same text. "Send answer" shows "Answer received".
- Gap fields are named "Gap 1" and "Gap 2", each under 200 px wide, with
  `lang="fr"`, `autocorrect="off"` and `autocapitalize="off"`. The accent key
  fills the focused gap ("suis allé", "ai acheté") and focus stays on it.
- "Change answer" lets the learner edit a sent answer, and the edit ("ai pris")
  survives a pause and unpause.
- The ranking does not open in the authored order.
- "Leave" is at least 44 px tall. It asks "Leave this session? You will join as
  a new participant." "Stay" keeps the seat and the ranking.
- After `session.end` the phone shows "Session ended", has no "Leave" button
  and no "Use it to rejoin" text.
- With a stored seat token changed and a reload, the phone shows "This session
  is no longer open" and no "Offline" text.
- A wrong code through "Join with a code" shows "This session has ended, or the
  code is wrong. Check it with your tutor." and no "(404)".

Scrolling and reach at 390 × 844 and smaller:

- A list-heavy slide opens in Reading below 640 px ("Reading" has
  `aria-pressed` true). The last phrase can be reached by wheel scrolling.
- Choosing "Slide" survives a question and a return to the phrases slide.
- The individual listening player is the region "Your player", below the slide
  plate, with a "Replay" button at least 44 px tall. Its alert reads "This audio
  could not be loaded. Check your connection, then tap Retry loading." and can
  be reached by scrolling, also at 844 × 390 where the plate stays over 100 px
  tall.
- At 390 × 340 "Send answer" can be reached; after sending, "Change answer" can
  be reached.
- At 844 × 390 the reveal shows "Accepted answer:" with "Je suis allé au
  marché", reachable by scrolling.
- With ten long options at 360 × 640 the last radio can be reached, and
  tapping it shows "Answer received".

Connection loss at 360 × 640:

- Offline, tapping an option shows "Your answer was not sent. Try again." in
  the viewport and a banner matching "Offline — reconnecting".
- Back online the banner clears within 15 seconds, the unsent line stays, and
  tapping again shows "Answer received" and removes the unsent line.

Short and sideways windows:

- At 390 × 340 the "Join" button can be reached by scrolling.
- "Dismiss", "Leave", the tabs "Now" and "Q&A", and the buttons "Slide" and
  "Reading" are each at least 44 px on the smaller side.
- In Reading the headword "la gare" is larger than "the railway station", and
  the heading "À la gare" is larger than the line below it.
- The last phrase can be reached at 390 × 340.
- An unlabelled recording shows the block title "Listening" and the audio
  element has `aria-label="Listening"`.
- The free-text field ends within 340 px without scrolling.
- Three questions can be sent from the Q&A tab ("Send question", reachable by
  scrolling). Each shows once as the learner's own item. The last Q&A item can
  be reached at 390 × 340 and 844 × 390.
- At 320 × 568 the last of four options can be reached, and tapping it shows
  "Answer received".

Dictionary sheet:

- Tapping "passé," asks the dictionary for "passé" without the comma and opens
  the dialog "Dictionary: passé" with "meaning of passé". "Close" has focus and
  is at least 44 px.
- With the forms table scrolled to the bottom, "Close" is still inside the
  sheet.
- Escape closes the sheet and focus returns to the word.
- "(vraiment)" asks for "vraiment" without brackets. A step change to "Fin"
  closes the open sheet.

Personal link before the start:

- The page shows "Waiting for your tutor to start", with no "Join" or "Rejoin
  with your name" button and without the join code.
- After `session.start` the page shows "Bonjour" and the URL no longer has a
  `link` parameter.
- "Your tutor sees your name in this lesson." appears and "Dismiss" removes it.
- "Leave" asks "Leave this session? Open the personal link your tutor sent you
  to come back to the lesson." After "Leave session", entering the code alone
  and pressing "Join" shows "Open the personal link your tutor sent you to come
  back to the lesson."
- Opening the personal link again seats the learner at "Bonjour" without the
  name notice.
- After `session.end` the page shows "Session ended" and "Your personal link
  opens your lesson page.", and has no "Leave" button.

Visual notes: the spec saves screenshots at 390 × 340, 844 × 390, 360 × 640
and 320 × 568 to the test output without comparing them.

Playwright: `e2e/journeys/UC-44-participant-phone-states.spec.ts`.
