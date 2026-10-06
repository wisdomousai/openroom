export type FindingSeverity = 'high' | 'medium' | 'low';
export type FindingStatus = 'open' | 'accepted' | 'fixed';

export interface WalkthroughFinding {
  id: string;
  severity: FindingSeverity;
  status: FindingStatus;
  title: string;
  evidence: string;
  consequence: string;
  journeys: string[];
}

export const FINDINGS: WalkthroughFinding[] = [
  {
    id: 'OW-001',
    severity: 'low',
    status: 'fixed',
    title: 'Signed-out host bootstrap logs a 401 as a browser error',
    evidence: 'Opening /host/ while signed out requests /api/me and the browser console records a 401 error.',
    consequence: 'A strict browser-error gate treats the normal signed-out state as a failed walkthrough.',
    journeys: ['public-discovery'],
  },
  {
    id: 'OW-002',
    severity: 'low',
    status: 'fixed',
    title: 'Favicon is requested but missing',
    evidence: 'The host and participant pages request /favicon.ico and receive 404.',
    consequence: 'Console noise obscures real browser failures and the deployed shell has a missing asset.',
    journeys: ['public-discovery', 'live-classroom', 'qna-moderation'],
  },
  {
    id: 'OW-003',
    severity: 'medium',
    status: 'fixed',
    title: 'Live host page exposes nested main landmarks',
    evidence: 'The live host snapshot contains a main landmark nested inside another main landmark.',
    consequence: 'Screen-reader navigation has ambiguous page structure on the primary live surface.',
    journeys: ['live-classroom', 'classroom-authoring'],
  },
  {
    id: 'OW-004',
    severity: 'medium',
    status: 'fixed',
    title: 'New session preview shows sample answer metrics without an explicit sample label',
    evidence: 'The deck editor preview showed 21 answers with a 57%/43% split before a live session existed.',
    consequence: 'A host can mistake placeholder preview data for real participant responses.',
    journeys: ['classroom-authoring'],
  },
  {
    id: 'OW-005',
    severity: 'low',
    status: 'fixed',
    title: 'Live host console contains Three.js deprecation and context-loss noise',
    evidence: 'The live host emitted the deprecated THREE.Clock warning and a WebGL context-loss message during capture.',
    consequence: 'The signal-to-noise ratio is poor when diagnosing real presentation failures.',
    journeys: ['live-classroom'],
  },
  {
    id: 'OW-006',
    severity: 'medium',
    status: 'fixed',
    title: 'Journey status board disagrees with implemented Q&A journey',
    evidence: 'docs/journeys/README.md describes UC-05 as numeric estimation planned while e2e/journeys/UC-05-session-qna.spec.ts exercises session Q&A.',
    consequence: 'Coverage and release discussions can use the wrong status for a shipped capability.',
    journeys: ['qna-moderation'],
  },
  {
    id: 'OW-007',
    severity: 'medium',
    status: 'fixed',
    title: 'Session-wide Q&A is not discoverable in the browser editor',
    evidence: 'The live Q&A desk requires outline qna.enabled, but the session editor exposes no session-wide Q&A toggle.',
    consequence: 'A host must know the API/YAML contract to enable an otherwise implemented live feature.',
    journeys: ['qna-moderation', 'classroom-authoring'],
  },
  {
    id: 'OW-009',
    severity: 'high',
    status: 'fixed',
    title: 'Browser-started session launch hits local D1 schema drift',
    evidence: 'After demo sign-in, deck and version creation succeed, but POST /api/sessions returns 500 because the local sessions table has no deck_id column while recordSession inserts it. The migration that adds it exists in the checkout but is not applied to this local D1 database.',
    consequence: 'The browser authoring flow cannot launch a live session from a saved session until local migrations are applied; the failure is surfaced only after the host has completed authoring.',
    journeys: ['classroom-authoring', 'tutor-workspace'],
  },
  {
    id: 'OW-010',
    severity: 'high',
    status: 'fixed',
    title: 'Tutor create forms never submit because Save buttons default to type=button',
    evidence: 'Trace frames show the context form fully filled (name, subject, goals) with Save visible, but no POST /api/tutoring/contexts is sent. Host Button defaults to type="button", and Context, deck and session form primary actions omitted type="submit", so clickRole Save is a no-op.',
    consequence: 'The tutor workspace collection loads, but context, deck and session creation cannot complete from the browser until submit buttons declare type="submit".',
    journeys: ['tutor-workspace'],
  },
];
