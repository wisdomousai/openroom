# UC-50 — Chart labels on the Stage wall

Status: green on local Chromium.

Purpose: on the wall a ranking names every item next to its rank, a column
chart names every column under it, a scale keeps both end labels apart, and a
number histogram marks the correct value and says it in its note. Nothing
overlaps and nothing leaves the plate at 1920 and 1280 wide.

Fixture: a session "Wall labels" with `resultVisibility: 'live'` and four
interactions, each on its own step, answered by five participants, then closed
and revealed:

- `rank`: a ranking with display `sentence`, "Ordnen Sie die Sätze nach
  Höflichkeit", six long German sentences.
- `cols`: a choice with display `columns`, "Welcher Satz ist am höflichsten?",
  the fifth sentence ("Könnten Sie mir bitte sagen, wie ich zum Hauptbahnhof
  komme?") marked correct.
- `scale`: "Wie sicher fühlen Sie sich beim Konjunktiv II?", 0 to 10, with a long
  label at each end.
- `year`: a numeric question with display `number`, "In welchem Jahr fiel die
  Berliner Mauer?", correct 1989. Answers are 1989, 1989, 1961, 1990, 1989.

Surfaces: the Stage at 1920 × 1080 and then 1280 × 720, with reduced motion.

Lifecycle: start the session → for each interaction `outline.goto`,
`interaction.open`, five `answer.submit`, `interaction.close`,
`interaction.reveal` → open the Stage → for each size and each slide,
`outline.goto` and `interaction.reveal`.

Acceptance:

Every check is made at both sizes. "Laid out" means every measured box lies
inside `.plate` and no two boxes overlap (one pixel of rounding allowed).

- Ranking: `.or-rank-chart` has 6 `.barrow__label` rows. Each full sentence is
  visible. The first row's rank reads "1.". The rows are laid out.
- Columns: `.or-cols-chart__labels` has 6 `.barrow` entries. The one marked
  `data-or-correct` contains "Hauptbahnhof". The column labels are laid out.
- Scale: `.or-scale-ends__min` contains "überhaupt nicht" and
  `.or-scale-ends__max` contains "freier Rede". There are 11 tick labels. Ticks
  and both end labels are laid out, and both end labels sit at or below the
  lowest tick.
- Number histogram: `.or-hist-note` contains "5 answers" and
  `.or-hist-note__correct` contains "1989". The chart has one line in the
  `numeric-correct` mark. The note is laid out.

Visual notes: the spec saves a screenshot per chart and size to the test
output without comparing it. The layout checks are the assertions above.

Playwright: `e2e/journeys/UC-50-wall-chart-labels.spec.ts`. The spec header
names this path as its contract.
