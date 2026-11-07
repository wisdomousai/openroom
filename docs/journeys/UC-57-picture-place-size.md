# UC-57 — A picture takes its place and size

Status: green on local Chromium (wall at 1920 × 1080).

Spec: `e2e/journeys/UC-57-picture-place-size.spec.ts`. Helpers:
`e2e/fixtures/slide-geometry.ts`.

`media.place` and `media.size` mean what the outline_validate description
says, for portrait (3:5), square and landscape (16:9) pictures, at 16:9, 16:10
and 4:3. Values outside the accepted limits are refused.

## Fixture and acceptance

Run `bun run verify:browser journeys/UC-57-picture-place-size.spec.ts` after
building the apps. One session per aspect ratio is made through the admin API.
The pictures are synthetic SVGs served by a Playwright route.

For every picture shape, on statements with a short heading and body:

- Place left or right at size 20, no size (42) and 60 draws the step as split.
  The picture column is size percent of the content width, it fills the
  content height, and it is on the named side of the heading and body.
- Place top on a step with layout split draws as right: a 30 percent column
  the full content height.
- Place top or bottom at size 20, 60 and 100 keeps the stacked layout. The
  picture is above or below the words, at most size percent of the content
  height, and exactly that at size 20.
- Place fill on the media layout: the picture covers its whole picture area.
- Nothing is cut, and the picture stays inside the top and bottom margins.

Refused with 422 when a session is started:

- size 61 on split, and size 61 placed left on a statement (drawn as split):
  E_MEDIA_LAYOUT at `/steps/0/media/size`;
- place fill outside the media layout: E_MEDIA_LAYOUT at `/steps/0/media/place`;
- size 19 and size 101: a schema error at `/steps/0/media/size`.

Size 60 on split and size 100 at the bottom still start a session.
