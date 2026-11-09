---
title: Run a live session
description: Manage participation, question state, results, remote control, and session recovery.
section: Teach and host
order: 100
related: [present, hosting, participant, results, notes]
---

## Choose participant identity

Prepare the deck's identity policy through a connected agent or the typed outline before starting:

| Identity mode | Entry and identity |
| --- | --- |
| Anonymous | Join with the session code; individual names are withheld. |
| Nickname | Join with the code and receive a generated nickname. Rejoin with the same name to recover it. |
| Identified | Use a personal learner credential belonging to the deck's student; joining opens after the teacher starts. |
| Guest list | Use a personal guest link the host issued for one named guest in one session; lobby entry is available. |

An identified deck needs a student (a person, group, or class): file the deck under that student before starting it. Identified mode is set in the outline by a connected agent; the browser has no control for it. Named guest-list sessions require the **Guest lists for sessions** entitlement. See [access links](/docs/learner-links/#use-named-live-participation) and [guest link administration](/docs/cli/#issue-guest-links) to prepare the corresponding entry addresses.

## Start and share entry

Select **Start session** from a deck in the Library, the deck editor, or the presenter. The current deck content is saved and captured for the session. The host header shows the connection state, joined count, and answered count for the current question.

While a session of the deck is running, **Live now** and **Rejoin** appear beside **Start session**. Pressing **Start session** then asks once, in **This deck is live now**: select **Rejoin** to return to the running session, **Start another** to start a second one, or **Cancel**.

For code-based participation, select the join code chip to copy its link, or open **Session menu → Copy join link** or **Join page**. Share the code or QR code with the audience. In an identified session the header shows the student's name instead of the code, and the audience display shows no code or QR; the student joins with the address the agent returned, which carries their [access link](/docs/learner-links/). A guest-list session also shows no code or QR on the header or the audience display, which reads **Waiting for invited people** until someone joins. Each named guest joins with the address that carries their own [guest link](/docs/cli/#issue-guest-links).

Select **Stage** in the session menu to open the audience display. If its link has not loaded, select **Stage — retry**.

## Open, close, and reveal a question

A question opens for answers when its slide becomes the current slide. Returning to a question slide opens it again with its existing answers. The selected preview in the rail and the audience's current slide may differ; move to the slide when you intend to change what the audience sees.

| Control | Result |
| --- | --- |
| **Close answering** | Stop accepting responses. Aggregates follow the configured visibility policy. |
| **Reveal results** / **Call out the correct answer** | Show the result and, where the question has one, the correct answer. |
| **Hide results** (H) | Hide or show this question's results on the audience display. Received responses are kept. While pressed, the ribbon says **Results hidden**. |
| **Next** (→) | Reveal the next content group or continue to the next slide. **Back** (←) returns. |

A question countdown closes responses automatically when time runs out. Closing a question and ending the session are different operations.

Use the chart menu to change the current result display. Text responses can be hidden individually from the result display and restored through moderation controls. Review what the audience will see before projecting sensitive free-text answers.

![Live presenter with revealed choice results, answer counts, current slide, and question controls](/docs/images/live-results.png)

*The current question, revealed answers, and presenter controls share one view.*

## Run a second vote

For a choice question prepared with peer instruction:

1. Collect and close the first vote.
2. Let participants discuss their reasoning.
3. Select **Second vote**.
4. Close the second vote and compare the rounds.

The first-round aggregate is retained for comparison. **Back to first vote** restores the first round and discards the second round.

## Freeze participation

Select **Freeze** (F) to pause submissions and hide participant text on the audience display. Use **Unfreeze** to resume. This is useful when a response needs moderation or the room needs your attention. In a narrow window, **Freeze** and **End session** are in the Session menu.

Use **Close answering** when only the current question should stop receiving answers. Use **Hide results** to hide the current question's results from the audience display.

## Control from a phone

Open **Session menu → Copy remote link** and open that link on your own phone. The remote provides the current question's actions, previous/next navigation, applicable clock and listening controls, freeze, and session ending.

The remote link carries host authority. Send participant links to the audience and keep the remote link for the presenter. A colleague with shared-space access can obtain their own authorized session connection.

## Reconnect and recover

| Connection label | Meaning and action |
| --- | --- |
| Connecting | Wait for the session connection to initialize. |
| Live | The session is receiving live updates. |
| Connected | Commands and answers get through by periodic requests. Continue; updates can arrive a little later. |
| Offline | Restore network access. Check the latest slide and question state after reconnecting before sending another action. |

Use the same browser to retain its session connection. After a reload, or on another device, sign in and use **Rejoin** under **Live now** in the Library or in the deck editor. A colleague in a shared space sees **Join session** there instead. If a device opens the session address without its credentials, it says **This session is not open on this device.**

If an operation fails, read the error and wait for reconnection before retrying. Check whether the intended slide or response state has already changed. Starting again deliberately creates another audience session; use recovery to return to the existing one.

## End or leave

To finish participation, select **End session**, then confirm **End this session?** Participants disconnect and results become final. Continue to Notes or export results as needed.

To return to the deck or Library while participation continues, use the corresponding exit action. The session stays reachable under **Live now** until it ends. Idle sessions also expire according to the [retention policy](/docs/limits/).
