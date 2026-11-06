# UC-59 — Slide content fits its box in the editor and on the stage

Long text, pictures, short and long grids, many answers, a large word bank and
HTML objects stay inside their slide. Where content is too long, the heading
stays at the top and only the end of the text is cut, the same way in the editor
and on the stage.

## Fixture and acceptance

Run `bun run verify:browser UC-59-slide-fitting` after building the apps. The
fixture signs into the disposable local Worker, creates a space, uploads a
synthetic image and saves one 16:9 deck through the API. Opening slides uses the
real editor. Showing them on a 1920 × 1080 stage uses the real presenter.

The deck has eight slides:

- A statement with a heading and a 480-character body. The heading starts at the
  top margin in the editor, not above it. On the stage its box matches the editor box
  within 0.2% of the slide width.
- A statement whose picture is placed right. It draws as a split slide in the
  editor and on the stage, with the picture right of the body. The editor reports
  no overflow.
- Six steps with a picture placed at the bottom at 30% height. The picture
  starts below the last step and ends inside the slide. The editor reports no
  overflow.
- Two short cards. Each card is less than 15% of the slide width tall, and the
  stage cards match the editor cards within 0.9%.
- Twelve steps. Every step number sits inside its own row and the editor reports
  no overflow.
- An HTML object whose content is `position: fixed` over the whole viewport. On
  the stage, none of the four slide corners hit the object.
- A choice question with seven answers. The answers use the compact row size and
  the last answer ends above the bottom margin.
- A fill-the-gaps question with a 24-word bank. The bank draws as chips that wrap
  and is less than 25% of the slide width tall.

Screenshots of the editor and stage slides are kept in the test output folder
for visual review.

## Boundaries

The journey checks one aspect ratio and one design. UC-40 compares the full
composition across displays and aspect ratios, and UC-41 checks the overflow
notices. Fit for text longer than the slide is not tested here: the end of such
text is still cut, and the editor reports it.
