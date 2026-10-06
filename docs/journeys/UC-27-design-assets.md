# UC-27 — Uploaded design images and portable copies

Status: green on local Chromium.

Purpose: a teacher can add school branding once, present it consistently, and
download a deck containing its images for use in Desktop.

Fixture: a one-slide classroom deck with a generated PNG background and logo.
Both images are uploaded through the editor; no stock service is involved.

Surfaces: browser editor, standalone/live presenter, projector and 390px phone.

Lifecycle: upload logo and background → set focal point → duplicate master →
save/reload → fail an export → retry/download → start → join from projector/phone.

Acceptance:

- Uploaded image identity, logo description and crop survive reload.
- A failed media download reports an error without publishing a new deck version.
- Retrying produces a readable `.openroom` ZIP with verified image bytes.
- Repeated references across masters share one packaged resource per image.
- Presenter, projector and the phone's Slide view load both images.
- Phone Reading view remains available independently of slide branding.

Visual notes: the image overlay protects text legibility; the crop, logo and
saved composition are consistent across slide surfaces. Application controls
keep their own theme.

Playwright: `e2e/journeys/UC-27-design-assets.spec.ts`.

Limits: external images must permit browser downloads or be uploaded to the
space first. Video, embedded websites and external content inside HTML remain
online content. Native offline reopening is covered separately by UC-28.
