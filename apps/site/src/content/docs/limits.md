---
title: Privacy, retention, and limits
description: Check who can access each kind of material, how long it remains available, and the supported size limits.
section: Reference
order: 260
related: [sharing, learner-links, results, homework, account]
---

## Access boundaries

| Material or credential | Access |
| --- | --- |
| Space and its folder tree | Current members, according to owner, editor, or presenter role. |
| Personal API token | The issuing account's control-plane authority. Store it as an account secret. |
| Live host, stage, and remote links | Their designated role in one live session. Keep host and remote links with the facilitators. |
| Learner access link | One named learner's records within one context, including assigned tasks and published feedback. |
| Roster invitation | One host-named seat in one session. |
| Uploaded deck media | Anyone possessing its asset URL. |
| Learner voice work | The submitting learner and authorized workspace reviewers, through authenticated access. |

A space shares one Library tree. Put material for a different membership group in a separate space. A copied download is governed by where you store or send it afterward.

## Private and shared teaching text

| Field | Intended visibility |
| --- | --- |
| Slide presenter notes | Host-side preparation and teaching surfaces. |
| Live Private notes | The current browser's scratchpad until saved into the teaching record. |
| Notes: Tutor notes and Next step | Authorized workspace users. |
| Notes: Outcomes | Learners in the context. |
| Homework assigned to everyone | Learners in the context. |
| Homework assigned to selected learners | The selected learner identities. |
| Writing, voice work, practice progress | Its learner and authorized reviewers. |
| Feedback draft | Authorized reviewers. |
| Shared feedback | Its learner and authorized reviewers. |

Check outcomes, question text, homework, and feedback for private information before sharing. Selecting a learner response for a new teaching slide can expose its wording to the future audience; edit that wording deliberately.

## Session size

A live session admits **50 participants** unless the space owner's plan includes **Sessions over 50 participants** when the session starts. A plan change during the session does not change its limit. Once the session is full, a new participant sees **This session is full.**; a participant already admitted can always return with the same browser, handle, access link, or roster invitation. Installations without billing have no limit.

## Live-session retention

The live retention clocks begin when the session ends, including an automatic end after **12 hours of inactivity**.

| Time after ending | Available data |
| --- | --- |
| First 30 minutes | Live individual responses and participant records remain available for authorized export and recap preparation. |
| After 30 minutes | Individual ballots and participant records are purged. Aggregate results and anonymized text remain temporarily available. |
| After 24 hours | The live session's stored state is deleted. |

Download needed response data promptly. Anonymized text can still identify a person through its wording; review it before sharing.

Eligible **saved results archives** are captured on session end and retained for **90 days**. Download a copy for longer retention. A retained archive's contents are fixed at capture; a later plan upgrade affects future paid operations.

Decks, Notes, assigned homework, and learner work use their own durable records and lifecycles, separately from the live-data retention clock.

## Learner recordings and links

Voice work is retained for **90 days**. A trashed recording can be restored for **7 days**, within its original retention period. Up to **10 retained recordings per learner and task** count toward the limit, including recordings in Trash.

Each context supports **10 active learner links**. The default link lifetime is **180 days**; choose the expiry shown in the creation form. Replace a link by selecting its existing learner identity to preserve that learner's work.

Revocation or expiry prevents further access through the affected link. A replacement link and a space invitation are separate credentials with separate destinations.

## Content and file limits

| Item | Limit |
| --- | --- |
| Choice options | 2–10 |
| Ranking options | 2–6 |
| Scale range | Maximum minus minimum: 2–10 |
| Short text response | 200 characters by default; configurable up to 500 |
| Accepted short-text answers | 20 |
| Gaps in one exercise | 1–8 |
| Active roster seats in one session | 200; each name up to 64 characters |
| Slide masters in a deck | 20 |
| Master content margin | 3%–12% |
| Uploaded media or one packaged resource | 20 MiB |
| Resources in an `.openroom` package | 100 files; 50 MiB combined |
| Source PDF for Desktop page extraction | 100 MiB; extracted resource must fit the package limit |
| Homework tasks in a record | 50 |
| Homework title | 300 characters |
| Homework prompt or guidance | 2,000 characters |
| Reading assignment text | 5,000 characters |
| Learner writing | 10,000 characters |
| Voice response | 5 minutes and 20 MiB |
| Feedback message | 10,000 characters |
| Corrections or timed voice comments | 30 per feedback document |
| Recap title | 160 characters |
| Recap discussion summary or follow-up | 10,000 characters each |

Validation messages identify fields requiring correction. Splitting long material into readable slides or separate assignments is often preferable to reaching a maximum size.

## Connectivity and device requirements

Live participation and synchronization require an internet connection to the active installation. Browser microphone access requires permission and a secure origin. Clipboard, fullscreen, pop-up, and media playback controls can require an explicit gesture or browser permission.

Desktop can present embedded local material offline. Test all external resources, audio output, and projected displays on the teaching computer. Agent requests require access to the selected model provider; dictionary lookup and stock images require the configured services.

## Terminology

| Term | Meaning |
| --- | --- |
| Deck | The editable teaching or presentation file. |
| Space | A shared folder tree and its membership boundary. |
| Folder | A location within a space. |
| Context | The teaching information associated with a student, group, or class. |
| Session | One live occurrence started from a deck. |
| Stage | The audience display. |
| Notes | A session's saved outcomes, private teaching notes, and follow-up work. |
| Draft | Working deck content, which can still be incomplete. |
| Version | Saved, validated deck content available in History. |
| Archive | A retained capture of session results. |
