# Example decks, easiest first

Work down the list — each example introduces one or two ideas on top of the last.
Run any of them with `openroom validate <file>` / `openroom preview <file>`, or
use them as source material in the deck editor.

For complete teaching material, see the [French and German A1–B2 lessons](tutoring/README.md),
also available through **Sample lessons** in a Tutoring space.

| # | File | What it teaches |
|---|------|-----------------|
| 0 | [`00-simple.yaml`](00-simple.yaml) | **Default dialect (SimpleSession):** title + questions only. Start here. |
| 1 | [`01-first-poll.yaml`](01-first-poll.yaml) | Full Session shape for one `choice` (advanced format). |
| 2 | [`02-class-checkin.yaml`](02-class-checkin.yaml) | `scale` and `text` questions; private per-question `notes` for the presenter. |
| 3 | [`03-quick-quiz.yaml`](03-quick-quiz.yaml) | Grading: `correct:` options (secret until Reveal), `resultVisibility: hidden-until-close`, `pedagogy.explanation` for your debrief. |
| 4 | [`04-type-answer.yaml`](04-type-answer.yaml) | Scored short text: `correctAnswers` on `text` (trim + case-insensitive). |
| 5 | [`05-correct-order.yaml`](05-correct-order.yaml) | Ranking with `correctOrder` for a quiz key; Borda bars still show preference. |
| 6 | [`06-true-false.yaml`](06-true-false.yaml) | True/False as a `choice` preset (not a separate type). |
| 7 | [`exit-ticket.yaml`](exit-ticket.yaml) | A real teaching pattern: display styles (`dots`, `word-cloud`, `list`), `qna`, `allowDontKnow`, session `defaults`. |
| 8 | [`estimation.yaml`](estimation.yaml) | `numeric` questions with `unit`, `correct`, and `tolerance` — estimation reveals against the class distribution. |
| 9 | [`ranking.yaml`](ranking.yaml) | `ranking` questions (Borda scoring) for prioritisation debates. |
| 10 | [`peer-instruction.yaml`](peer-instruction.yaml) | The full method: `peerInstruction: true` vote → discuss → revote, with misconception-tagged options and round-2 reveal. |
| 11 | [`seg-camp.yaml`](seg-camp.yaml) | A complete workshop deck mixing everything above. |

Start with **0** (SimpleSession). Files 1+ are full Session — advanced. 10 is peer instruction — read its notes before running live.
