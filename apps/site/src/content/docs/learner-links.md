---
title: Issue and replace learner links
description: Give each learner private access to their work and preserve identity when replacing a link.
section: Teaching and follow-up
order: 140
related: [contexts, learner, sharing, limits]
---

## Create a link

**Required:** editor or owner access to the context's space.

1. Open the student's or class's Library and expand **Student access links**.
2. Select **Create link**.
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

In **Learner access links**, find the link by learner, prefix, and expiry. Select **Revoke** and confirm. Further requests through that link are denied.

An expired link is renewed by creating a replacement for the same learner. A context supports at most 10 active links. Revoke an unused active link before creating another when the limit is reached.

## Use named live participation

Set the deck's identity mode to identified through its prepared outline when the session should admit only linked learners. Start the deck from its real context. Learners can enter the live session after it starts, using their personal credentials.

The current named-join workflow uses a personal participant address. Combine the session's join code and the learner token from their issued link:

```text
https://join.openroom.app/?code=SESSION_CODE&link=LEARNER_TOKEN
```

Replace both placeholders and send the completed address only to that learner. Use the participant origin of your installation if it differs. The learner token is the `token` value in the lesson-page link issued by **Create link**; it begins with `orlnk_`. Keep that lesson-page link for ongoing homework and feedback. After a successful join, the participant page uses a credential limited to the live session.

A named roster invitation belongs to one live session and follows a separate entry path. Use [roster invitations](/docs/participant/#join-with-a-roster-invitation) for a one-session attendance or voting group, and learner links for continuing teaching records.
