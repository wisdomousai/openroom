# UC-32 — reusable brand kits

1. Open Brand kits from a training space’s settings. Create a kit on its dedicated page.
2. Choose an unreadable accent. The contrast report explains the failing ratio and
   saving is disabled. Choose a readable color to continue.
3. Set heading/body typography, a gradient master background and footer. Upload a logo
   through the real media API and give it alternative text. Save and inspect the preview.
4. Use the mouse wheel to reach the palette and trash action on the detail page.
5. Open a deck with an existing background override. Choose the saved kit from Theme
   and apply it to all slides. Content stays in place; the kit’s design and logo appear.
6. Wait for the acknowledged draft. Its saved design matches the kit’s resolved values
   and the old slide background override is gone.
7. Edit the kit, then trash and restore it. Reopen the deck: its original copied footer
   and design remain unchanged.

Executable evidence: `e2e/journeys/UC-32-brand-kits.spec.ts`.

The fixture uses new local accounts with the owner’s branding entitlement. It never
changes an existing account. Run from `e2e` against local Wrangler with
`OPENROOM_E2E_PERSIST_TO` pointing to its persistence directory. Test accounts, kits,
decks and the uploaded logo are cleaned up afterward.

Supporting tests cover palette math, invalid master references, private file sources,
cross-space asset IDs, member roles, stale revisions, owner entitlement expiry,
recoverable deletion, PAT/MCP parity and editor object/YAML round trips.

Status: passed in local Chromium with final screenshots inspected. The tiny test PNG
exercises image storage, not a proposed visual identity. Palette checks do not certify
photographic backgrounds or a complete deck. Hosted and Desktop acceptance remain
part of release QA.
