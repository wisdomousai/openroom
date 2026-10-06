# UC-28 — Offline backgrounds, logos and slide overrides

Status: green on the local macOS development build, including presentation polish.

Purpose: a teacher can prepare a branded deck locally, move its file to another
Desktop profile, and present it without the cloud asset service.

Fixture: two title slides in Business, a 4:3 aspect, a generated PNG background,
a logo, and a different image background on the second slide. Only the OS file
picker is replaced; import, package writes, independent reads and serving are real.

Surfaces: native editor, presenter and full-screen audience window, each in an
isolated Electron profile.

Lifecycle: import images → select crop → override one slide → save → independently
read the archive → close Desktop → reopen in a new profile → block cloud requests →
present → open audience screen → advance.

Acceptance:

- New imports load immediately, before a delayed recovery save.
- The package retains verified bytes and references for master and slide images.
- A fresh profile reads the saved file with the cloud endpoint unavailable.
- Presenter and audience preserve the authored aspect and crop.
- The audience window uses the available display area and displays clean slide content.
- Hovering audience text does not display editor selection affordances.
- Advancing updates the audience to the second slide's own background.

Visual notes: masters supply the logo while each slide may override its background.
Slide position and reveal controls belong to the presenter; the audience receives
the slide. The fixture's enlarged logo on slide two proves image replacement,
not a recommended visual design.

Playwright: `e2e/journeys/UC-28-desktop-design-assets.spec.ts`.

Run from `e2e` with `RUN_DESKTOP_JOURNEY=1` after building Desktop. Windows, signed
distribution and physical projector trials remain separate acceptance checks.
