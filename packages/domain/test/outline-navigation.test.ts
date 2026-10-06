import { defaultDeckDesign, type Outline } from '@openroom/schema';
import { describe, expect, it } from 'vitest';

import {
  applyCommand,
  createSession,
  hostSnapshot,
  participantSnapshot,
  stageSnapshot,
} from '../src/index.js';
import { env, expectError, fixtureSpec, run } from './helpers.js';

const outline: Outline = {
  version: 1,
  meta: { title: 'Tutoring outline', subject: 'French', level: 'B1' },
  steps: [
    { id: 'welcome', kind: 'title', title: 'Bienvenue', tutorNotes: 'Ask an opening question.' },
    { id: 'activity', kind: 'activity', title: 'Say it aloud', instructions: ['Read the phrase.'] },
    { id: 'poll', kind: 'interaction', interactionId: 'single-choice' },
    { id: 'debrief', kind: 'debrief', title: 'Review', prompts: ['What did you notice?'] },
  ],
  interactions: fixtureSpec.interactions,
};

function outlineRoom() {
  return createSession(outline, 'OUTLINE0001', 0, { outlineVersion: 3 });
}

describe('outline session navigation', () => {
  it('projects only the current slide design with its resolved master to audience clients', () => {
    const designed = structuredClone(outline);
    designed.design = defaultDeckDesign('business');
    designed.design.masters.push({ id: 'section', name: 'Section', safeArea: 8, decoration: 'rule', footer: 'Workshop' });
    designed.steps[0]!.design = { masterId: 'section' };
    const state = run(createSession(designed, 'DESIGN01', 0), env({ command: 'session.start' }));
    for (const view of [stageSnapshot(state).outline, participantSnapshot(state, 'p1').outline]) {
      expect(view?.design).toMatchObject({ aspectRatio: '16:9', theme: { family: 'business' }, safeArea: 8, footer: 'Workshop' });
      expect(view?.design).not.toHaveProperty('masters');
      expect(view?.currentStep).not.toHaveProperty('tutorNotes');
    }
  });
  it('compiled poll outlines start without opening a question', () => {
    const session = createSession(fixtureSpec, 'PLAIN001', 0);
    expect(session.outline.content.steps.every((step) => step.kind === 'interaction')).toBe(true);
    const live = run(session, env({ command: 'session.start' }));
    expect(live.status).toBe('live');
    expect(live.activeInteractionId).toBeNull();
  });

  it('activates step 0 on session.start (interaction-first outlines open the poll)', () => {
    const interactionFirst: Outline = {
      ...outline,
      steps: [
        { id: 'poll', kind: 'interaction', interactionId: 'single-choice' },
        { id: 'debrief', kind: 'debrief', title: 'Review', prompts: ['What did you notice?'] },
      ],
    };
    const session = createSession(interactionFirst, 'IFIRST01', 0, { outlineVersion: 1 });
    const state = run(session, env({ command: 'session.start' }));
    expect(state.status).toBe('live');
    expect(state.outline?.currentStepIndex).toBe(0);
    expect(state.activeInteractionId).toBe('single-choice');
    expect(state.interactions['single-choice']?.status).toBe('open');
  });

  it('navigates content and interaction steps atomically', () => {
    let state = run(outlineRoom(), env({ command: 'session.start' }));
    expect(state.outline?.currentStepIndex).toBe(0);
    expect(state.activeInteractionId).toBeNull();

    const revision = state.revision;
    state = run(state, env({ command: 'outline.next' }), 100);
    expect(state.revision).toBe(revision + 1);
    expect(state.outline?.currentStepIndex).toBe(1);
    expect(state.activeInteractionId).toBeNull();

    state = run(state, env({ command: 'outline.next' }), 200);
    expect(state.outline?.currentStepIndex).toBe(2);
    expect(state.activeInteractionId).toBe('single-choice');
    expect(state.interactions['single-choice']?.status).toBe('open');

    state = run(state, env({ command: 'outline.next' }), 300);
    expect(state.outline?.currentStepIndex).toBe(3);
    expect(state.activeInteractionId).toBeNull();
    expect(state.interactions['single-choice']?.status).toBe('closed');
  });

  it('supports direct goto and previous without a second interaction command', () => {
    let state = run(outlineRoom(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'outline.goto', stepId: 'poll' }));
    expect(state.activeInteractionId).toBe('single-choice');
    state = run(state, env({ command: 'outline.next' }));
    state = run(state, env({ command: 'outline.previous' }));
    expect(state.activeInteractionId).toBe('single-choice');
    expect(state.interactions['single-choice']?.status).toBe('open');
    expectError(state, env({ command: 'outline.goto', stepId: 'missing' }), 'E_UNKNOWN_OUTLINE_STEP');
  });

  it('keeps tutor notes out of learner and stage snapshots', () => {
    const state = run(outlineRoom(), env({ command: 'session.start' }));
    const participant = participantSnapshot(state, 'p1');
    const stage = stageSnapshot(state);
    const host = hostSnapshot(state);
    expect(participant.outline?.currentStep).not.toHaveProperty('tutorNotes');
    expect(stage.outline?.currentStep).not.toHaveProperty('tutorNotes');
    expect(JSON.stringify(participant.outline)).not.toContain('opening question');
    expect(host.outline?.content.steps[0]).toHaveProperty('tutorNotes');
  });

  it('inserts an approved live step privately or shows it in one mutation', () => {
    let state = run(outlineRoom(), env({ command: 'session.start' }));
    state = run(state, env({
      command: 'outline.insert',
      step: {
        id: 'generated-words',
        kind: 'cards',
        title: 'Choose a word',
        items: [{ text: 'gare' }, { text: 'quai' }, { text: 'billet' }],
        tutorNotes: 'Generated privately and approved by the tutor.',
      },
    }));
    expect(state.outline?.content.steps[1]?.id).toBe('generated-words');
    expect(state.outline?.currentStepIndex).toBe(0);

    state = run(state, env({ command: 'outline.goto', stepId: 'activity' }));
    state = run(state, env({
      command: 'outline.insert',
      show: true,
      step: { id: 'live-example', kind: 'term', term: 'le quai', meaning: 'the platform' },
    }));
    expect(stageSnapshot(state).outline?.currentStep).toMatchObject({ id: 'live-example', kind: 'term' });
  });

  it('goto to the current interaction step re-opens a closed poll (not a detectNoop)', () => {
    let state = run(outlineRoom(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'outline.goto', stepId: 'poll' }));
    expect(state.interactions['single-choice']?.status).toBe('open');
    state = run(state, env({ command: 'outline.next' }));
    expect(state.interactions['single-choice']?.status).toBe('closed');
    state = run(state, env({ command: 'outline.goto', stepId: 'poll' }));
    expect(state.outline?.currentStepIndex).toBe(2);
    expect(state.activeInteractionId).toBe('single-choice');
    expect(state.interactions['single-choice']?.status).toBe('open');
  });

  it('private insert before the live cursor keeps the host on the same step', () => {
    let state = run(outlineRoom(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'outline.goto', stepId: 'activity' }));
    expect(state.outline?.currentStepIndex).toBe(1);
    state = run(state, env({
      command: 'outline.insert',
      afterStepId: 'welcome',
      step: { id: 'warmup', kind: 'title', title: 'Warm-up' },
    }));
    expect(state.outline?.content.steps.map((step) => step.id)).toEqual([
      'welcome',
      'warmup',
      'activity',
      'poll',
      'debrief',
    ]);
    expect(state.outline?.currentStepIndex).toBe(2);
    expect(state.outline?.content.steps[state.outline.currentStepIndex]?.id).toBe('activity');
  });

  it('replaces a content slide in place without moving the cursor', () => {
    let state = run(outlineRoom(), env({ command: 'session.start' }));
    state = run(state, env({
      command: 'outline.insert',
      show: true,
      step: { id: 'live-term', kind: 'term', term: 'le quai', meaning: 'the platform' },
    }));
    expect(state.outline?.currentStepIndex).toBe(1);
    state = run(state, env({
      command: 'outline.replace',
      stepId: 'live-term',
      step: { id: 'live-term', kind: 'term', term: 'la gare', meaning: 'the station' },
    }));
    expect(state.outline?.currentStepIndex).toBe(1);
    expect(state.outline?.content.steps[1]).toMatchObject({
      id: 'live-term',
      term: 'la gare',
      meaning: 'the station',
    });
  });

  it('inserts a live poll with its interaction definition', () => {
    let state = run(outlineRoom(), env({ command: 'session.start' }));
    state = run(state, env({
      command: 'outline.insert',
      show: true,
      step: {
        id: 'live-poll-step',
        kind: 'interaction',
        interactionId: 'live-poll',
        title: 'Warm-up?',
      },
      interaction: {
        id: 'live-poll',
        type: 'choice',
        prompt: 'Warm-up?',
        options: [
          { id: 'o1', label: 'Yes' },
          { id: 'o2', label: 'No' },
        ],
      },
    }));
    expect(state.outline.content.interactions.some((row) => row.id === 'live-poll')).toBe(true);
    expect(state.interactions['live-poll']?.status).toBe('open');
    expect(state.activeInteractionId).toBe('live-poll');
    expect(stageSnapshot(state).outline?.currentStep).toMatchObject({
      id: 'live-poll-step',
      kind: 'interaction',
    });
  });

  it('refuses to replace an interaction step', () => {
    const state = run(outlineRoom(), env({ command: 'session.start' }));
    const result = applyCommand(
      state,
      env({
        command: 'outline.replace',
        stepId: 'poll',
        step: { id: 'poll', kind: 'statement', body: 'nope' },
      }),
    );
    expect(result.ok).toBe(false);
  });
});


