# UC-41 — Homework documents and slide overflow

Run `bun run verify:browser UC-41-editor-overflow` after building the apps and collecting Worker assets.

- Homework and recap use naturally growing documents in a bounded scroll area. Mixed prose and typed tasks survive editing, clearing prose, removal and reload. Adding a task reveals and focuses it.
- Long question labels and short windows keep fields and actions reachable inside the editor.
- A single gap can be authored with typed answers or an optional word bank without extra words; changing the mode survives reload.
- Slide overflow updates while typing, before blur saves the outline. Review overflow lists the affected content and focuses its existing editor; correcting text removes the warning.
- Nested column clipping, cards, instructions, answer lists, word banks, text boxes and closed-shadow HTML are checked in 16:9, 16:10 and 4:3. Reading material retains its intentional scrolling.

The fixture uses the disposable local Worker. Screenshots capture the long homework document, short-window recap, overflow review and reading slides. UC-14 and UC-40 separately check default templates and composition across editor, presenter, projector and learner displays.
