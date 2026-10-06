/**
 * @openroom/editor — the deck editor, presenter and live console.
 *
 * Everything here talks to its host through `EditorServices` (./services.tsx);
 * nothing imports an app, a router or a query cache.
 */
export * from './services';
export type * from './desktop-bridge';
export { desktopBridge } from './desktop-bridge';
export type * from './types';

export { blankDeck, downloadDeckFile, questionReadinessMessage, renameDeck } from './deck-document';

export { DeckEditor } from './deck-edit/DeckEditor';
export { DeckEditorTopBar } from './deck-edit/DeckEditorTopBar';
export { SlideThumbnail } from './deck-edit/SlideThumbnail';
export { DeckDesignPanel } from './deck-edit/properties/deck-design';
export { useDraftSave, type DraftStatus } from './deck-edit/useDraftSave';

export { Presenter, type PresentationPosition } from './presenter/Presenter';
export { PresentStage, presentableSteps } from './presenter/PresentationStage';

export { LiveHost } from './live/LiveHost';
export { PresenterRemote } from './live/PresenterRemote';
export { QnaDesk } from './live/QnaDesk';
export { useStageMirror } from './live/useStageMirror';
export { LiveServerCard, LiveServerDialog, liveServerBridge } from './live/LiveServer';
export { shouldHandOffNotes, type ProbeState } from './live/session-exit';

export { AgentPane } from './agent/AgentPane';
export { seedAgentWithReading } from './agent/agent-chat';
