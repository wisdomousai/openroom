/**
 * Control-plane HTTP client, split by domain. Import from `../api` — this
 * barrel keeps every call site on the same path it always had.
 *
 * Layout note: `learner.ts` is deliberately its own module — `/api/learner/*`
 * is a separate credential family (context access link), dispatched before the
 * control plane and never sharing its cookie path (AGENTS.md §Credential
 * boundary invariant).
 */
export * from './client';
export * from './auth';
export * from './tokens';
export * from './contexts';
export * from './dictionary-tools';
export * from './learner';
export * from './decks';
export * from './sessions';
export * from './spaces';
export * from './home';
export * from './assets';

export type { ContextKind, DeckShape, SessionStatus } from '@openroom/schema';
