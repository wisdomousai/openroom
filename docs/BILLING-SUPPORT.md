# Resolve an uncertain Paddle create request

This procedure is for the operator of OpenRoom. It adds no customer approval
screen. Ordinary retries and **Refresh billing** recover an existing customer or
transaction automatically, using the reference saved before the original request.

Use this procedure only when that recovery remains inconclusive. A timeout, an
empty list, a missing webhook or an elapsed deadline does not prove that Paddle
created nothing. Paddle documents that [a create may succeed even when its reply
is lost](https://developer.paddle.com/sdks/libraries/#idempotent-and-retried-requests).

## Identify the exact attempt

Select the intended deployment and D1 database before querying. Keep the incident
record private. Do not copy API keys, cookies, portal URLs, raw provider payloads,
payment details or customer emails into the repair file.

Run this read-only query for the affected OpenRoom account, substituting the
verified environment and user ID:

```sql
SELECT c.environment, c.user_id, c.id AS checkout_id, c.price_id,
       c.transaction_id, c.attempted_at AS transaction_attempted_at,
       c.closed_at, c.lease_until,
       i.reference AS customer_reference, i.attempted_at AS customer_attempted_at,
       p.customer_id
FROM billing_checkouts c
LEFT JOIN billing_customer_intents i
  ON i.environment=c.environment AND i.user_id=c.user_id
LEFT JOIN billing_customers p
  ON p.environment=c.environment AND p.user_id=c.user_id
WHERE c.environment='sandbox' AND c.user_id='OPENROOM_USER_ID'
  AND c.closed_at IS NULL;
```

- Missing `customer_id` with a customer attempt timestamp identifies a customer
  create that needs investigation. Its provider metadata key is
  `openroom_customer_reference`.
- A stored customer, missing `transaction_id` and a transaction attempt timestamp
  identify a transaction create. Its `openroom_checkout_reference` is the checkout ID.
- No attempted-write timestamp means no uncertain create has been recorded at that
  step. A known transaction must be recovered/canceled through normal billing,
  not cleared with this procedure. An active lease means work is still running;
  leave it alone and inspect again after it finishes or expires.

Use the matching Paddle environment and customer/transaction reference when
investigating. If a response/request ID is available in the incident evidence,
include it in the Paddle support case: Paddle's [error contract identifies
`meta.request_id` as its support lookup key](https://developer.paddle.com/api-reference/about/errors/).
OpenRoom does not currently persist that provider request ID; a wholly lost reply
cannot supply one. Include the saved reference and attempt time instead, and
retain Paddle's answer in the private incident record.

## Follow the provider finding

| Finding | Action |
| --- | --- |
| Exactly one matching customer or transaction exists | Use Refresh billing; the service verifies ownership and recovers it without another create. Then resume checkout or Manage billing. |
| More than one object, conflicting references, wrong customer, or payment in progress/completed | Keep the saved attempt. Resolve the provider state with Paddle. Never link by email, rewrite references, clear the attempt or grant access manually. |
| Still unknown, including an empty search result | Keep the saved attempt and continue the provider investigation. |
| Paddle explicitly confirms the original create did not commit and will not commit later | Prepare the conditional retry below, retaining the provider case and exact confirmation. |

The last finding is a human-verified provider conclusion. The tool cannot
authenticate a support conversation or prove absence from a list response.

## Prepare and apply a confirmed retry

Create a private JSON case from the query above. This customer example deliberately
contains placeholders and an unconfirmed conclusion; it will not generate SQL:

```json
{
  "kind": "customer",
  "environment": "sandbox",
  "userId": "OPENROOM_USER_ID",
  "checkoutId": "CHECKOUT_UUID",
  "customerReference": "SAVED_CUSTOMER_REFERENCE_UUID",
  "attemptedAt": 0,
  "confirmedAt": 0,
  "supportCase": "PADDLE_CASE_ID",
  "conclusion": "pending"
}
```

Use the original attempt timestamp and provider confirmation time as Unix
milliseconds. Only set `conclusion` to `not-created` after the finding above.
For a transaction, set `kind` to `transaction`, remove `customerReference`, and
include the exact saved `customerId` and `priceId` instead. Use its transaction
attempt timestamp, not the customer timestamp. Keep the original query result,
case JSON and provider confirmation together.

```sh
bun run billing:retry /private/path/case.json /private/path/repair.sql
```

The command writes a new private file and refuses to overwrite one. It makes no
network request, loads no credentials and changes no database. Inspect the file,
then execute it in the **same D1 database and environment** used for the query.
The entire file is one conditional update that returns a row only when it succeeds.

- `retry_enabled = 1`: the one matching attempt is eligible for a normal retry.
- No returned row / zero changes: nothing changed. Re-read the current state. Do not remove
  predicates or force an update; another request, recovery or operator may have
  changed the attempt since it was inspected.

The update checks environment, account, checkout ID, exact original attempt time,
customer reference or customer/price ownership, open state, absence of a linked
provider result, and absence of an active checkout lease. It clears only that
step's attempted-write marker. It preserves the saved references, customer data,
transaction history, subscriptions and paid access. Reapplying the same repair
after it succeeds changes nothing.

Have the account resume its ordinary checkout. The normal service again checks
for an existing provider object and subscription before issuing a create. Record
the new customer/transaction result, verify there is only one intended purchase,
and verify paid access only through the matching verified subscription. A browser
success screen alone is not billing evidence.

## Verification boundary

The real local D1/HTTP checkout tests simulate requests lost **before** provider
creation, as well as replies lost **after** creation. They execute the generated
SQL, verify a single eligible retry, and deny stale evidence, another account or
environment, an active lease and repeated repair. Uncertain refresh/retry makes
no extra provider create; neither the repair nor an unfinished checkout grants
paid access. Existing tests cover duplicate delivery and linked-result recovery.

This verifies the local repair mechanism and application behavior. It does not
prove a real Paddle support investigation, sandbox purchase or hosted D1 repair.
Exercise this runbook with the actual sandbox account before enabling live sales.
