# Paddle billing

OpenRoom now implements account-owned Paddle checkout, billing status and portal
links, plus signed webhook ingestion and shared entitlement checks. Prices and
plan capabilities come from environment configuration. Background reconciliation,
account refresh and redacted diagnostics are implemented. The operator recovery
procedure and conditional retry tool are verified locally. Real Paddle sandbox
acceptance, including a provider support investigation, remains open.

## Self-hosted deployments

Billing is optional. A deployment with no `PADDLE_ENVIRONMENT` (unset or empty)
has no billing at all: `readEntitlements` grants every account every capability
(`keep`, `roster`, `rawExport`, `branding`, `team`, `continuity`,
`largeSessions`) except the reserved `connectors`. No subscription, manual grant or customer mapping is read.
`GET /api/my/billing` answers `{ available: false, selfHosted: true }`, and
Settings → Billing states that billing is off on this deployment.

A deployment that sets `PADDLE_ENVIRONMENT` is a billed deployment, and the
rest of this document applies to it. A billed deployment whose catalog or keys
are missing or invalid stays billed: accounts are free (or keep their manual
development grants) until configuration is fixed. It never falls back to the
self-hosted unlock. The hosted openroom.app must always set
`PADDLE_ENVIRONMENT`; see [DEPLOYMENT.md](DEPLOYMENT.md).

## Environment configuration

Set these Worker variables independently for each billed deployment:

| Variable | Value |
| --- | --- |
| `PADDLE_ENVIRONMENT` | Exactly `sandbox` or `live` |
| `PADDLE_PRICE_CATALOG` | JSON catalog below; its environment must match |
| `PADDLE_WEBHOOK_SECRET` | Secret for this deployment's Paddle notification destination |
| `PADDLE_API_KEY` | Server-only API key from the matching Paddle environment |
| `PADDLE_CLIENT_TOKEN` | Public Paddle.js client token: `test_…` for sandbox, `live_…` for production |

Local values belong in `apps/workspace-worker/.dev.vars`; the checked-in
`.dev.vars.example` contains empty slots. Store the API key and webhook secret as
Worker secrets. The API key is never returned to any client. Sandbox and production need separate D1 databases, notification
destinations and secrets. Price IDs do not identify their environment by prefix;
the operator must supply IDs from the matching Paddle account.

Catalog shape (replace the uppercase placeholder with your approved price ID):

```json
{
  "environment": "sandbox",
  "prices": {
    "APPROVED_PADDLE_PRICE_ID": {
      "name": "Your approved plan name",
      "capabilities": ["continuity", "team", "keep"]
    }
  }
}
```

The name and capabilities above demonstrate the format, not an approved product
offer. Add an entry for each approved recurring price, including separate monthly
and annual prices where applicable. Monetary amounts and currency remain in
Paddle. No prices are invented or embedded in application code.

Capabilities are validated against `ENTITLEMENT_FLAGS` in
`apps/workspace-worker/src/entitlements.ts`. Unknown or duplicate capability names, malformed
price IDs, empty catalogs and mismatched environments invalidate configuration.
The reserved `connectors` flag is also rejected: archive delivery workflows are
not implemented and cannot be offered as a paid capability. Account connections
(including PowerPoint, CLI and MCP) are authentication, available independently
of that reserved flag.
The webhook then returns 503. A subscription containing an unknown price records
`unknown-price` and grants no paid capabilities while the price is unapproved.
Capabilities are derived from verified subscription price IDs and the current
catalog on each access check. Catalog changes therefore take effect immediately;
there is no second stored capability map to reconcile.

## Notification destination

The endpoint is `POST /api/billing/paddle/webhook` on the deployment's HTTPS origin.
Subscribe to the supported subscription lifecycle events: created, activated,
updated, trialing, past_due, paused, resumed and canceled. Other valid signed
events are recorded as ignored. A transaction-completed event or checkout-success
redirect cannot grant access.

