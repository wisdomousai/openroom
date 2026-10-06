---
title: Account, billing, and connected apps
description: Manage sign-in, plan access, subscriptions, personal tokens, and external connections.
section: Account and integrations
order: 230
related: [sharing, agents, results, limits]
---

## Manage your account

Open **Settings** to review the signed-in account. Use the same account for the workspace, Desktop connection, and integrations that should share your decks. Sign out before leaving a shared computer.

Space ownership and membership determine access to shared material. A learner access link and a participant invitation each open their own limited destination; use account sign-in for workspace administration.

## Review available plans

Select **Settings → Open billing**. Review the current plan and the available offers. Each offer states its price, currency, billing interval, and included capabilities. Use the values displayed there for the active installation.

| Capability | Access it provides |
| --- | --- |
| Saved session archives | Capture ended-session results for the archive retention period. |
| Named response exports | Download individual responses, with the identity available for the session. |
| Shared brand kits | Store and reuse a space's visual design. |
| Shared spaces | Invite colleagues to a shared Library and work together. |
| Connected workflows | Use entitled external account integrations. |
| Named session invites | Issue individual roster invitations for one session. |

For shared-space work, the relevant owner entitlement supplies paid features. Invitees use their assigned space role; they do not each need a separate licence for that shared workspace.

## Start or change a subscription

Select **Choose plan**, then follow the secure checkout link. Review the checkout's billing frequency, tax, renewal, trial, and payment terms before completing it.

Return to billing after checkout. Entitlements update after payment information is verified. Use **Refresh billing** if the page still shows the previous state. An unfinished checkout offers continuation or cancellation of that pending checkout.

Checkout requires the installation's configured billing service and approved offers. A **Sandbox** indication means the checkout uses the test environment.

## Manage an existing subscription

Select **Manage billing** and open the prepared customer-portal link. Use that portal for supported subscription changes, payment details, and invoices. Return to OpenRoom and refresh billing afterward.

The status may show **Active**, **Trial**, **Payment needs attention**, **Paused**, or **Ended**. Follow the payment action when attention is required. New paid operations use the current verified entitlement. Existing captured archives remain available until expiry; collaboration already enabled for a session remains subject to current membership and connection access.

## Create and revoke personal API tokens

1. Open **Settings → Connect an agent (MCP) → Create token**.
2. Give the token a label identifying its client or purpose.
3. Select **Create token** and copy the secret immediately.
4. Store it in the intended client's secret configuration.

The full token is displayed once. The token list shows its label, prefix, creation time, and last use. Search the list to find a particular token. Open its actions menu and select **Revoke token** to stop it immediately, then update any client that used it.

A personal token carries your workspace authority. Treat it as an account secret. Use a separate labelled token for each client so that one integration can be revoked independently.

## Manage connected apps

Review **Connected apps** in Settings. Revoke a connection that is no longer needed or belongs to an untrusted client. Revocation stops that connection and host credentials issued through it. Reconnect through the app's consent flow if you need to use it again.

Personal API tokens and connected-app authorizations are managed separately. Revoke the credential actually used by the client.
