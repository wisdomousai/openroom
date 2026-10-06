import type { Outline, Session } from '@openroom/schema';
import { describe, expect, it } from 'vitest';

import {
  applyCommand,
  createSession,
  hostSnapshot,
  participantSnapshot,
  stageSnapshot,
} from '../src/index.js';
import { env, participant, run } from './helpers.js';

const outline: Outline = {
  version: 1,
  meta: { title: 'Travel', language: 'French', locale: 'fr' },
  defaults: { identityMode: 'identified', resultVisibility: 'hidden-until-close' },
  steps: [
    { id: 'welcome', kind: 'title', title: 'Bienvenue' },
    { id: 'check', kind: 'interaction', interactionId: 'form' },
  ],
  interactions: [
    {
      id: 'form',
      type: 'text',
      prompt: 'Write the sentence',
      correctAnswers: ["J'ai raté le train."],
    },
  ],
};

const session: Session = {
  version: 1,
  meta: { title: 'Travel' },
  defaults: { identityMode: 'identified', resultVisibility: 'hidden-until-close' },
  interactions: outline.interactions,
};

function liveSession() {
  let state = createSession(outline, 'LIVE0001', 0, { outlineVersion: 1 });
  state = run(state, env({ command: 'session.start' }));
  return state;
}

describe('tutoring closed answers', () => {
  it('classroom hidden-until-close stays blank until reveal', () => {
    let state = createSession(session, 'CLASS001', 0);
    state = run(state, env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'form' }));
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'form', answer: { kind: 'text', text: 'hello' } },
        participant('lea'),
      ),
    );
    state = run(state, env({ command: 'interaction.close', interactionId: 'form' }));
    expect(participantSnapshot(state, 'lea').results).toBeNull();
    expect(stageSnapshot(state).aggregate).toBeNull();
  });

  it('tutoring closed shows named answers without the key', () => {
    let state = liveSession();
    state = {
      ...state,
      participants: { lea: { joinedAt: 0, handle: 'Léa' } },
    };
    state = run(state, env({ command: 'outline.goto', stepId: 'check' }));
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'form', answer: { kind: 'text', text: 'hello' } },
        participant('lea'),
      ),
    );
    state = run(state, env({ command: 'interaction.close', interactionId: 'form' }));
    const stage = stageSnapshot(state);
    expect(stage.aggregate?.kind).toBe('text');
    if (stage.aggregate?.kind === 'text') {
      expect(stage.aggregate.entries[0]?.text).toBe('hello');
      expect(stage.aggregate.entries[0]?.handle).toBe('Léa');
    }
    const serialized = JSON.stringify(participantSnapshot(state, 'lea'));
    expect(serialized).not.toContain('correctAnswers');
    expect(serialized).not.toContain("J'ai raté");
  });
});

describe('split cards', () => {
  it('gives each learner only their laned cards', () => {
    const split: Outline = {
      ...outline,
      steps: [
        {
          id: 'roles',
          kind: 'cards',
          title: 'Roles',
          items: [
            { text: 'You are the waiter', lane: 0 },
            { text: 'You are the customer', lane: 1 },
            { text: 'Shared rule: be polite' },
          ],
        },
      ],
    };
    let state = createSession(split, 'SPLIT001', 0, { outlineVersion: 1 });
    state = run(state, env({ command: 'session.start' }));
    state = {
      ...state,
      participants: {
        lea: { joinedAt: 1, handle: 'Léa', lane: 0 },
        tom: { joinedAt: 2, handle: 'Tom', lane: 1 },
      },
    };
    const lea = participantSnapshot(state, 'lea').outline?.currentStep;
    const tom = participantSnapshot(state, 'tom').outline?.currentStep;
    expect(lea && lea.kind === 'cards' ? lea.items.map((item) => item.text) : []).toEqual([
      'You are the waiter',
      'Shared rule: be polite',
    ]);
    expect(tom && tom.kind === 'cards' ? tom.items.map((item) => item.text) : []).toEqual([
      'You are the customer',
      'Shared rule: be polite',
    ]);
    const stage = stageSnapshot(state).outline?.currentStep;
    expect(stage && stage.kind === 'cards' ? stage.items.length : 0).toBe(3);
  });

  it('tells each learner which half of the pair they are, and the stage neither', () => {
    let state = createSession(outline, 'SPLIT002', 0, { outlineVersion: 1 });
    state = run(state, env({ command: 'session.start' }));
    state = {
      ...state,
      participants: {
        lea: { joinedAt: 1, lane: 0 },
        tom: { joinedAt: 2, lane: 1 },
        sam: { joinedAt: 3 },
      },
    };
    expect(participantSnapshot(state, 'lea').outline?.yourLane).toBe(0);
    expect(participantSnapshot(state, 'tom').outline?.yourLane).toBe(1);
    // No lane at all — an unpaired learner, and the shared screen.
    expect(participantSnapshot(state, 'sam').outline?.yourLane).toBeUndefined();
    expect(stageSnapshot(state).outline?.yourLane).toBeUndefined();
  });
});

