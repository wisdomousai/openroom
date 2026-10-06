# UC-20 — Learner interface languages

A learner reads the interface in English, French or German, independently of the
language taught in the lesson and their native language. Their browser preference
provides the initial choice. An explicit choice is remembered on that device.

## Acceptance

- The language control is available on Lesson, Practice, Feedback and link errors.
- Changing interface language preserves unsaved writing, exercise answers and audio.
  It translates labels, accessible names and errors, never authored lesson content.
- The page language follows the choice, including portalled audio dialogs. Tutor pages
  keep their own language. Browser-native media controls remain browser-owned.
- A saved choice survives reload. Only the language code is stored, not the link or work.
- French and German phone layouts fit without horizontal scrolling. Audio actions and
  error recovery remain usable with longer labels.
- A blocked storage API does not prevent changing language in the current page.
- Invalid/revoked links and throttling have calm translated explanations.

## Fixture and surfaces

A French lesson with writing, a gaps exercise and voice, opened on a 390px phone
with a French browser locale. Switch to German while work is unsaved; send work,
read published feedback and remove/restore audio. Reload, then choose English.

## Evidence and status

Green in Chromium on 2026-09-18. Both tests in
`e2e/journeys/UC-20-learner-languages.spec.ts` pass: complete phone journey (6.8
seconds) and blocked-storage/link errors (1.4 seconds). French Lesson, German
Practice and the German audio dialog screenshots were inspected.
Locale negotiation unit test, host typecheck, host build and Worker asset build pass.
UC-18 voice and UC-19 individual assignments also pass with the localized UI.
Native media controls, physical devices and other browser engines remain release checks.
