---
name: port-a-deck
description: >-
  Turn an existing PowerPoint, PDF, or folder of slide images into an OpenRoom
  outline: keep the visuals as freeform elements (text, pictures, HTML/SVG,
  typed web pages, or typed PDFs),
  and upgrade checks and talk-turns into wired interactions. Use when a tutor
  or dean has a deck to bring into class, or says "make these slides
  interactive."
---

# Port a deck into an OpenRoom session

Read the original locally. OpenRoom never stores the `.pptx`.

## Hard boundary

- Do not upload the original deck, slide images, or a model conversation to
  OpenRoom.
- Provenance may say `Year 10 photosynthesis deck` — not the file.
- Show the proposed outline to the tutor before saving.

## Classify each slide

Keep the running order. One deck = one outline.

| What the slide is doing | OpenRoom step |
| --- | --- |
| Title, section, figure, photo, diagram, "today we will" | `title` or `statement` with `elements` |
| Quiz, true/false, pick one, fill the blank, match | `interaction` (`choice`, `fill-the-gaps`, `match`, …) |
| Discuss / pairs / make something | `activity` |
| Timed silent work | `timer` |
| "Any questions?" | `interaction` type `qna`, or session `qna.enabled` |
| Join / scan this | `join` |

Drop a slide that only announced what the teacher was about to say. Bring back
a slide that asked the class something as a wired step, not as a picture of a
question.

## Keeping the visuals

Wired kinds own their layout; do not dress them. Freeform kinds carry the
elements.

- Use an `html` element (HTML or SVG) when a text box would flatten a diagram.
- Find a picture the tutor does not already have with `picture_search`. Do not
  invent an image URL, and do not drop a diagram because the deck's copy was a
  bitmap.
- Keep `title` on the step for the rail even when the heading is also an
  element.
- Sanitisation is strict. Read the validator's error rather than guessing which
  tag it rejected.

## Brand

If a school `DESIGN.md` is in the workspace or next to the `.openroom` file,
restyle generated HTML/SVG to its tokens (paper, ink, accent, display face,
radius, wordmark). Skip only when the tutor says to ignore brand.

On a space with the `branding` entitlement, applying `DESIGN.md` is the default.

See `docs/SCHOOL-DESIGN.md`.

## Workflow

1. Read the local deck.
2. Draft the outline: visuals as elements, checks as wired steps.
3. Apply brand unless told not to.
4. Validate, and fix every error.
5. Save, then launch only when asked.

For a language hour after the port, follow `prepare-a-language-outline`. To add
interactions to an already-ported file, use `make-this-interactive`.