describe('marks and meaning', () => {
  it('publishes a circle to every surface and clears it on next', () => {
    let state = liveSession();
    state = run(
      state,
      env({ command: 'mark.set', mark: { kind: 'circle', partKey: 'header', token: 0 } }),
    );
    expect(hostSnapshot(state).marks).toEqual([
      { kind: 'circle', partKey: 'header', token: 0, color: 'red', id: expect.any(String) },
    ]);
    expect(stageSnapshot(state).marks).toHaveLength(1);
    expect(participantSnapshot(state, 'lea').marks).toHaveLength(1);
    state = run(state, env({ command: 'outline.next' }));
    expect(hostSnapshot(state).marks).toBeUndefined();
    expect(stageSnapshot(state).marks).toBeUndefined();
  });

  it('paints in the colour the tutor chose and rejects any other', () => {
    let state = liveSession();
    state = run(
      state,
      env({ command: 'mark.set', mark: { kind: 'pen', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: 'green' } }),
    );
    expect(stageSnapshot(state).marks?.[0]?.color).toBe('green');
    // Ink drawn before colours existed is red, so an old session still reads.
    state = run(state, env({ command: 'mark.set', mark: { kind: 'circle', partKey: 'header', token: 1 } }));
    expect(stageSnapshot(state).marks?.[1]?.color).toBe('red');
    const rejected = applyCommand(
      state,
      env({
        command: 'mark.set',
        mark: { kind: 'circle', partKey: 'header', token: 2, color: 'blue' as 'red' },
      }),
      0,
    );
    expect(rejected.ok).toBe(false);
  });

  it('marks a span of words, and only a span that runs forwards', () => {
    let state = liveSession();
    state = run(
      state,
      env({
        command: 'mark.set',
        mark: { kind: 'underline', partKey: 'header', token: 1, endToken: 3, color: 'green' },
      }),
    );
    expect(stageSnapshot(state).marks?.[0]).toMatchObject({
      kind: 'underline',
      partKey: 'header',
      token: 1,
      endToken: 3,
      color: 'green',
    });
    // A span of one word is a word: stored without an end.
    state = run(
      state,
      env({
        command: 'mark.set',
        mark: { kind: 'highlight', partKey: 'body', token: 4, endToken: 4 },
      }),
    );
    expect(stageSnapshot(state).marks?.[1]).not.toHaveProperty('endToken');

    for (const bad of [{ endToken: 0 }, { endToken: 2.5 }]) {
      const rejected = applyCommand(
        state,
        env({
          command: 'mark.set',
          mark: { kind: 'rectangle', partKey: 'header', token: 1, ...bad },
        }),
        0,
      );
      expect(rejected.ok).toBe(false);
    }
  });

  it('refuses a shape the surfaces cannot draw', () => {
    const state = liveSession();
    const rejected = applyCommand(
      state,
      env({
        command: 'mark.set',
        mark: { kind: 'scribble' as 'circle', partKey: 'header', token: 0 },
      }),
      0,
    );
    expect(rejected.ok).toBe(false);
  });

  it('rubs out exactly one mark by id', () => {
    let state = liveSession();
    state = run(state, env({ command: 'mark.set', mark: { kind: 'circle', partKey: 'header', token: 0 } }));
    state = run(state, env({ command: 'mark.set', mark: { kind: 'strikethrough', partKey: 'header', token: 1 } }));
    const [first, second] = hostSnapshot(state).marks ?? [];
    // Ids come from the revision the mark landed on, so they are stable across
    // a replay and mean the same mark on every surface.
    expect(first?.id).not.toBe(second?.id);

    state = run(state, env({ command: 'mark.remove', id: first?.id ?? '' }));
    expect(hostSnapshot(state).marks).toHaveLength(1);
    expect(stageSnapshot(state).marks?.[0]?.id).toBe(second?.id);

    // Rubbing out what is already gone is a retry, not an error.
    const before = state.revision;
    state = run(state, env({ command: 'mark.remove', id: first?.id ?? '' }));
    expect(state.revision).toBe(before);

    state = run(state, env({ command: 'mark.remove', id: second?.id ?? '' }));
    expect(hostSnapshot(state).marks).toBeUndefined();
  });

  it('clear takes the meaning away with the ink', () => {
    let state = liveSession();
    state = run(state, env({ command: 'meaning.publish', stepId: 'welcome', word: 'Bienvenue', partKey: 'header', token: 0, text: 'to miss' }));
    state = run(state, env({ command: 'mark.clear' }));
    expect(hostSnapshot(state).meaning).toBeUndefined();
    expect(stageSnapshot(state).meaning).toBeUndefined();
    expect(participantSnapshot(state, 'lea').meaning).toBeUndefined();
  });

  it('caps the ink a step can hold', () => {
    let state = liveSession();
    // A stroke keeps its first 200 points; the tail is dropped, not refused.
    const long = Array.from({ length: 500 }, (_, index) => ({ x: index / 500, y: 0.5 }));
    state = run(state, env({ command: 'mark.set', mark: { kind: 'pen', points: long } }));
    const stored = hostSnapshot(state).marks?.[0];
    expect(stored?.kind === 'pen' ? stored.points.length : 0).toBe(200);

    for (let index = 1; index < 50; index += 1) {
      state = run(state, env({ command: 'mark.set', mark: { kind: 'circle', partKey: 'header', token: index } }));
    }
    expect(hostSnapshot(state).marks).toHaveLength(50);
    const overflow = applyCommand(
      state,
      env({ command: 'mark.set', mark: { kind: 'circle', partKey: 'header', token: 99 } }),
      0,
    );
    expect(overflow.ok).toBe(false);
  });


});