The endpoint authenticates the exact raw bytes using HMAC SHA-256 and the
`Paddle-Signature` header before decoding JSON. It accepts multiple `h1` values,
checks the signing timestamp within five seconds in either direction, and caps
request bodies at 256 KiB. Cookies, personal tokens and session capabilities are
not alternatives to a Paddle signature. These rules follow Paddle's
[signature verification contract](https://developer.paddle.com/webhooks/about/signature-verification).

Customer ownership comes from `billing_customers`, keyed by environment and
customer ID, with one customer per OpenRoom user in that environment. The
authenticated checkout service creates that mapping before creating a transaction
and before a subscription can grant access. The webhook never links accounts by email or `custom_data`.
An unlinked customer returns 503 for retry. Its normalized subscription facts go
into a separate pending-event inbox, with no raw payload, email or payment data.
They cannot grant access or choose an account. Once authenticated checkout proves
customer ownership, reconciliation can apply those facts. Do not enable live sales
before real sandbox acceptance and unresolved-write procedures are verified.

## Checkout and account management

Set the Paddle default payment link to `https://YOUR_DEPLOYMENT/billing/pay` and
approve that domain in Paddle. Transactions explicitly use the same URL. Configure
the notification destination before testing paid access. The server key needs
customer read/write, transaction read/write, subscription read, price read and
customer portal session write permissions, plus `notification.read` for event
recovery. Use the matching sandbox or live key;
OpenRoom chooses the fixed Paddle API origin from `PADDLE_ENVIRONMENT`.

Settings → Billing displays the approved plan names, capabilities and current
recurring prices from Paddle. Amounts are formatted using the currency's minor
unit; final taxes, trials and renewal terms appear in checkout. No tier or price
is invented in the client. Existing subscriptions lead to Manage billing for
invoices, payment details and cancellation.

- The authenticated account determines customer ownership. Neither a body user ID
  nor an email match can link an existing customer. A server-created random
  reference is persisted before customer creation and must match on recovery.
- One open checkout and a conditional D1 lease serialize requests from tabs,
  devices, browser, CLI and MCP. The attempt and customer reference survive a lost
  provider reply. A retry searches Paddle for the same reference before it can
  proceed; no undocumented provider idempotency header is assumed.
- An uncertain write with no matching provider object stays pending. It cannot be
  blindly repeated or switched to another transaction. Background reconciliation
  and Refresh billing search for the saved reference without creating another
  customer or purchase. Inconclusive cases remain visible in diagnostics for
  operator investigation; a crashed checkout lease expires after ten minutes.
- Only configured, active, recurring prices that permit quantity one can start
  checkout. A current active, trialing, past-due or paused subscription prevents a
  second purchase. An unfinished transaction must be canceled before changing plan.
- Cancellation checks the current attempt and provider ownership, then cancels
  only draft/ready transactions. A paid transaction cannot be canceled here.
- `/billing/pay` verifies account ownership before loading Paddle.js. It moves the
  public transaction ID from `_ptxn` into the fragment before SDK initialization,
  avoiding Paddle's automatic open in addition to the explicit open. Customer
  logout is disabled; tax-ID entry is available.
- A browser success event only starts confirmation checks. The page requires both
  a completed owned transaction and access on its matching verified subscription
  before reporting that paid features are ready. A delayed update remains pending.
- Paddle script/frame permissions apply only to the checkout surface. Sign-in,
  SDK failure, retry, closed checkout and narrow screens have explicit UI states.
- Portal URLs are short-lived authenticated links. They are obtained for the
  account's stored customer, validated against Paddle's exact environment-specific
  portal host and returned with `no-store`. They are not saved to D1, browser
  storage or logs. Account changes discard the UI's temporary links.
- CLI and MCP use the same account service and return a private browser link for
  the user to complete payment. The `openroom_api` tool describes the contract;
  the generated OpenAPI document also describes the HTTP routes.

Provider references: [transaction checkout](https://developer.paddle.com/build/transactions/pass-transaction-checkout/),
[default payment link](https://developer.paddle.com/build/transactions/default-payment-link/),
[customer creation](https://developer.paddle.com/api-reference/customers/create-customer/),
[portal sessions](https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/).

## Durable state and access

- `billing_events` stores a verified observation ID, type, occurrence and receipt
  times, subscription revision, source, payload hash, subscription ID/status and
  processing outcome. API snapshots use a content-hash ID distinct from Paddle
  event IDs. It stores no raw payload, email,
  payment details, customer metadata or credentials.
- `billing_subscriptions` stores the latest subscription snapshot, price IDs,
  paid/trial period end, scheduled stop time and provider revision. Capabilities
  are derived from the current approved catalog.
- Event ID deduplication and subscription updates share one atomic D1 batch. A
  failed state write rolls its receipt back, allowing Paddle to retry.
- State ordering uses the subscription's `updated_at`, retaining Paddle's
  fractional-second precision. Event occurrence and arrival time are separate.
  An older snapshot cannot overwrite a newer webhook, and a delayed webhook cannot
  overwrite a newer API snapshot. At an equal revision an API snapshot takes
  precedence over a webhook. `recorded` means durable evidence, not necessarily
  current state.
- Active/trialing access ends at the known billing-period end or an earlier
  scheduled cancellation/pause. Renewal must extend the verified period.
- `past_due` access has a seven-day recovery grace anchored by the actual
  `subscription.past_due` transition after the most recent healthy/inactive
  revision. A late original failure can shorten the deadline. Ordinary updates
  and API snapshots never manufacture a new grace period. If the transition is
  missing, access waits for verified recovery of that event. Recovery resets the
  episode; another genuine failure gets its own deadline.
- Paused/canceled subscriptions grant nothing. Several eligible subscriptions may
  contribute capabilities. The access reader checks time on each control-plane
  request, so expiry does not wait for another webhook or cron tick.
- Customer-linked accounts use this billing state exclusively. The manual
  development `users.entitlements` field cannot override a downgrade, missing
  subscription or wrong environment. Accounts without any mapping retain the
  existing manual development behavior.
- Session creation captures whether the space owner paid for collaboration.
  Billing expiry does not interrupt that session's controls or recovery. New
  sessions require current access.
- Session creation also captures the audience limit. Without the owner's
  `largeSessions` capability the live session carries
  `FREE_SESSION_PARTICIPANT_LIMIT` (50, `packages/schema/src/session-limits.ts`)
  into its Durable Object; with it, none. Joins never read D1. A lapse or upgrade
  after creation changes nothing for that session. Sessions created with the ops
  admin key have no account owner and no limit. Removing a space member or revoking a connected
  client still denies their retained host capability immediately.

## Reconciliation and operations

A dedicated `*/5 * * * *` cron runs billing repair. Hourly private-audio and
saved-result cleanup remains separate. Billing repair uses the configured environment,
fixed Paddle API origin and server key; it makes no provider writes.

1. Read up to two 50-event pages, ascending by Paddle event ID, using a durable
   cursor and a conditional three-minute lease. Checkpoint only after all events
   in a page have been durably recorded or placed in the unlinked inbox. A failed
   page can be replayed without duplicating receipt or state writes.
2. Historical event replay supplies evidence and requests a fresh account check.
   It does not temporarily replace current state with an old historical grant.
   The current subscription API supplies that account's authoritative snapshot.
3. Check up to three due accounts, oldest check first. Recover existing checkout
   references, read subscriptions for the stored customer, and fetch any known
   subscription omitted from the list directly. Absence is never treated as proof
   of cancellation. A mismatched customer or invalid response fails closed.
4. Apply current snapshots before pending historical events. Successful account
   checks become due again after an hour; failures and uncertain writes after ten
   minutes. Conditional account leases serialize concurrent requests. Manual
   Refresh billing is limited to once a minute and cannot supply another user ID.
5. Bound provider calls by a two-minute background deadline and a shared work
   budget. Manual repair has a 25-second deadline. Page limits and work exhaustion
   leave durable checkpoints for another run; no cursor is guessed forward.
6. Delete at most 200 old observations per run after 120 days, retaining the current
   subscription observation, latest healthy/inactive boundary and earliest failure
   that anchors the current grace episode. Remove at most 200 expired unlinked
   inbox records per run. Cleanup must never extend access.

Paddle's [event stream](https://developer.paddle.com/api-reference/events/list-events/)
retains 90 days. After an 85-day interruption, OpenRoom restarts its stream scan
from the retained beginning. Current subscription snapshots repair older state;
a past-due subscription without retained proof of its failure receives no new
grace merely because it was discovered again. The subscription
[`updated_at`](https://developer.paddle.com/api-reference/subscriptions/get-subscription/)
is the provider revision used for state comparisons.

Inspect `billing_sync` for `checked_at`, `last_success_at`, `caught_up_at`, `cursor`
and `error`. A successful page is different from catching up to the current end
of the stream. Inspect `billing_account_sync` for account-level `error`, next retry
and lease state. Error values come from fixed OpenRoom codes, never provider bodies
or credentials. Failed cron invocations report failure; the independent account
checks still run after an event-stream failure. Structured warning logs contain
only the job kind, environment and safe error code.

Read-only diagnostic queries, restricted to the intended D1 environment:

```sql
SELECT environment, checked_at, last_success_at, caught_up_at, error
FROM billing_sync;
SELECT environment, user_id, checked_at, next_at, error
FROM billing_account_sync WHERE error IS NOT NULL;
SELECT environment, COUNT(*) AS awaiting_customer_link
FROM billing_pending_events GROUP BY environment;
SELECT id, environment, user_id, transaction_id, attempted_at
FROM billing_checkouts WHERE closed_at IS NULL;
```

For `billing-provider-auth`, verify the environment and API permissions, including
`notification.read`. For `billing-checkout-pending`, inspect the exact saved
customer/checkout reference in Paddle. Do not clear an attempted-write marker,
create a replacement transaction or grant features on the strength of an email,
redirect or screenshot. If provider absence remains inconclusive, retain the
pending attempt and resolve it with Paddle support. The [support runbook](../apps/workspace-worker/docs/BILLING-SUPPORT.md)
provides the exact read-only investigation query and a conditional repair tool for
a provider-confirmed uncommitted create. It cannot turn an empty provider search
into permission to retry. Its generated SQL and subsequent normal checkout are
verified against local D1 and provider fixtures; actual sandbox support acceptance
remains part of release verification.

## Verification and remaining release work

The local Worker tests cover exact-byte signatures, rotation, stale/future signing
times, invalid configuration, environment separation, unlinked customers,
duplicates/concurrent delivery, sub-millisecond ordering, cancellation, trial
expiry, grace expiry/recovery, unknown prices, transactional rollback and owner-paid
collaboration across downgrade and membership removal.

Checkout tests additionally cover same-account retries, lost customer and
transaction replies, concurrent tabs, definite provider rejection, email conflicts,
transaction ownership, portal host validation, approved recurring prices, paid
transaction cancellation denial, duplicate subscription prevention and MCP parity.
UC-37 exercises the built browser UI with billing API and Paddle.js fixtures; it
does not contact Paddle.

Reconciliation tests cover provider-revision races, missing transition evidence,
late failure recovery, catalog changes, inbox privacy, customer mismatch, concurrent
refreshes, retry throttling, incomplete provider lists, cursor recovery, bounded
work, compaction and cron failure isolation.

Paid-access acceptance tests use normalized subscription fixtures at the trusted
ingestion boundary, with real local D1, R2 and live session objects. They exercise
cookies, PATs, connected-client OAuth and MCP requests. The access policy is:

| Operation | Billing source | After paid access ends |
| --- | --- | --- |
| Invite or admit a new space member | Space owner, `team` | Denied; pending invitation remains recoverable |
| Start a new shared session | Space owner, `team` | Denied for collaborators; the same running session can be resumed or retried |
| Create/edit a brand kit | Space owner, `branding` | Denied; existing kits remain readable, trashable and restorable |
| List a context's people; mint or list access links; read returned work, learner work and audio; publish feedback | Space owner of the context, `continuity` | Denied with `continuity-required`. Trash, restore, permanent deletion, link revocation and recording trash/restore remain available. Nothing is deleted |
| Read or write a session's Notes (`/api/sessions/{id}/record`), including the next-time sticky and homework | Space owner of the session, `continuity` | Denied; the record is retained and removed only with the session. Contexts omit `nextNote` until access returns, and the Library stops offering unwritten Notes |
| Create an identified session | Space owner, or personal creator outside a space, `continuity` | Denied for new sessions; a session already running continues to admit its learners |
| Learner access (`/api/learner/*`) through a context link | Space owner of the context, `continuity` | The link answers exactly like a revoked link (`401 unauthorized`); it works again when access returns |
| Create a named session / mint new named invites | Space owner, or personal creator outside a space | Denied; existing invites remain usable and revocable |
| Admit more than 50 participants to a live session | Space owner, or personal creator outside a space, `largeSessions`, read at session creation | New sessions admit 50; a session already running keeps the limit it started with. The next new participant receives `409 session-full`; re-entry with a recovery handle, access link or roster invite always succeeds |
| Export individual live responses | Space owner, or personal creator outside a space | Requires current `rawExport`, except a session already created with named invites |
| Capture a session archive | Space owner, or personal creator outside a space, `keep` | New captures stop; already-captured files and failed-pointer recovery remain available |
| Read a retained archive | Current space membership, or personal ownership | Allowed until retention expires; membership removal still revokes access |

Contexts of every kind (students and classes: create, list, read, edit, file
into a space), building and editing decks, anonymous and pseudonymous live
sessions up to 50 participants, the results recap, listening recordings, Desktop, the CLI, MCP, and the
shared `/api/tutoring/lookup`, `/dictionary`, `/stock`, `/embed-check` and
`/embed-import` tools need no capability. A deck never needs a context.

REST and MCP use the same end-session completion service. An archive has one
immutable R2 object and one D1 pointer per session. Concurrent writes use a
conditional create; database-pointer retries preserve the first capture's contents
and original 90-day retention. A live capability cannot authenticate an account
archive request. Account OAuth connections are independently revocable.

The Host opens saved results from the deck's Library panel and downloads a
readable HTML report, retained JSON and individual-response CSV when available.
UC-38 verifies real local capture, downgrade, report rendering, download retry and
membership removal in an isolated browser. MCP space invitations use the same
authenticated handlers as the browser and direct API. Before release, exercise the
support procedure with Paddle and real sandbox purchases, recovery,
cancellation and plan changes. No real provider request, charge, deployment or
live billing lifecycle is proven by the local tests.
