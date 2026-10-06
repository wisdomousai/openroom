# UC-33 — selected workshop recap

1. Run a workshop with a choice result, a visible discussion answer, a moderated
   answer, private facilitator notes and an audience question.
2. Open **Prepare workshop recap** from the session menu. No content is selected.
3. Select a result, discussion point and question. Add a discussion summary and
   shared follow-up. The draft is local to this page; it is not a space record.
4. Change the source session before reviewing. Review rejects the stale selection.
   Refresh explicitly clears the selected source items and preserves the authored
   title, summary and follow-up. Choose the content again.
5. Review the recap. The preview is the same script-free HTML document used by
   Download recap. Editing the selection or text removes the reviewed download.
6. Download the HTML, open it independently and check its narrow-screen layout.
   The document includes selected content only. JSON is available for reuse.
7. Verify that moderated content, private teaching notes, answer keys, participant
   identifiers and session credentials are absent from the downloaded file.

Executable journey: `e2e/journeys/UC-33-workshop-recap.spec.ts`.

Supporting tests exercise schema limits, escaped HTML, explicit source projections,
raw numeric value exclusion, authorization, CSRF, stale/empty/invalid selections,
post-session export, removed-member denial, PAT/MCP access and CLI file output.

Results currently cover choice, scale, numeric and ranking aggregates. Text answers
and Q&A are selected individually. Audience-authored or facilitator-authored text may
itself contain names; the review makes this visible and does not promise automatic
anonymization. Hidden text is never a candidate. There is no automatic upload,
public link, messaging, permanent recap record, or private-note conversion.

Run from `e2e` against local Wrangler. The fixture creates an isolated session using
the development admin key and ends it. No external services are called.

Status: passed in local Chromium; final screenshots and downloaded HTML inspected. Hosted, Desktop and native print
dialog acceptance remain release checks.
