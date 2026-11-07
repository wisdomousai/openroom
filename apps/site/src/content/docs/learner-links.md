---
title: Issue and replace access links
description: Give each learner private access to their work and preserve identity when replacing a link.
section: Teaching and follow-up
order: 140
related: [contexts, learner, sharing, limits]
---

## Create a link

**Required:** editor or owner access to the context's space, and a plan that includes **Homework and Notes**. Without the plan, the card shows a **Homework and Notes** lock with a **Plans** button.

1. Open the student's or class's place in the Library and find the **Access links** card below the decks.
2. Select **Create link**. The page **Create an access link** opens.
3. Choose the **Learner**. For a new member of a group, choose **New learner** and enter their **Display name**.
4. Choose **Expires**. The default is 180 days.
5. Select **Create link**.
6. On **Copy this link now**, select **Copy link** and send it to the intended learner through your usual communication channel.
7. Select **Done** after storing or sending it.

The complete link is shown once. If clipboard access fails, select the displayed address and copy it manually before leaving the page.

## Explain what the learner receives

The link opens the learner's page containing their lesson outcomes, assigned homework, practice, writing or voice responses, and published feedback. For an identified live lesson, it also proves that person's identity within the associated context.

Each group member should use their own link. Their writing, recordings, feedback, and practice progress stay associated with that learner. Common outcomes and tasks assigned to everyone are shared within the context.

Possession of the link grants access. Ask learners to keep it private, especially on a shared computer. The issuer controls the display name and expiry.

## Replace a lost link

Create another link and select the **same learner** from the learner selector. Copy and send the replacement. Then revoke the old link if it is lost or no longer trusted.

Choosing the existing learner preserves their writing and practice history. Choosing **New learner** creates a separate identity, even if you type a similar name.

## Revoke or renew access

In **Access links**, find the link by learner, prefix, and expiry. Select **Revoke**, then **Revoke link** to confirm. Further requests through that link are denied.

An expired link is renewed by creating a replacement for the same learner. A context supports at most 10 active links. Revoke an unused active link before creating another when the limit is reached.

## Use named live participation

A named (identified) live lesson is prepared through a connected agent or the [command line](/docs/cli/). The browser has no control to set identified mode or to build the join address. The agent sets the identity mode in the outline, files the deck under the student, and starts it. It then asks OpenRoom for the student's access link for that session and returns the finished join address, which already carries the link. Send that address only to that learner.

Learners can enter the live session after you start it. On their first join they see **Your tutor sees your name in this lesson.** once. The live console shows the student's name in place of the join code, and the audience display shows no code or QR. After a successful join, the participant page uses a credential limited to the live session. Keep the lesson-page link for ongoing homework and feedback.

Without an agent, teach with generated session names: start the deck as usual and share its code.

A named guest link belongs to one live session and follows a separate entry path. Use [guest links](/docs/participant/#join-with-a-guest-link) for a one-session attendance or voting group, and access links for continuing teaching records.
