export type WalkthroughRole =
  | 'button'
  | 'heading'
  | 'link'
  | 'radio'
  | 'tab'
  | 'textbox'
  | 'region';

export type WalkthroughAction =
  | { type: 'goto'; path: string }
  | { type: 'gotoRuntime'; target: 'host' | 'stage' | 'participant' | 'qna' }
  | { type: 'expectRole'; role: WalkthroughRole; name: string; exact?: boolean; level?: number }
  | { type: 'expectText'; text: string; exact?: boolean }
  | { type: 'expectTextCount'; text: string; count: number; exact?: boolean }
  | { type: 'clickRole'; role: WalkthroughRole; name: string; exact?: boolean }
  | { type: 'clickText'; text: string; exact?: boolean }
  | { type: 'fillLabel'; label: string; value: string; exact?: boolean }
  | { type: 'checkLabel'; label: string; exact?: boolean; nth?: number }
  | { type: 'selectLabelText'; label: string; text: string; exact?: boolean }
  | { type: 'pause'; milliseconds: number };

export interface WalkthroughChapter {
  id: string;
  title: string;
  narration: string;
  actions: WalkthroughAction[];
}

export interface WalkthroughJourney {
  id: string;
  title: string;
  persona: string;
  purpose: string;
  outcome: string;
  prerequisites: string[];
  routes: string[];
  seed?: 'choice-session' | 'qna-session';
  status: 'scripted' | 'planned';
  chapters: WalkthroughChapter[];
}

export interface CreatedSession {
  sessionCode: string;
  code: string;
  hostToken: string;
  stageToken: string;
}

export interface RuntimePaths {
  host: string;
  stage: string;
  participant: string;
  qna: string;
}

export interface WalkthroughRuntime extends CreatedSession {
  journeyId: string;
  createdAt: string;
  paths: RuntimePaths;
}

