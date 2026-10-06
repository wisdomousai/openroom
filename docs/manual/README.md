# Maintaining the end-user manual

The public manual is `/docs/`. Its editable source is `apps/site/src/content/docs/*.md`. Astro generates the chapter pages, full-text search index, `/llms.txt`, and `/llms-full.txt` from that collection. The site navigation and workspace Settings link to it.

Write direct instructions using visible control names. Explain prerequisites, results, visibility, errors, and consequential limits at the point of use. Keep implementation evidence in this directory. Keep user chapters free of rollout history, product comparisons, and narration about hypothetical users.

## Build and verify

From the repository root:

```sh
bun run build
bun run verify:browser --config manual/playwright.config.ts
```

The browser runner creates a disposable local Worker and database, with explicit demo configuration. It does not load production credentials or make provider calls. The manual checks cover every chapter link and fragment, loaded screenshots and alt text, both generated text editions, Markdown content negotiation, keyboard search, search recovery, browser Back, mobile overflow, legacy bookmarks, and print visibility.

For a content-only edit after the other apps are built:

```sh
bun run --filter openroom-site build
bun run --filter openroom-workspace-worker build
```

## Refresh screenshots

```sh
UPDATE_MANUAL_SCREENSHOTS=1 bun run verify:browser --config manual/playwright.config.ts --grep 'capture the manual'
bun run --filter openroom-site build
bun run --filter openroom-workspace-worker build
```

`e2e/manual/capture.spec.ts` performs the actual browser workflow against the local application. It creates a sample learner, uses the checked-in French B1 lesson, runs participation in a separate browser, saves Notes, submits writing, and publishes feedback. It writes PNGs into `apps/site/public/docs/images/`. Review every image before keeping it. Do not capture account secrets, active learner links, or production personal data.

Seven screenshots support the manual: Library, deck editor, gap exercise, live results, phone Reading view, session Notes, and phone feedback. Keep one image at a useful point in the relevant chapter. Native Desktop/PowerPoint and model-provider execution need their own real-device verification; web screenshots do not establish that acceptance.

## Source and coverage review

Use [coverage.md](coverage.md) when app functionality changes. Confirm labels against the current UI and semantics against the owning service/schema. The MCP server's tool descriptions remain the authoritative agent contract; the manual describes user workflows and links to discovery rather than copying the tool catalogue.

The manual targets the repository build. It is not evidence that the build is deployed. PowerPoint's local-preview requirements and billing/provider configuration requirements are part of the user-facing instructions.
