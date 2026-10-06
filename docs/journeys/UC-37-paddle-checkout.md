# UC-37 — Paddle checkout and billing

Status: **green in isolated Chromium with billing API and Paddle.js fixtures**.
Desktop plan selection and 360/390-pixel account/checkout views were inspected.

## Journey

1. Sign in to an isolated local account; open Billing from Settings.
2. Read the configured plan, provider-sourced price and capabilities. Choose it,
   cancel the unfinished checkout, and choose again.
3. Open the separate secure checkout page. Verify account ownership before loading
   Paddle.js, remove `_ptxn` before SDK initialization, and open the checked
   transaction once with customer logout disabled and tax-ID entry enabled.
4. Emit a checkout-success event while the provider transaction is still draft.
   Observe pending confirmation, never paid access.
5. Mark the owned transaction completed but leave subscription access unconfirmed.
   Remain pending. Only after the matching subscription grants access does the
   page show that paid features are ready.
6. Check that delayed confirmation requests authenticated reconciliation. Fail a
   manual refresh, retain the billing view, then retry successfully. Generate a
   temporary customer portal link. The old checkout
   prompt disappears after confirmation. Inspect the mobile account layout.
7. In a separate browser page, deny account access. Observe no Paddle script load.
   Allow access, fail the first SDK load, retry successfully, close checkout and
   reopen it without a second SDK initialization.

## Supporting checks

Worker tests use mocked provider responses and real local D1/authentication. They
cover lost customer/transaction replies, competing requests, definite provider
rejection, same-email conflicts, account ownership, recurring price validation,
unpaid cancellation, denial of paid cancellation, prevention of duplicate
subscriptions, strict portal inputs/hosts, and account-scoped MCP checkout.
Existing Paddle tests exercise signatures, event ordering, access deadlines and
atomic webhook writes. Shared path tests cover the CLI/MCP billing allowlist;
currency tests cover zero-, two- and three-decimal minor units.

## Limits

The browser journey does not contact Paddle or enter payment details. It proves
OpenRoom's built UI, routing and checkout orchestration with controlled responses.
It does not prove Paddle's real overlay, payment methods, taxes, trials, domain
approval, provider permissions, webhook delivery, portal actions or a paid purchase.
Real sandbox acceptance, including provider reconciliation and inconclusive-write
support procedures, remains a release gate. Local reconciliation is implemented.

Implementation: `e2e/journeys/UC-37-paddle-checkout.spec.ts`.
Configuration and remaining work: [Paddle billing](../BILLING.md).
