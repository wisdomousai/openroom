# UC-31 — shared facilitation and presenter handoff

1. Create a training space under an owner with the team entitlement. Invite a second
   account as presenter; the invitee has no paid entitlement.
2. Start a deck. The invitee enters through Join session in the Library’s Live now area.
3. The helper sees who is presenting, can create a live group, and cannot navigate
   slides through either the visible controls or the keyboard.
4. The presenter explicitly passes presentation to the helper. The projector keeps
   its slide. The original presenter’s slide controls become disabled.
5. The new presenter opens the phone remote under the same account. It retains
   presentation authority without a second handoff and advances the projector.
6. The creator takes back presentation. The phone loses its navigation controls and
   the slide stays where it was.
7. Remove the helper from the space. Their retained host token cannot read a snapshot,
   even with an afterRevision value that would otherwise produce a 304.

The Worker tests separately cover malformed/forged requests, per-actor idempotency,
entitlement removal, the space owner recovering a member-created session through MCP,
and rejection of session capabilities on account routes. Domain tests cover unchanged
presentation/answer state and the moderator command boundary. CLI tests verify account
authentication for joining and session-capability authentication for later commands.

Executable evidence: `e2e/journeys/UC-31-co-facilitation.spec.ts`.

The browser fixture is local-only. Start Wrangler with a known `--persist-to` directory,
then set `OPENROOM_E2E_PERSIST_TO` to that same directory when running this journey from
`e2e`. It creates new disposable accounts in local D1, reads the local signing secret
without printing it, and cleans up those accounts afterward. Existing users and their
entitlements are not modified. It refuses remote origins.

Status: passed in local Chromium, including a 390 × 844 phone viewport. Console and
remote screenshots were inspected. Hosted reconnect/hibernation, Safari and physical
phone acceptance remain part of release QA.
