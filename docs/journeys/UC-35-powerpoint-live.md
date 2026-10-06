# UC-35 — PowerPoint live control and recovery

Status: **composition journey passed in isolated Chromium with the Office adapter
fixture**. A screenshot-driven chart-contrast correction is awaiting the final rerun.
Native Office remains unverified.

## Journey

1. Connect through real consent/PKCE. Bind questions from two decks with overlapping
   source IDs, reconnect a copied question, reorder slides and leave one unconnected.
2. Start all connected activities; discard the successful HTTP reply before the
   pane receives it. Resume the same audience from the public document reference.
3. Answer and reveal the first question. Open a question from the second deck,
   answer it, then open its copy: the copy starts with no answers.
4. Visit the remaining question and return to the first; its answer remains.
5. Reload the pane, reconnect and resume. Code, results, reveal state and document
   references remain unchanged.
6. Reorder/delete native slides and revisit the second deck's question. Its answer
   still belongs to the same native slide. A question connected after Start is
   unavailable in that frozen session, even with matching source IDs.
7. Open the browser companion. Reopen answers from the pane, close them from the
   companion and see both surfaces update from the same live state.
8. End participation. Both surfaces show the end. Starting again captures current
   connected slides with a new public session reference and an empty audience.

## Boundaries

- The Office host adapter alone is simulated. Consent, token exchange, D1,
  session Durable Object, live SDK, companion and account APIs are real and local.
- The test inspects document tags: only presentation/activity/session references
  are saved. Runtime account and session capabilities stay outside the file.
- HTTP tests additionally cover concurrent Start calls, expired allocations,
  ended sessions, membership/owner entitlement removal, cookie CSRF, and revoked
  connection capabilities, including recovery through the peer API.
- No actual `.pptx` save, native Office selection event, automatic activation,
  embedded content add-in, rehearsal, phone hardware or marketplace delivery is
  proven by this journey.

Implementation: `e2e/journeys/UC-35-powerpoint-live.spec.ts`.
