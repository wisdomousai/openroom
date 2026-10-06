# End-user coverage map

Reviewed against the repository build on 2026-09-20. Paths below are implementation evidence for maintainers; the public chapters carry task instructions. Browser capture covers the sample teaching cycle. Other listed features were checked against current source contracts and existing journeys; this map does not claim a fresh live execution of every integration.

| User surface or capability | Manual chapter(s) | Owning implementation / evidence |
| --- | --- | --- |
| Sign-in, account, experience selection | start, account | `apps/host/src/AccountPanel.tsx`, `useAuth.ts`, `pages/SpaceNewPage.tsx`, `pages/SpaceEditPage.tsx`, `app-router.tsx` |
| Space/folder Library, selection, search, list/tiles | library | `components/LibraryList.tsx`, `components/ItemDetailPanel.tsx`, `pages/SpacePage.tsx` |
| New/rename/move/duplicate decks, folders | library, deck-editor | Library components, `pages/DeckEditorPage.tsx`, `delivery/decks.ts`, `apps/worker/src/workspace.ts` |
| Share, accept invite, role editing, removal | sharing | `pages/SpaceMemberPages.tsx`, `components/WorkspaceUpdates.tsx`, `apps/worker/src/members.ts` |
| Trash, restore, browser permanent deletion | library, limits | `pages/tutor/Trash.tsx`, `apps/worker/src/delivery/sessions.ts`, `apps/worker/src/workspace.ts` |
| Students/groups/classes and context fields | contexts | `pages/tutor/Contexts.tsx`, `components/ContextFieldsEditor.tsx` |
| Language pair and lookup | contexts, present | space settings, `live/useMeaningLookup.ts`, `dictionary-route.ts` |
| Complete sample lessons | start, contexts, slides | `pages/LessonExamplesPage.tsx`, `examples/tutoring/` |
| Full editor, draft saving, conflicts, history | deck-editor | `pages/deck-edit/DeckEditor.tsx`, `useDraftSave.ts`, `pages/DeckEditorPage.tsx` |
| Structured/freeform text, object manipulation | deck-editor, media | `SlideCanvas.tsx`, `FormatToolbar.tsx`, `ObjectFrame.tsx`, `properties/elements.tsx` |
| Slide types, galleries, workshop sequences | slides | `TemplateGallery.tsx`, `outline-edit/catalog.ts`, `packages/schema/src/slide-templates.ts` |
| Breakouts and reveal order/playback | slides, present | `BreakoutPickerDialog.tsx`, `properties/reveal.tsx`, `presenter/Presenter.tsx` |
| All eight question types and scoring policies | questions, participant | `AskDialog.tsx`, `properties/part-extras.tsx`, `packages/schema/src/types.ts`, `schema.ts` |
| Question type-specific displays and revote | questions, live-session | `LiveHost.tsx`, `LiveRibbon.tsx`, `packages/schema/src/schema.ts` |
| Themes, aspect ratios, masters, margins | design | `properties/deck-design.tsx`, `packages/schema/src/deck-design.ts` |
| Shared brand kits and lifecycle | design | `pages/BrandKitPages.tsx`, `properties/brand-kit.tsx` |
| Stock/link/upload/local pictures and media | media | `PictureDialog.tsx`, `properties/picture.tsx`, `apps/worker/src/assets.ts` |
| Audio, modes, transcripts, playback | media, present, participant | `properties/audio.tsx`, shared listening UI and SDK commands |
| HTML/SVG, Markdown, web embedding, PDF extraction | media | `HtmlElementDialog.tsx`, `MarkdownElementDialog.tsx`, `IframeElementDialog.tsx`, `PdfElementDialog.tsx` |
| Presenter before participation and starting in place | present, start | `presenter/Presenter.tsx`, `presenter/usePresentationKeys.ts` |
| Audience Stage, external displays, blanking | present | `live/HostHeader.tsx`, `LiveRibbon.tsx`, Desktop audience bridge |
| Text annotations, pen, dictionary meanings | present, participant | `LiveHost.tsx`, `live/useMeaningLookup.ts`, participant live views |
| Live slide editing and insertion | present | `LiveHost.tsx`, `LiveRibbon.tsx`, `live/` insertion controls |
| Open/close/reveal/reopen, countdown, freeze, end | live-session | `useHostSession.ts`, `LiveHost.tsx`, domain command handlers |
| Connection fallback, remote, rejoin | live-session, participant, troubleshooting | `Remote.tsx`, participant `session.ts`, SDK connection state |
| Session-wide Q&A, moderation, spotlight | facilitation | `QnaDesk.tsx`, `live/SessionAside.tsx` |
| Group membership, spokesperson, shared responses | facilitation, questions, participant | `live/GroupsPanel.tsx`, domain groups |
| Co-facilitation, handoff, recovery, revocation | facilitation, sharing | host facilitator strip, `apps/worker/src/index.ts`, entitlement checks |
| Anonymous, pseudonymous, identified, roster identity | live-session, participant, cli | schema defaults, participant `session.ts`, Worker `index.ts`, `roster.ts` |
| Learner link creation, replacement, expiry, revocation | learner-links | `pages/tutor/ContextLinks.tsx`, `apps/worker/src/context-links.ts` |
| Outcomes, tutor-private notes, next step, artifacts | notes, limits, learner | `pages/tutor/SessionNotes.tsx`, `apps/worker/src/learner.ts` |
| Reading, writing, voice, quiz homework and audiences | homework, learner | `packages/schema/src/homework.ts`, Notes form, learner task views |
| Practice checks, self-rating, retries, stale assignments | learner, review | `pages/learner/PracticeCard.tsx`, learner APIs, SRS domain |
| Voice recording/upload, private playback, trash/retention | learner, homework, review, limits | `pages/learner/VoiceTask.tsx`, `components/PrivateAudio.tsx`, Worker learner-audio |
| Writing/voice review, draft vs published feedback | review, learner | `pages/tutor/LearnerWork.tsx`, learner feedback service |
| Copy practice/corrections into slides or homework | review, homework | `PracticePicker.tsx`, `FeedbackPicker.tsx`, outline-edit practice/corrections |
| Results archive, HTML/CSV/JSON exports | results | `pages/SavedResultsPage.tsx`, Worker `archives.ts`, `export.ts` |
| Selected workshop recap and revision refresh | results | `pages/SessionRecapPage.tsx`, Worker recap endpoint |
| Desktop open/save/recovery/locking/offline | desktop | `pages/DesktopFileEditor.tsx`, `apps/desktop/src/main.ts` |
| Desktop linking, resources, sync conflict, start | desktop | `pages/DesktopLinkDialog.tsx`, `DesktopFileEditor.tsx`, package materialization |
| Local agent hosts, provider keys, model choice | desktop-agents | Desktop agent pane and `apps/desktop/src/agents/` |
| Agent attachments, reference folders, chats, interruption | desktop-agents | Desktop agent conversation and workspace services |
| PowerPoint local setup, embeds, rehearsal, composition | powerpoint | `apps/office/README.md`, taskpane/content app, Office adapter |
| PowerPoint activation, manual companion, reconnection | powerpoint | Office live and connection flows; native acceptance remains separate |
| Billing checkout, pending payment, portal, refresh | account | `pages/BillingPage.tsx`, `apps/worker/src/billing/` |
| Personal API tokens, connection revocation | account, agents | `pages/SettingsPage.tsx`, `components/ConnectedApps.tsx` |
| External MCP, account consent, token/stdio setup | agents, cli | `packages/mcp/src/tools.ts`, server instructions, CLI backend selection |
| CLI validate, author, versions, drafts, facilitate, export | cli | `packages/cli/src/run.ts`, `commands/` |
| Roster mint/list/revoke API workflow | cli | `apps/worker/src/roster.ts`, live roster routing in `index.ts` |
| Limits, visibility, retention, credential distinctions | limits | schema validators, `session-do.ts`, archives and learner-audio services |
| Keyboard, Reading view, languages, recovery guidance | shortcuts, troubleshooting | actual input handlers, learner copy, public manual browser checks |

## Verification boundaries

- The screenshot fixture uses synthetic local names and repository sample content. Provider calls, production Google sign-in, billing checkout, native Desktop, and native PowerPoint are not part of that fixture.
- All manual HTML comes from the Markdown collection. Search and text editions use the same collection. Screenshot refresh is explicit; ordinary manual verification does not mutate image assets.
- New controls need a corresponding chapter procedure or an explicit integration requirement. Keep route/field contracts in the authoritative server and schema references rather than expanding this map into a second API catalogue.
