# Information architecture

The spec the workspace surfaces are reviewed against. Two things: the **parity table**
(one live shell, two modes) and the **six information rules** (how items are found,
filed and named). Later phases are checked against these sentences, not against a
screenshot.

Related: [`DESIGN.md`](../DESIGN.md) (surfaces, two hues, named rules),
[`docs/TERMINOLOGY.md`](TERMINOLOGY.md) (UI vs API words),
[`AGENTS.md`](../AGENTS.md) (CRUD invariants, No-Ledger Rule).

---

## Parity: shared session vs tutoring

One shell. The **mode** changes the tools, never the layout. Mode is derived from the
session's launch chain — a session either has a context or it does not — not from a toggle
the host flips.

| Region | Shared session | Tutoring |
| --- | --- | --- |
| **Shell** | Header, left nav, three-column live layout | Identical |
| **Rail** | Join code + live join count | Learner, level, session number |
| **Plate** | Prompt + aggregate chart | Prompt + step content or chart |
| **Aside** | Outline steps + Q&A queue | Session steps + private notes |
| **Controls** | Open, close, reveal, second vote, next | Back, Next, Reveal, Close (live ribbon) |
| **Learner app** | Join by code, one tap to answer | No code; follows the tutor step by step |
| **After** | Aggregates purged, nothing kept | Short outcome record on the person |

**Note on the tutoring aside.** It is *session steps + private notes* — deliberately not
an in-session "record draft". Composing a durable, named-learner record from inside the
live session turns an ephemeral signal into a stored observation, which is the line drawn
in `docs/PRD.md` § Product principles (*operational aggregates, not participant surveillance data*) and
§ Explicit non-goals (*not an examination, proctoring, or surveillance system*). The notes are the
tutor's own, held client-side for the duration of the session; the record is composed
deliberately afterwards on `#/sessions/:id/record`. See Phase 5 of the design pass.

---

## Three pillars (decks · share · space)

Everything in the workspace maps to one of these. If a screen does not, cut it.

1. **Deck** — what you open, edit, and start (folder row or local `.openroom`). The UI
   word is **deck**; storage may be a file. Edit · Start · trash.
2. **Share / invite** — space membership; one shared tree of decks.
3. **Common tutoring space** — folders of decks; open when you teach.

Home is **not** a SaaS dashboard. It only resumes live teaching, points at folders, and
nags about an unwritten record. No week scores, no pin shelves, no “recently touched”
theater.

## The six information rules

1. **Location is implied, never asked.** Creating happens inside a folder you are already
   looking at. "New deck" inherits the folder — never a combobox of every folder you own.
2. **Folders nest.** One home per deck in the tree. Tags are gone — teachers do
   not cross-cut.
3. **Read and edit in place.** The inspector renames, moves and starts without a
   route change. Full authoring opens **Open** (the deck editor).
4. **Move is a tree, not a list.** The move picker is the same hierarchy as the sidebar,
   filterable, plus drag-and-drop. There is no multi-select toolbar.
5. **Type is stated in words.** A row says what it is, or the thumbnail says it.
   There is no colour reinforcement and no kind swatch. History rows are not a
   booking object and are not listed in the library.
6. **Decks first, browsing second.** Open folders and work. Home is a thin door, not a
   second product.

---

## The Library, as shipped (`#/space/:id`)

Three panes, always all three: **tree rail · list · inspector**. What each one owes:

- **Tree rail** — folders only, and the **count on a folder includes its
  descendants**. A folder reading `0` while holding a full subfolder would be a
  lie, and the count is the only reason to trust the tree as a map. All folder
  verbs (new · rename · duplicate · trash) live in the rail's **right-click
  context menu**; the list has no folder chrome of its own.
- **List** — **decks and folders only**. A row states what is *in* the file
  (`6 slides · 2 ask the class · homework`), never a date or a taught-count.
  **No sortable column headers**, no type-filter chips, no bulk-select band.
  One create button, **“New deck”**, which creates a **deck**.
- **Inspector** — permanent, never a drawer that opens on demand. It states what
  the item is and what to do next, carries the two identity edits (rename ·
  move) inline, and owns **trash**. There is no tags section and no fact table.
- **Nothing here schedules, plans, constrains, approves, or locks.** The verbs on
  this surface are open · start · duplicate · move · rename · trash. Sessions are
  not folder rows. Records live on the person's folder as a quiet group, on
  Home's write-record prompt, and on learner links.

## Deck editor, as shipped (`#/decks/:id/edit`)

The teacher-facing action is **Edit deck**; `deck` is the domain noun and
`DeckEditor` is the component behind the surface.

- **Full-bleed.** The editor hangs off the router root, not the workspace shell — no
  sidebar, no max-width, no page padding, the same as the live console. It is
  reached from a session, never from nav.
- **Three panes**: thumbnail rail · desk · task pane (Deck / Notes / History).
  All three edit one outline.
- The top bar's live-orange primary is **Start session**: stamp the version,
  file the session, launch it, and land in the live console. Starting is the only
  way a session is born.
