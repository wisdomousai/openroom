# UC-16 — Complete practice formats on a phone

Status: green on local Chromium at 390 × 844.

Purpose: a learner can complete every supported homework question format with
honest, formative feedback.

Fixture: French multiple choice and short text; German gaps; bilingual matching;
ordered travel stages; a free response with no correctness key.

Surfaces: learner Practice tab and its current exercise card.

Lifecycle: select/check/save → enter incorrect then correct accented text → fill
gaps → match pairs → reorder → self-reflect → reload.

Acceptance:

- Multiple choice requires the complete correct set.
- Accent-sensitive text distinguishes `ete` from `été`; retry works.
- Gaps accept authored alternatives; matching and ranking are operable by touch.
- Questions with no answer key invite self-reflection rather than marking an
  opinion incorrect.
- Saving advances to the next exercise and progress persists after reload.
- No horizontal overflow at the tested viewport.
- Unit tests cover Unicode composition, German spelling alternatives, incomplete
  responses, invalid IDs, duplicate tasks and malformed published interactions.

Visual notes: minimum 44px interactive targets, visible selected state, correction
text as well as color, and keyboard-reachable matching/reordering controls.

Playwright: `e2e/journeys/UC-16-homework-practice.spec.ts`.
