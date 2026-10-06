# UC-14 — Template-first slide authoring

Status: green on local Chromium.

Purpose: teachers can start with a complete slide composition and edit ordinary
content without losing answers or reveal structure.

Fixture: blank deck plus every entry in the 24-template catalog.

Surfaces: gallery, editor thumbnail rail and slide canvas.

Lifecycle: New slide → choose a template → repeat for all 24 → save → reload.

Acceptance:

- Gallery previews and descriptions have usable height and remain visible.
- Every template inserts a slide and closes the gallery.
- The editor reports no overflow for the catalog's default content.
- All slides and their template provenance survive draft reload.
- Schema/unit tests separately check unique IDs, preserved answers, reset formatting
  and YAML/object round-trips.

Visual notes: previews use the current deck's design and the shared slide renderer.
The gallery's corrected sizing has been inspected in a screenshot.

Playwright: `e2e/journeys/UC-14-slide-templates.spec.ts`.