describe('presentation to participation', () => {
  const deck: Outline = {
    ...outline,
    steps: [
      outline.steps[0]!,
      { id: 'words', kind: 'term', term: 'Bonjour', meaning: 'Hello', reveal: [['header'], ['body']], tutorNotes: 'Private notes' },
      { id: 'extra', kind: 'title', title: 'On demand', breakoutOf: { stepId: 'words', afterKey: 'header' } },
      outline.steps[2]!,
    ],
  };
  it('starts at the current reveal and advances without revisiting earlier slides', () => {
    let state = run(createSession(deck, 'PRESENT01', 0), env({ command: 'session.start', cursor: { stepId: 'words', shown: 1 } }));
    expect(state.outline).toMatchObject({ currentStepIndex: 1, shownGroups: 1 });
    expect(stageSnapshot(state).outline).toMatchObject({ shownGroups: 1, hiddenParts: ['body'] });
    expect(participantSnapshot(state).outline?.currentStep).not.toHaveProperty('tutorNotes');
    state = run(state, env({ command: 'outline.next' }));
    expect(state.outline).toMatchObject({ currentStepIndex: 1, shownGroups: 2 });
    state = run(state, env({ command: 'outline.next' }));
    expect(state.outline?.currentStepIndex).toBe(3);
    expect(state.activeInteractionId).toBe('single-choice');
    expect(JSON.stringify(stageSnapshot(state).interaction)).not.toContain('because reasons');
    state = run(state, env({ command: 'outline.previous' }));
    expect(state.outline).toMatchObject({ currentStepIndex: 1, shownGroups: 2 });
    state = run(state, env({ command: 'outline.previous' }));
    expect(state.outline).toMatchObject({ currentStepIndex: 1, shownGroups: 1 });
    for (const view of [stageSnapshot(state).outline, participantSnapshot(state).outline]) {
      expect(view?.hiddenParts).toEqual(['body']);
    }
    state = run(state, env({ command: 'outline.previous' }));
    expect(state.outline).toMatchObject({ currentStepIndex: 0, shownGroups: 1 });
  });
  it('rejects invalid positions and reveals aimed at a different slide', () => {
    const lobby = createSession(deck, 'PRESENT02', 0);
    expectError(lobby, env({ command: 'session.start', cursor: { stepId: 'missing', shown: 1 } }), 'E_INVALID_OUTLINE_STEP');
    expectError(lobby, env({ command: 'session.start', cursor: { stepId: 'words', shown: 99 } }), 'E_INVALID_OUTLINE_STEP');
    const state = run(lobby, env({ command: 'session.start', cursor: { stepId: 'words', shown: 1 } }));
    expectError(state, env({ command: 'outline.reveal', stepId: 'welcome', shown: 0 }), 'E_INVALID_OUTLINE_STEP');
    const revealed = run(state, env({ command: 'outline.reveal', stepId: 'words', shown: 2 }));
    expect(stageSnapshot(revealed).outline?.hiddenParts).toEqual([]);
  });
});
