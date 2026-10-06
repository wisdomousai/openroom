# UC-34 — PowerPoint connection and slide references

Status: **green in Chromium with the Office host adapter fixture**. Native
PowerPoint verification is separate. Sign-in and connected-state screenshots
were inspected at 340 pixels; no horizontal overflow.

## Purpose

A trainer connects an existing OpenRoom question to the selected PowerPoint slide
and can later withdraw the application's account access from Settings.

## Fixture and surfaces

An isolated local owner account, Training space and one saved choice question.
A 340-pixel task pane, real consent popup/callback, and account Settings. Only the
Office host adapter is simulated; file tags are inspected through that fixture.
No Google provider sign-in, real `.pptx` save, or native Office API is exercised.

## Lifecycle

1. Open the pane and sign in through its Office dialog adapter.
2. Review the real browser consent form; approve as the seeded signed-in account.
3. Receive a code through the origin-checked callback and exchange it using PKCE.
4. Choose the Training space, deck and question; connect it to the selected slide.
5. Copy the slide. Require explicit reconnection, preserving the original binding.
6. Revoke the connection in account Settings. Return to the pane's space chooser.

## Acceptance

- Consent POST keeps a same-origin Origin header. Null and foreign origins remain
  rejected by the HTTP security tests; consent proof is still required.
- Callback asset delivery does not redirect away and lose authorization parameters.
- Selection is rechecked before writing; stale or multiple selections cannot write.
- Document metadata holds only the six defined reference fields. Copying creates
  an explicit reconnection choice and never changes the original slide's binding.
- The narrow pane has no horizontal overflow; connected state is visible.
- Revocation returns the pane to sign-in with a clear message. The document
  references and independent browser account session remain usable.
- The task pane has its Office-specific embedding policy; it does not weaken
  account, learner or consent framing restrictions.

## Visual notes and Playwright map

Quiet green/neutral pane, one primary action, separate space/deck/activity choices,
clear selection status and keyboard focus. Screenshots capture sign-in and the
connected activity. `e2e/journeys/UC-34-powerpoint-connection.spec.ts`.