/** A minimal real entry: one section, one row, inside every cap. */
const ENTRY = {
  word: 'gehst',
  lemma: 'gehen',
  lang: 'de',
  pos: 'verb',
  headword: 'gehen',
  labels: ['strong', 'aux: sein'],
  senses: [{ gloss: 'to go, to walk' }],
  sections: [
    {
      key: 'indicative-present',
      label: 'Indicative present',
      columnLabels: ['singular', 'plural'],
      rows: [{ label: '1st person', cells: ['gehe', 'gehen'] }],
    },
  ],
  resolvedFrom: 'gehst',
  source: { name: 'kaikki', url: 'https://kaikki.org/x' },
};

describe('the dictionary table on the wall', () => {
  it('publishes and replaces the whole card atomically, including typed-only replacement', () => {
    let state = liveSession();
    const before = state.revision;
    state = run(state, env({ command: 'meaning.publish', stepId: 'welcome', partKey: 'header', token: 0, word: 'gehst', text: 'you go', entry: ENTRY }));
    expect(state.revision).toBe(before + 1);
    for (const snapshot of [stageSnapshot(state), participantSnapshot(state, 'lea')]) {
      expect(snapshot.meaning?.text).toBe('you go');
      expect(snapshot.dictionary?.entry).toEqual(ENTRY);
    }
    state = run(state, env({ command: 'meaning.publish', stepId: 'welcome', partKey: 'header', token: 1, word: 'train', text: 'le train' }));
    expect(stageSnapshot(state).meaning?.word).toBe('train');
    expect(stageSnapshot(state).dictionary).toBeUndefined();
    // An old card's take-down must not remove a different word's card.
    const displayed = state;
    state = run(state, env({ command: 'meaning.clear', stepId: 'welcome', partKey: 'header', token: 0 }));
    expect(state.revision).toBe(displayed.revision);
    state = run(state, env({ command: 'meaning.publish', stepId: 'welcome', partKey: 'header', token: 0, word: 'gehst', entry: ENTRY }));
    expect(stageSnapshot(state).meaning).toBeUndefined();
    expect(stageSnapshot(state).dictionary?.entry).toEqual(ENTRY);
    state = run(state, env({ command: 'meaning.clear', stepId: 'welcome', partKey: 'header', token: 0 }));
    expect(stageSnapshot(state).meaning).toBeUndefined();
    expect(stageSnapshot(state).dictionary).toBeUndefined();
  });

  it('rejects a late publication after navigation and invalid cards without changing the current card', () => {
    let state = liveSession();
    state = run(state, env({ command: 'meaning.publish', stepId: 'welcome', partKey: 'header', token: 0, word: 'gehst', text: 'you go', entry: ENTRY }));
    const published = stageSnapshot(state);
    for (const patch of [{ text: 'x'.repeat(201) }, { entry: { word: 'invalid' } }, { text: undefined, entry: undefined }, { word: undefined }, { token: -1 }]) {
      const result = applyCommand(state, env({ command: 'meaning.publish', stepId: 'welcome', partKey: 'header', token: 0, word: 'gehst', text: 'you go', entry: ENTRY, ...patch } as never), 0);
      expect(result.ok).toBe(false);
      expect(stageSnapshot(state)).toEqual(published);
    }
    state = run(state, env({ command: 'outline.next' }));
    const result = applyCommand(state, env({ command: 'meaning.publish', stepId: 'welcome', partKey: 'header', token: 0, word: 'gehst', text: 'you go' }), 0);
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('E_REVISION_CONFLICT');
    expect(stageSnapshot(state).meaning).toBeUndefined();
  });

  it('names the table from the revision it lands on, so a replay rebuilds it', () => {
    let state = liveSession();
    state = run(state, env({ command: 'meaning.publish', stepId: 'welcome', word: 'gehst', partKey: 'header', token: 0, entry: ENTRY }));
    const first = hostSnapshot(state).dictionary;
    expect(first?.id).toBe(`d${String(state.revision)}`);
    expect(first?.entry.lemma).toBe('gehen');
  });

  it('replaces rather than accumulates — one wall, one table', () => {
    let state = liveSession();
    state = run(state, env({ command: 'meaning.publish', stepId: 'welcome', word: 'gehst', partKey: 'header', token: 0, entry: ENTRY }));
    state = run(state, env({ command: 'meaning.publish', stepId: 'welcome', word: 'gehst', partKey: 'header', token: 2, entry: ENTRY }));
    expect(hostSnapshot(state).dictionary?.token).toBe(2);
  });

  it('reaches the projector and the phone the moment it is shown', () => {
    let state = liveSession();
    state = run(state, env({ command: 'meaning.publish', stepId: 'welcome', word: 'gehst', partKey: 'header', token: 0, entry: ENTRY }));
    expect(stageSnapshot(state).dictionary?.entry.lemma).toBe('gehen');
    expect(participantSnapshot(state, 'lea').dictionary?.entry.lemma).toBe('gehen');
    state = run(state, env({ command: 'meaning.clear', stepId: 'welcome', partKey: 'header', token: 0 }));
    expect(stageSnapshot(state).dictionary).toBeUndefined();
    expect(participantSnapshot(state, 'lea').dictionary).toBeUndefined();
  });

  it('goes away with the ink and with the slide', () => {
    let state = liveSession();
    state = run(state, env({ command: 'meaning.publish', stepId: 'welcome', word: 'gehst', partKey: 'header', token: 0, entry: ENTRY }));
    state = run(state, env({ command: 'mark.clear' }));
    expect(hostSnapshot(state).dictionary).toBeUndefined();

    state = run(state, env({ command: 'meaning.publish', stepId: 'welcome', word: 'gehst', partKey: 'header', token: 0, entry: ENTRY }));
    state = run(state, env({ command: 'outline.next' }));
    expect(hostSnapshot(state).dictionary).toBeUndefined();
  });

  /*
   * This state rides in every snapshot to every phone, so the DO re-checks the
   * size the API already checked. A client that skips the API must not be able
   * to make the session broadcast a megabyte.
   */
  it('refuses an entry too large to project', () => {
    const state = liveSession();
    const huge = {
      ...ENTRY,
      sections: Array.from({ length: 24 }, (_, index) => ({
        key: `s${String(index)}`,
        label: 'x'.repeat(40),
        columnLabels: Array.from({ length: 8 }, (_, c) => `col${String(c)}`),
        rows: Array.from({ length: 12 }, (_, r) => ({
          label: `row${String(r)}`,
          cells: Array.from({ length: 8 }, () => 'y'.repeat(40)),
        })),
      })),
    };
    const result = applyCommand(
      state,
      env({ command: 'meaning.publish', stepId: 'welcome', word: 'gehst', partKey: 'header', token: 0, entry: huge }),
      0,
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.error.code : null).toBe('E_INVALID_ANSWER');
  });

  it('refuses something that is not a dictionary entry', () => {
    const state = liveSession();
    const result = applyCommand(
      state,
      env({ command: 'meaning.publish', stepId: 'welcome', word: 'gehst', partKey: 'header', token: 0, entry: { word: 'x' } as never }),
      0,
    );
    expect(result.ok).toBe(false);
  });

  it('is a silent success to hide a table that is not up', () => {
    const state = liveSession();
    const result = applyCommand(state, env({ command: 'meaning.clear', stepId: 'welcome', partKey: 'header', token: 0 }), 0);
    expect(result.ok).toBe(true);
  });
});
