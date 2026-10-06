export type InventoryKind = 'implemented' | 'planned' | 'not-available';

export interface InventoryEntry {
  id: string;
  title: string;
  route: string;
  kind: InventoryKind;
  journeyIds: string[];
  note?: string;
}

export const INVENTORY: InventoryEntry[] = [
  { id: 'site-home', title: 'Product home', route: '/', kind: 'implemented', journeyIds: ['public-discovery'] },
  { id: 'site-docs', title: 'Documentation', route: '/docs/', kind: 'implemented', journeyIds: ['public-discovery'] },
  { id: 'participant-join', title: 'Participant join', route: '/join/', kind: 'implemented', journeyIds: ['public-discovery', 'live-classroom', 'qna-moderation'] },
  { id: 'stage', title: 'Projector stage', route: '/stage/', kind: 'implemented', journeyIds: ['live-classroom', 'qna-moderation'] },
  { id: 'host-home', title: 'Host workspace', route: '/host/', kind: 'implemented', journeyIds: ['public-discovery', 'classroom-authoring', 'tutor-workspace'] },
  { id: 'host-dashboard', title: 'Home dashboard', route: '#/', kind: 'implemented', journeyIds: ['classroom-authoring'] },
  { id: 'space-browser', title: 'Space and folder browser', route: '#/space', kind: 'implemented', journeyIds: ['tutor-workspace'] },
  { id: 'deck-new', title: 'New deck', route: '#/decks/new', kind: 'implemented', journeyIds: ['classroom-authoring', 'tutor-workspace'] },
  { id: 'deck', title: 'Deck detail', route: '#/decks/:deckId', kind: 'implemented', journeyIds: ['tutor-workspace'] },
  { id: 'deck-edit', title: 'Deck editor', route: '#/decks/:deckId/edit', kind: 'implemented', journeyIds: ['classroom-authoring', 'tutor-workspace'] },
  { id: 'host-live', title: 'Live host session', route: '#/sessions/:sessionCode', kind: 'implemented', journeyIds: ['classroom-authoring', 'live-classroom'] },
  { id: 'host-remote', title: 'Presenter remote', route: '#/sessions/:sessionCode/remote', kind: 'implemented', journeyIds: [] },
  { id: 'host-qna', title: 'Audience Q&A desk', route: '#/sessions/:sessionCode/qna', kind: 'implemented', journeyIds: ['qna-moderation'] },
  { id: 'session-notes', title: 'Notes', route: '#/sessions/:sessionId/record', kind: 'implemented', journeyIds: ['tutor-workspace'] },
  { id: 'tutor-contexts', title: 'Contexts', route: '#/tutor/contexts', kind: 'implemented', journeyIds: ['tutor-workspace'] },
  { id: 'tutor-context-new', title: 'New context', route: '#/tutor/contexts/new', kind: 'implemented', journeyIds: ['tutor-workspace'] },
  { id: 'tutor-context', title: 'Context detail/edit', route: '#/tutor/contexts/:contextId', kind: 'implemented', journeyIds: ['tutor-workspace'] },
  { id: 'tutor-trash', title: 'Trash', route: '#/tutor/trash', kind: 'implemented', journeyIds: ['tutor-workspace'] },
  { id: 'settings', title: 'Settings', route: '#/settings', kind: 'implemented', journeyIds: [] },
  { id: 'learner-view', title: 'Learner view', route: '#/learn', kind: 'implemented', journeyIds: [] },
  { id: 'ranking-journey', title: 'Ranking interaction walkthrough', route: '#/decks/new', kind: 'planned', journeyIds: [], note: 'Interaction exists in the editor but has no dedicated walkthrough chapter yet.' },
  { id: 'numeric-journey', title: 'Numeric estimation walkthrough', route: '#/decks/new', kind: 'planned', journeyIds: [], note: 'Interaction exists in the editor but remains a coverage gap.' },
  { id: 'original-documents', title: 'Original-document storage', route: 'product-boundary', kind: 'not-available', journeyIds: [], note: 'Preparation stays in the external agent.' },
  { id: 'slide-integrations', title: 'PowerPoint and Google Slides integrations', route: 'product-boundary', kind: 'not-available', journeyIds: [], note: 'Not available in the current product.' },
  { id: 'billing', title: 'Billing and subscriptions', route: 'product-boundary', kind: 'not-available', journeyIds: [], note: 'Not available in the current product.' },
  { id: 'custom-branding', title: 'Custom branding', route: 'product-boundary', kind: 'not-available', journeyIds: [], note: 'Not available in the current product.' },
  { id: 'public-self-hosting', title: 'Public self-hosting flow', route: 'product-boundary', kind: 'not-available', journeyIds: [], note: 'Not available in the current product.' },
];

