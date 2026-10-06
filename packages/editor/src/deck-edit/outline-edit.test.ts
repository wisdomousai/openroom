/**
 * The deck editor's structural edits.
 *
 * These are the operations every button in the ribbon and the properties panel
 * eventually calls, and they are pure: outline in, outline out. So the whole
 * editor's behaviour can be pinned here rather than through a rendered tree —
 * and the two invariants that matter are checked directly:
 *
 *   1. every result still validates against the outline contract, and
 *   2. `partKeysForStep` still matches what the step is actually made of.
 *
 * The second is the known bug class: a list op that adds an option without the
 * reveal order noticing, or a media edit that leaves an `image` part behind.
 */
import {
  ELEMENT_BOX_MAX,
  ELEMENT_BOX_MIN,
  kindCanCarryElements,
  partKeysForStep,
  stepElements,
  validateOutline,
  type Interaction,
  type Outline,
  type OutlineStep,
} from '@openroom/schema';
import { describe, expect, it } from 'vitest';

import {
  ELEMENT_LAYOUTS,
  applyElementLayout,
  elementLayoutsFor,
  clearPartStyling,
  partSpanCapable,
  partSpans,
  stylePartRange,
  INSERT_CATALOG,
  INSERT_KINDS,
  INSERT_TOP,
  starterStep,
  stepTitle,
  addListItem,
  canAddListItem,
  canRemoveListItem,
  clearPairWork,
  duplicateStep,
  insertAfter,
  moveBlock,
  optionCorrect,
  optionsFor,
  orderedBlocks,
  partFont,
  partFontOnly,
  partLabel,
  promptFor,
  promptFontFor,
  removeListItem,
  removeMedia,
  removeStep,
  setDurationSeconds,
  setInteraction,
  setPartFont,
  addTextElement,
  addImageElement,
  addIframeElement,
  applyPictureTarget,
  addPdfElement,
  clearElementStyling,
  setElementAlign,
  setElementBox,
  setElementIframe,
  setElementPdf,
  setElementSpans,
  setElementText,
  styleElementRange,
  setMedia,
  setMediaPlace,
  setMediaSize,
  setMinutes,
  setOptionCorrect,
  setGapAnswers,
  setGapDistractors,
  setFillTheGapsBank,
  insertGapAtRange,
  setPartText,
  setReveal,
  splitForPairWork,
  addHomeworkQuiz,
  addHomeworkReading,
  removeHomeworkTask,
  setHomework,
  setRecap,
  setTimerPlacement,
  setTimerPersist,
  setTimerStyle,
  stepMedia,
  stepMinutes,
  stepSeconds,
} from './outline-edit';

const PICTURE = { type: 'image', url: 'https://example.test/a.png', alt: 'A tower' } as const;

function base(): Outline {
  return {
    version: 1,
    meta: { title: 'Day 1' },
    steps: [
      { id: 'welcome', kind: 'title', title: 'Les voyages', body: 'Tell a short story.' },
      { id: 'check', kind: 'interaction', interactionId: 'past-tense' },
      {
        id: 'tower',
        kind: 'activity',
        title: 'Build the tallest tower',
        instructions: ['Form groups of four', 'Plan for two minutes'],
        materials: ['Spaghetti', 'Tape'],
        durationSec: 600,
      },
      { id: 'boxes', kind: 'cards', title: 'Four things', items: [{ text: 'One' }, { text: 'Two' }] },
      { id: 'reflect', kind: 'debrief', title: 'À retenir', prompts: ['What changed?'] },
    ],
    interactions: [
      {
        id: 'past-tense',
        type: 'choice',
        prompt: 'Choose the correct sentence.',
        options: [
          { id: 'a', label: "J'ai raté le train." },
          { id: 'b', label: 'Je rate le train hier.' },
          { id: 'c', label: 'Je suis rater le train.' },
        ],
      } as Interaction,
    ],
  };
}

function stepOf(outline: Outline, id: string): OutlineStep {
  const step = outline.steps.find((item) => item.id === id);
  if (step === undefined) throw new Error(`no step ${id}`);
  return step;
}

/** Every edit has to leave a document the validator still accepts. */
function expectValid(outline: Outline): void {
  const result = validateOutline(outline);
  expect(result.ok ? [] : result.errors.map((error) => error.message)).toEqual([]);
}

describe('insert catalog', () => {
  const entries = [...INSERT_TOP, ...INSERT_CATALOG.flatMap((group) => group.items)];

  it('marks every entry as a freeform or a wired starter', () => {
    for (const item of entries) {
      expect([item.kind, item.starter === 'freeform' || item.starter === 'wired']).toEqual([
        item.kind,
        true,
      ]);
    }
    expect(
      [...new Set(entries.filter((item) => item.starter === 'freeform').map((item) => item.kind))].sort(),
    ).toEqual(['blank', 'blank-titled', 'image', 'statement', 'title'].sort());
  });

  it('instantiates freeform entries as element-capable steps', () => {
    for (const item of entries) {
      const step = starterStep(item.kind, 'probe');
      if (item.starter !== 'freeform') {
        expect([item.kind, stepElements(step).length]).toEqual([item.kind, 0]);
        continue;
      }
      expect([item.kind, kindCanCarryElements(step.kind)]).toEqual([item.kind, true]);
      // `blank` and `blank-titled` are the two empty canvases — nothing to place.
      const carries = item.kind !== 'blank' && item.kind !== 'blank-titled';
      expect([item.kind, stepElements(step).length > 0]).toEqual([item.kind, carries]);
    }
  });

  it('gives every starter element a unique id, a legal box and empty editable content', () => {
    for (const item of entries) {
      const result = insertAfter(base(), 'welcome', item.kind);
      expectValid(result.outline);
      const elements = stepElements(stepOf(result.outline, result.stepId));
      expect(new Set(elements.map((element) => element.id)).size).toBe(elements.length);
      for (const element of elements) {
        const { x, y, w, h } = element.box;
        expect([element.id, w >= ELEMENT_BOX_MIN, h >= ELEMENT_BOX_MIN]).toEqual([
          element.id,
          true,
          true,
        ]);
        expect([element.id, x + w <= ELEMENT_BOX_MAX, y + h <= ELEMENT_BOX_MAX]).toEqual([
          element.id,
          true,
          true,
        ]);
        const text = element.type === 'text' ? element.text : element.type === 'image' ? element.alt : undefined;
        if (text !== undefined) expect([element.id, text === '']).toEqual([element.id, true]);
      }
    }
  });

  it('composes title, statement and image out of boxed elements', () => {
    const title = starterStep('title', 'a');
    expect(title.kind).toBe('blank');
    expect(stepElements(title).map((element) => [element.id, element.type])).toEqual([
      ['head', 'text'],
      ['body', 'text'],
    ]);

    const statement = starterStep('statement', 'b');
    expect(statement.kind).toBe('blank');
    expect(starterStep('block', 'b2')).toEqual({ ...statement, id: 'b2' });

    const image = starterStep('image', 'c');
    expect(stepElements(image).map((element) => [element.id, element.type])).toEqual([
      ['head', 'text'],
      ['body', 'text'],
      ['pic', 'image'],
    ]);
    // No source: the canvas draws the alt as a placeholder until a picture lands.
    const picture = stepElements(image).find((element) => element.id === 'pic');
    expect(picture?.type === 'image' ? picture.url : 'set').toBeUndefined();
  });

  it('names a freeform slide after its heading box in the block list', () => {
    const title = insertAfter(base(), 'welcome', 'title');
    expect(stepTitle(title.outline, stepOf(title.outline, title.stepId))).toBe('Empty slide');
    const image = insertAfter(base(), 'welcome', 'image');
    expect(stepTitle(image.outline, stepOf(image.outline, image.stepId))).toBe('Empty slide');
    const empty = insertAfter(base(), 'welcome', 'blank');
    expect(stepTitle(empty.outline, stepOf(empty.outline, empty.stepId))).toBe('Empty slide');
  });
});

describe('insertAfter', () => {
  it('adds a valid block of every insert kind, right after the selected one', () => {
    for (const kind of INSERT_KINDS) {
      const result = insertAfter(base(), 'welcome', kind);
      expect([kind, result.stepId === '']).toEqual([kind, false]);
      expectValid(result.outline);
      expect([kind, result.outline.steps[1]?.id]).toEqual([kind, result.stepId]);
    }
  });

  it('covers every wired outline step kind via insert starters', () => {
    const kinds = new Set<string>();
    for (const kind of INSERT_KINDS) {
      const result = insertAfter(base(), 'welcome', kind);
      const step = result.outline.steps.find((s) => s.id === result.stepId);
      if (step) kinds.add(step.kind);
    }
    // Breakout is not a kind; interaction comes in via question. `title` and
    // `statement` are freeform inserts now — they land as `blank` compositions,
    // so no insert produces those kinds.
    expect([...kinds].sort()).toEqual(
      [
        'activity',
        'blank',
        'break',
        'cards',
        'debrief',
        'interaction',
        'join',
        'media',
        'steps',
        'term',
        'timer',
      ].sort(),
    );
  });

  it('gives the starter blocks the content the Insert tab promises', () => {
    const question = insertAfter(base(), 'welcome', 'question');
    const step = stepOf(question.outline, question.stepId);
    expect(optionsFor(question.outline, step).map((option) => option.label)).toEqual([
      '',
      '',
      '',
    ]);
    expect(promptFor(question.outline, step)).toBe('');

    const inserted = insertAfter(base(), 'welcome', 'fill-the-gaps');
    const fillTheGapsIx = inserted.outline.interactions.find((item) => item.id.startsWith('fill-the-gaps'));
    expect(fillTheGapsIx?.type).toBe('fill-the-gaps');
    const match = insertAfter(base(), 'welcome', 'match');
    expect(match.outline.interactions.some((item) => item.type === 'match')).toBe(true);
    expectValid(inserted.outline);
    expectValid(match.outline);

    const timer = insertAfter(base(), 'welcome', 'timer');
    expect(stepOf(timer.outline, timer.stepId)).toMatchObject({
      title: '',
      body: '',
      seconds: 600,
    });

    const boxes = insertAfter(base(), 'welcome', 'boxes');
    const cards = stepOf(boxes.outline, boxes.stepId);
    expect(cards.kind === 'cards' ? cards.items.length : 0).toBe(4);
    expect(cards.layout).toBe('grid');

    // Full-bleed is the media block with the media layout — one kind, not two.
    expect(stepOf(insertAfter(base(), 'welcome', 'media-full').outline, 'media')).toMatchObject({
      kind: 'media',
      layout: 'media',
    });
    expect(stepOf(insertAfter(base(), 'welcome', 'video').outline, 'video')).toMatchObject({
      media: { type: 'video' },
    });
    expect(
      stepOf(insertAfter(base(), 'welcome', 'activity').outline, 'activity'),
    ).toMatchObject({ materials: ['', ''] });
  });

  it('appends at the end when nothing is selected', () => {
    const result = insertAfter(base(), null, 'block');
    expect(result.outline.steps.at(-1)?.id).toBe(result.stepId);
  });

  it('files a breakout under its parent, attached to a part of it', () => {
    const result = insertAfter(base(), 'welcome', 'statement', {
      afterKey: 'body',
      asBreakout: true,
    });
    expectValid(result.outline);
    const child = stepOf(result.outline, result.stepId);
    expect(child.breakoutOf).toEqual({ stepId: 'welcome', afterKey: 'body' });
    expect(result.outline.steps[1]?.id).toBe(result.stepId);
    // It is not a block of its own in the running order.
    expect(orderedBlocks(result.outline).map((block) => block.step.id)).toEqual([
      'welcome',
      'check',
      'tower',
      'boxes',
      'reflect',
    ]);
    expect(orderedBlocks(result.outline)[0]?.breakouts).toHaveLength(1);
  });

  it('can file any insert kind as a breakout — e.g. a poll off a term list', () => {
    const result = insertAfter(base(), 'welcome', 'question', {
      afterKey: 'header',
      asBreakout: true,
    });
    expectValid(result.outline);
    const child = stepOf(result.outline, result.stepId);
    expect(child.kind).toBe('interaction');
    expect(child.breakoutOf).toEqual({ stepId: 'welcome', afterKey: 'header' });
  });

  it('refuses a breakout on a breakout — one level only', () => {
    const first = insertAfter(base(), 'welcome', 'statement', {
      afterKey: 'header',
      asBreakout: true,
    });
    const second = insertAfter(first.outline, first.stepId, 'question', {
      afterKey: 'header',
      asBreakout: true,
    });
    expect(second.stepId).toBe('');
    expect(second.outline).toBe(first.outline);
  });

  it('inserts after the block a selected breakout belongs to, not inside it', () => {
    const first = insertAfter(base(), 'welcome', 'statement', {
      afterKey: 'header',
      asBreakout: true,
    });
    const next = insertAfter(first.outline, first.stepId, 'block');
    expect(orderedBlocks(next.outline).map((block) => block.step.id)).toEqual([
      'welcome',
      next.stepId,
      'check',
      'tower',
      'boxes',
      'reflect',
    ]);
  });
});

describe('duplicate, remove and move', () => {
  it('copies a block under a fresh id, right after the original', () => {
    const result = duplicateStep(base(), 'tower');
    expectValid(result.outline);
    expect(result.stepId).not.toBe('tower');
    expect(result.outline.steps[3]?.id).toBe(result.stepId);
    expect(stepOf(result.outline, result.stepId)).toMatchObject({ title: 'Build the tallest tower' });
  });

  it('copies the interaction too, so editing the copy leaves the original alone', () => {
    const result = duplicateStep(base(), 'check');
    const copy = stepOf(result.outline, result.stepId);
    expect(copy.kind === 'interaction' ? copy.interactionId : '').not.toBe('past-tense');
    expect(result.outline.interactions).toHaveLength(2);

    const edited = setPartText(result.outline, result.stepId, 'option-0', 'Changed');
    expect(optionsFor(edited, stepOf(edited, 'check'))[0]?.label).toBe("J'ai raté le train.");
  });

  it('splits a cards block into pair-work lanes', () => {
    const split = splitForPairWork(base(), 'boxes');
    const cards = stepOf(split, 'boxes');
    expect(cards.kind === 'cards' ? cards.items.map((item) => item.lane) : []).toEqual([0, 1]);
    expectValid(split);
  });

  it('unsplitting puts every card back in the middle', () => {
    const cleared = clearPairWork(splitForPairWork(base(), 'boxes'), 'boxes');
    const cards = stepOf(cleared, 'boxes');
    // Absent, not zeroed: no lane IS "everyone sees this card".
    expect(cards.kind === 'cards' ? cards.items : []).toEqual([{ text: 'One' }, { text: 'Two' }]);
    expectValid(cleared);
  });

  it('takes a block’s breakouts with it, and the interaction only it used', () => {
    const outline = base();
    outline.steps.push({ id: 'again', kind: 'interaction', interactionId: 'second' });
    outline.interactions.push({
      id: 'second',
      type: 'choice',
      prompt: 'And this one?',
      options: [{ id: 'y', label: 'Yes' }, { id: 'n', label: 'No' }],
    } as Interaction);
    const withChild = insertAfter(outline, 'check', 'statement', {
      afterKey: 'header',
      asBreakout: true,
    });
    const after = removeStep(withChild.outline, 'check');
    expectValid(after);
    expect(after.steps.map((step) => step.id)).toEqual([
      'welcome',
      'tower',
      'boxes',
      'reflect',
      'again',
    ]);
    expect(after.interactions.map((item) => item.id)).toEqual(['second']);
  });

  it('removes the last question while preserving a valid presentation', () => {
    const after = removeStep(base(), 'check');
    expect(after.steps.map((step) => step.id)).toEqual(['welcome', 'tower', 'boxes', 'reflect']);
    expect(after.interactions).toHaveLength(0);
    expectValid(after);
  });

  it('keeps an interaction another block still references', () => {
    const outline = base();
    outline.steps.push({ id: 'again', kind: 'interaction', interactionId: 'past-tense' });
    expect(removeStep(outline, 'check').interactions).toHaveLength(1);
  });

  it('moves a block among blocks, clamping at either end', () => {
    expect(orderedBlocks(moveBlock(base(), 'reflect', 0)).map((block) => block.step.id)).toEqual([
      'reflect',
      'welcome',
      'check',
      'tower',
      'boxes',
    ]);
    expect(orderedBlocks(moveBlock(base(), 'welcome', 99)).map((block) => block.step.id)).toEqual([
      'check',
      'tower',
      'boxes',
      'reflect',
      'welcome',
    ]);
    expect(moveBlock(base(), 'nope', 0).steps.map((step) => step.id)).toEqual(
      base().steps.map((step) => step.id),
    );
  });

  it('carries a breakout with the block it hangs off', () => {
    const withChild = insertAfter(base(), 'welcome', 'statement', {
      afterKey: 'header',
      asBreakout: true,
    });
    const moved = moveBlock(withChild.outline, 'welcome', 2);
    expect(moved.steps.map((step) => step.id)).toEqual([
      'check',
      'tower',
      'welcome',
      withChild.stepId,
      'boxes',
      'reflect',
    ]);
  });
});

describe('setMinutes', () => {
  it('changes the field the kind actually keeps its length in', () => {
    expect(stepMinutes(stepOf(setMinutes(base(), 'tower', 2), 'tower'))).toBe(12);
    const timer = insertAfter(base(), 'welcome', 'timer');
    expect(stepMinutes(stepOf(setMinutes(timer.outline, timer.stepId, -3), timer.stepId))).toBe(7);
  });

  it('clamps to one minute and to two hours', () => {
    expect(stepMinutes(stepOf(setMinutes(base(), 'tower', -99), 'tower'))).toBe(1);
    expect(stepMinutes(stepOf(setMinutes(base(), 'tower', 999), 'tower'))).toBe(120);
  });

  it('leaves a kind with no length of its own untouched', () => {
    const after = setMinutes(base(), 'welcome', 5);
    expect(after).toBe(base() === after ? after : after);
    expect(stepOf(after, 'welcome')).toEqual(stepOf(base(), 'welcome'));
  });
});

describe('setPartText', () => {
  it('writes every part key of every kind back to its own field', () => {
    const outline = base();
    expect(stepOf(setPartText(outline, 'welcome', 'header', 'Voyages'), 'welcome')).toMatchObject({
      title: 'Voyages',
    });
    expect(stepOf(setPartText(outline, 'welcome', 'body', 'A story.'), 'welcome')).toMatchObject({
      body: 'A story.',
    });
    expect(stepOf(setPartText(outline, 'tower', 'cell-1', 'Plan for one'), 'tower')).toMatchObject({
      instructions: ['Form groups of four', 'Plan for one'],
    });
    expect(stepOf(setPartText(outline, 'tower', 'materials', 'Pen\nPaper'), 'tower')).toMatchObject({
      materials: ['Pen', 'Paper'],
    });
    expect(stepOf(setPartText(outline, 'boxes', 'cell-0', 'Uno'), 'boxes')).toMatchObject({
      items: [{ text: 'Uno' }, { text: 'Two' }],
    });
    expect(stepOf(setPartText(outline, 'reflect', 'cell-0', 'And now?'), 'reflect')).toMatchObject({
      prompts: ['And now?'],
    });
    expectValid(setPartText(outline, 'tower', 'materials', 'Pen\nPaper'));
  });

  it('writes an interaction heading to the prompt while the step overrides none', () => {
    const after = setPartText(base(), 'check', 'header', 'Which sentence?');
    expect(after.interactions[0]?.prompt).toBe('Which sentence?');
    const titled = setPartText({ ...after, steps: after.steps.map((step) => step.id === 'check' ? { ...step, title: 'Your turn' } as OutlineStep : step) }, 'check', 'header', 'Now you');
    expect(stepOf(titled, 'check')).toMatchObject({ title: 'Now you' });
  });

  it('writes an option label onto the interaction, not the step', () => {
    const after = setPartText(base(), 'check', 'option-1', 'Je ratais le train.');
    expect(optionsFor(after, stepOf(after, 'check')).map((option) => option.label)).toEqual([
      "J'ai raté le train.",
      'Je ratais le train.',
      'Je suis rater le train.',
    ]);
  });

  it('writes one materials line through its sub-key, and drops a blanked one', () => {
    const after = setPartText(base(), 'tower', 'material-0', 'Spaghetti, 20 sticks');
    expect(stepOf(after, 'tower')).toMatchObject({ materials: ['Spaghetti, 20 sticks', 'Tape'] });
    expect(stepOf(setPartText(base(), 'tower', 'material-1', '   '), 'tower')).toMatchObject({
      materials: ['Spaghetti'],
    });
    expect(partLabel(stepOf(base(), 'tower'), 'material-1')).toBe('Material 2');
    expectValid(after);
  });

  it('leaves the outline alone for a part the step does not have', () => {
    const outline = base();
    expect(setPartText(outline, 'welcome', 'materials', 'Pen')).toEqual(outline);
    expect(setPartText(outline, 'nope', 'header', 'x')).toBe(outline);
  });

  it('keeps a fill-the-gaps legal when the canvas commits the blanked heading', () => {
    const inserted = authoredGap();
    const after = setPartText(inserted.outline, inserted.stepId, 'header', "J'____ raté le train.");
    // Unchanged display text is not an edit — a new object would dirty the draft.
    expect(after).toBe(inserted.outline);
    expectValid(after);
  });

  it('rebuilds fill-the-gaps placeholders when the sentence around the blanks changes', () => {
    const inserted = authoredGap();
    const after = setPartText(inserted.outline, inserted.stepId, 'header', "J'____ raté le bus.");
    expectValid(after);
    const ix = after.interactions.find((item) => item.type === 'fill-the-gaps');
    expect(ix?.prompt).toBe("J'{{g1}} raté le bus.");
  });

  it('adds a gap when the author writes a new {{id}} into the sentence', () => {
    const inserted = authoredGap();
    const after = setPartText(inserted.outline, inserted.stepId, 'header', "J'{{g1}} raté le {{g2}}.");
    expectValid(after);
    const ix = after.interactions.find((item) => item.type === 'fill-the-gaps');
    expect(ix).toMatchObject({
      prompt: "J'{{g1}} raté le {{g2}}.",
      gaps: [
        { id: 'g1', answers: ['ai'] },
        { id: 'g2', answers: [''] },
      ],
    });
  });

  it('refuses a fill-the-gaps rewrite that would drop every gap', () => {
    const inserted = authoredGap();
    const after = setPartText(inserted.outline, inserted.stepId, 'header', 'A whole new sentence.');
    expect(after).toBe(inserted.outline);
    expectValid(after);
  });

  it('writes a fill-the-gaps gap answer through its part key', () => {
    const inserted = authoredGap();
    const after = setPartText(inserted.outline, inserted.stepId, 'gap-0', 'suis');
    expectValid(after);
    const ix = after.interactions.find((item) => item.type === 'fill-the-gaps');
    expect(ix).toMatchObject({ gaps: [{ id: 'g1', answers: ['suis'] }] });
  });
});

describe('setReveal', () => {
  it('files one group (or none) as `together`, so the file says what was chosen', () => {
    expect(stepOf(setReveal(base(), 'welcome', [['header', 'body']]), 'welcome').reveal).toBe(
      'together',
    );
    expect(stepOf(setReveal(base(), 'welcome', []), 'welcome').reveal).toBe('together');
  });

  it('files a real sequence as authored, and it validates', () => {
    const after = setReveal(base(), 'welcome', [['header'], ['body']]);
    expect(stepOf(after, 'welcome').reveal).toEqual([['header'], ['body']]);
    expectValid(after);
  });
});

describe('list items', () => {
  it('adds an option to the interaction with an id of its own', () => {
    const after = addListItem(base(), 'check', 'option');
    expectValid(after);
    const labels = optionsFor(after, stepOf(after, 'check')).map((option) => option.label);
    expect(labels).toHaveLength(4);
    expect(labels.at(-1)).toBe('');
    const ids = optionsFor(after, stepOf(after, 'check')).map((option) => option.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('adds after the entry the author was standing on', () => {
    const after = addListItem(base(), 'check', 'option', 0);
    expect(optionsFor(after, stepOf(after, 'check')).map((option) => option.label)[1]).toBe(
      '',
    );
  });

  it('keeps the new part in step with `partKeysForStep`', () => {
    const after = addListItem(base(), 'check', 'option');
    expect(partKeysForStep(stepOf(after, 'check'), after.interactions)).toEqual([
      'header',
      'option-0',
      'option-1',
      'option-2',
      'option-3',
    ]);
  });

  it('grows the other lists too', () => {
    expect(stepOf(addListItem(base(), 'tower', 'material'), 'tower')).toMatchObject({
      materials: ['Spaghetti', 'Tape', ''],
    });
    expect(stepOf(addListItem(base(), 'tower', 'instruction'), 'tower')).toMatchObject({
      instructions: ['Form groups of four', 'Plan for two minutes', ''],
    });
    expect(stepOf(addListItem(base(), 'boxes', 'card'), 'boxes')).toMatchObject({
      items: [{ text: 'One' }, { text: 'Two' }, { text: '' }],
    });
    expect(stepOf(addListItem(base(), 'reflect', 'prompt'), 'reflect')).toMatchObject({
      prompts: ['What changed?', ''],
    });
    expectValid(addListItem(base(), 'boxes', 'card'));
  });

  it('removes an entry, and refuses when the kind would be left short', () => {
    const after = removeListItem(base(), 'check', 'option', 1);
    expect(optionsFor(after, stepOf(after, 'check')).map((option) => option.label)).toEqual([
      "J'ai raté le train.",
      'Je suis rater le train.',
    ]);
    // Two options is the floor: a question with one answer is not a question.
    expect(removeListItem(after, 'check', 'option', 0)).toBe(after);
    expect(canRemoveListItem(after, stepOf(after, 'check'), 'option')).toBe(false);

    expect(removeListItem(base(), 'boxes', 'card', 0)).toEqual(base());
    expect(removeListItem(base(), 'reflect', 'prompt', 0)).toEqual(base());
    expect(stepOf(removeListItem(base(), 'tower', 'instruction', 1), 'tower')).toMatchObject({
      instructions: ['Form groups of four'],
    });
  });

  it('lets the last material go, taking the field with it', () => {
    const one = removeListItem(base(), 'tower', 'material', 0);
    const none = removeListItem(one, 'tower', 'material', 0);
    expect('materials' in stepOf(none, 'tower')).toBe(false);
    expect(partKeysForStep(stepOf(none, 'tower'))).toEqual(['header', 'cell-0', 'cell-1']);
    expectValid(none);
  });

  it('adds and removes a fill-the-gaps gap, keeping the sentence and the list in step', () => {
    const inserted = authoredGap();
    const added = addListItem(inserted.outline, inserted.stepId, 'gap');
    expectValid(added);
    const ix = added.interactions.find((item) => item.type === 'fill-the-gaps');
    expect(ix?.type === 'fill-the-gaps' ? ix.gaps.map((gap) => gap.id) : []).toEqual(['g1', 'g2']);
    expect(ix?.prompt).toContain('{{g2}}');
    expect(partKeysForStep(stepOf(added, inserted.stepId), added.interactions)).toEqual([
      'header',
      'gap-0',
      'gap-1',
    ]);

    const removed = removeListItem(added, inserted.stepId, 'gap', 1);
    expectValid(removed);
    const after = removed.interactions.find((item) => item.type === 'fill-the-gaps');
    expect(after?.type === 'fill-the-gaps' ? after.gaps.map((gap) => gap.id) : []).toEqual(['g1']);
    expect(after?.prompt).not.toContain('{{g2}}');
    expect(canRemoveListItem(removed, stepOf(removed, inserted.stepId), 'gap')).toBe(true);
    expectValid(removeListItem(removed, inserted.stepId, 'gap', 0));
  });

  it('turns selected text into the next gap, and refuses an empty or overlapping range', () => {
    const inserted = authoredGap();
    const prompt =
      inserted.outline.interactions.find((item) => item.type === 'fill-the-gaps')?.prompt ?? '';
    const start = prompt.indexOf('train');
    expect(start).toBeGreaterThan(-1);
    const gapped = insertGapAtRange(inserted.outline, inserted.stepId, start, start + 'train'.length);
    expectValid(gapped);
    const ix = gapped.interactions.find((item) => item.type === 'fill-the-gaps');
    expect(ix?.type === 'fill-the-gaps' ? ix.prompt : '').toContain('{{g2}}');
    expect(ix?.type === 'fill-the-gaps' ? ix.gaps.map((gap) => gap.answers[0]) : []).toEqual([
      'ai',
      'train',
    ]);

    expect(insertGapAtRange(inserted.outline, inserted.stepId, start, start)).toBe(inserted.outline);
    const marker = prompt.indexOf('{{g1}}');
    expect(insertGapAtRange(inserted.outline, inserted.stepId, marker, marker + 3)).toBe(
      inserted.outline,
    );
  });

  it('writes extra answers, distractors, and a word bank onto a fill-the-gaps question', () => {
    const inserted = authoredGap();
    const extras = setGapAnswers(inserted.outline, inserted.stepId, 0, ['ai', "j'ai"]);
    const distractors = setGapDistractors(extras, inserted.stepId, 0, ['suis', 'es']);
    const banked = setFillTheGapsBank(distractors, inserted.stepId, ['le', 'la']);
    expectValid(banked);
    const ix = banked.interactions.find((item) => item.type === 'fill-the-gaps');
    expect(ix?.type === 'fill-the-gaps' ? ix.gaps[0] : undefined).toEqual({
      id: 'g1',
      answers: ['ai', "j'ai"],
      distractors: ['suis', 'es'],
    });
    expect(ix?.type === 'fill-the-gaps' ? ix.bank : undefined).toEqual(['le', 'la']);

    const cleared = setFillTheGapsBank(banked, inserted.stepId, []);
    const after = cleared.interactions.find((item) => item.type === 'fill-the-gaps');
    expect(after?.type === 'fill-the-gaps' ? after.bank : 'kept').toBeUndefined();
  });

  it('says in advance whether the buttons should be there at all', () => {
    const outline = base();
    expect(canAddListItem(outline, stepOf(outline, 'check'), 'option')).toBe(true);
    expect(canAddListItem(outline, stepOf(outline, 'welcome'), 'option')).toBe(false);
    expect(canRemoveListItem(outline, stepOf(outline, 'boxes'), 'card')).toBe(false);
    expect(canRemoveListItem(outline, stepOf(outline, 'tower'), 'material')).toBe(true);
  });

  it('refuses to grow a list past what the contract allows', () => {
    let outline = base();
    for (let n = 0; n < 20; n++) outline = addListItem(outline, 'check', 'option');
    expect(optionsFor(outline, stepOf(outline, 'check'))).toHaveLength(10);
    expectValid(outline);
  });

  it('caps ranking options below the choice ceiling', () => {
    const ranked: Outline = {
      ...base(),
      interactions: [
        {
          id: 'past-tense',
          type: 'ranking',
          prompt: 'Order these.',
          options: [
            { id: 'a', label: 'First' },
            { id: 'b', label: 'Second' },
          ],
        } as Interaction,
      ],
    };
    let outline = ranked;
    for (let n = 0; n < 20; n++) outline = addListItem(outline, 'check', 'option');
    expect(optionsFor(outline, stepOf(outline, 'check'))).toHaveLength(6);
    expectValid(outline);
    expect(canAddListItem(outline, stepOf(outline, 'check'), 'option')).toBe(false);
  });
});

describe('setOptionCorrect', () => {
  it('marks one option, and only one', () => {
    const first = setOptionCorrect(base(), 'check', 0);
    expect(optionCorrect(first, stepOf(first, 'check'), 0)).toBe(true);
    const second = setOptionCorrect(first, 'check', 2);
    expect(optionCorrect(second, stepOf(second, 'check'), 0)).toBe(false);
    expect(optionCorrect(second, stepOf(second, 'check'), 2)).toBe(true);
    expectValid(second);
  });

  it('unmarks the marked one when it is picked again', () => {
    const on = setOptionCorrect(base(), 'check', 1);
    const off = setOptionCorrect(on, 'check', 1);
    expect(optionCorrect(off, stepOf(off, 'check'), 1)).toBe(false);
    expect(off.interactions[0]).toEqual(base().interactions[0]);
  });

  it('does nothing to a step that is not a question', () => {
    expect(setOptionCorrect(base(), 'tower', 0)).toEqual(base());
    expect(setOptionCorrect(base(), 'check', 9)).toEqual(base());
  });
});

describe('freeform elements', () => {
  it('adds a text box on a title slide without inserting a new slide', () => {
    const before = base().steps.length;
    const result = addTextElement(base(), 'welcome');
    expect(result.elementId).not.toBe('');
    expect(result.outline.steps).toHaveLength(before);
    expect(partKeysForStep(stepOf(result.outline, 'welcome'))).toContain(`el-${result.elementId}`);
    const moved = setElementBox(result.outline, 'welcome', result.elementId, { x: 10, y: 20, w: 40, h: 18 });
    const step = stepOf(moved, 'welcome');
    expect(step.kind).toBe('title');
    if (step.kind === 'title') {
      expect(step.elements?.[0]?.box).toEqual({ x: 10, y: 20, w: 40, h: 18 });
    }
    expectValid(moved);
  });

  it('refuses a text box on a question', () => {
    const result = addTextElement(base(), 'check');
    expect(result.elementId).toBe('');
    expect(result.outline).toEqual(base());
  });

  it('adds and edits a full-slide sandboxed web page element', () => {
    const result = addIframeElement(base(), 'welcome', 'https://example.test/embed', 'Example page');
    expect(result.elementId).not.toBe('');
    const step = stepOf(result.outline, 'welcome');
    const iframe = step.kind === 'title' ? step.elements?.find((item) => item.id === result.elementId) : undefined;
    expect(iframe).toMatchObject({
      type: 'iframe',
      url: 'https://example.test/embed',
      title: 'Example page',
      box: { x: 0, y: 0, w: 100, h: 100 },
    });
    const edited = setElementIframe(result.outline, 'welcome', result.elementId, 'https://example.test/two', 'Second page');
    expect(stepOf(edited, 'welcome')).toMatchObject({
      elements: [{ type: 'iframe', url: 'https://example.test/two', title: 'Second page' }],
    });
    expectValid(edited);
  });

  it('adds and edits a full-slide PDF element', () => {
    const result = addPdfElement(base(), 'welcome', 'https://example.test/handout.pdf', 'Lesson handout');
    expect(result.elementId).not.toBe('');
    const step = stepOf(result.outline, 'welcome');
    const pdf = step.kind === 'title' ? step.elements?.find((item) => item.id === result.elementId) : undefined;
    expect(pdf).toMatchObject({
      type: 'pdf',
      url: 'https://example.test/handout.pdf',
      title: 'Lesson handout',
      box: { x: 0, y: 0, w: 100, h: 100 },
    });
    const edited = setElementPdf(result.outline, 'welcome', result.elementId, 'https://example.test/two.pdf', 'Second handout');
    expect(stepOf(edited, 'welcome')).toMatchObject({
      elements: [{ type: 'pdf', url: 'https://example.test/two.pdf', title: 'Second handout' }],
    });
    expectValid(edited);
  });
});

/**
 * A title, statement or media slide carries *both* a wired picture slot and
 * freeform objects, so "change this slide's picture" and "add a picture" are
 * two verbs on one slide. The picture dialog cannot tell them apart from the
 * live selection — the gesture that opened it names the target, and this is
 * where that routing is pinned.
 */
describe('picture dialog routing', () => {
  it('fills the wired picture slot without adding an object', () => {
    const result = applyPictureTarget(base(), 'welcome', { kind: 'media' }, PICTURE);
    expect(result.partKey).toBe('image');
    expect(stepMedia(stepOf(result.outline, 'welcome'))).toEqual(PICTURE);
    expect(stepElements(stepOf(result.outline, 'welcome'))).toHaveLength(0);
    expectValid(result.outline);
  });

  it('changes the slide picture on a slide that also carries objects', () => {
    const withObject = addImageElement(setMedia(base(), 'welcome', PICTURE), 'welcome', PICTURE);
    const next = { ...PICTURE, url: 'https://example.test/b.png', alt: 'A bridge' };
    const result = applyPictureTarget(withObject.outline, 'welcome', { kind: 'media' }, next);
    expect(result.partKey).toBe('image');
    expect(stepMedia(stepOf(result.outline, 'welcome'))).toEqual(next);
    // The object beside it is untouched, and no second object appeared.
    expect(stepElements(stepOf(result.outline, 'welcome'))).toHaveLength(1);
    expect(stepElements(stepOf(result.outline, 'welcome'))[0]).toMatchObject({ url: PICTURE.url });
    expectValid(result.outline);
  });

  it('swaps the source of the picture object it was opened from', () => {
    const added = addImageElement(base(), 'welcome', PICTURE);
    const next = { ...PICTURE, url: 'https://example.test/b.png', alt: 'A bridge' };
    const result = applyPictureTarget(
      added.outline,
      'welcome',
      { kind: 'element', elementId: added.elementId },
      next,
    );
    expect(result.partKey).toBe(`el-${added.elementId}`);
    const elements = stepElements(stepOf(result.outline, 'welcome'));
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ id: added.elementId, url: next.url, alt: next.alt });
    // A swap never touches the slide's own picture.
    expect(stepMedia(stepOf(result.outline, 'welcome'))).toBeUndefined();
    expectValid(result.outline);
  });

  it('keeps the object box and size across a swap', () => {
    const added = addImageElement(base(), 'welcome', PICTURE);
    const boxed = setElementBox(added.outline, 'welcome', added.elementId, { x: 5, y: 6, w: 30, h: 20 });
    const result = applyPictureTarget(
      boxed,
      'welcome',
      { kind: 'element', elementId: added.elementId },
      { ...PICTURE, url: 'https://example.test/b.png' },
    );
    expect(stepElements(stepOf(result.outline, 'welcome'))[0]?.box).toEqual({ x: 5, y: 6, w: 30, h: 20 });
  });

  it('adds an object when the insert gesture opened the dialog', () => {
    const withPicture = setMedia(base(), 'welcome', PICTURE);
    const next = { ...PICTURE, url: 'https://example.test/b.png', alt: 'A bridge' };
    const result = applyPictureTarget(withPicture, 'welcome', { kind: 'new' }, next);
    expect(result.partKey).toBe('el-pic');
    // The slide's own picture is left exactly as it was.
    expect(stepMedia(stepOf(result.outline, 'welcome'))).toEqual(PICTURE);
    expect(stepElements(stepOf(result.outline, 'welcome'))).toHaveLength(1);
    expectValid(result.outline);
  });

  it('falls back to the wired slot when the kind carries no objects', () => {
    const result = applyPictureTarget(base(), 'tower', { kind: 'new' }, PICTURE);
    expect(result.partKey).toBe('image');
    expect(stepMedia(stepOf(result.outline, 'tower'))).toEqual(PICTURE);
    expectValid(result.outline);
  });

  it('writes nothing when the target no longer exists', () => {
    const outline = base();
    expect(applyPictureTarget(outline, 'welcome', { kind: 'element', elementId: 'pic9' }, PICTURE)).toEqual({
      outline,
      partKey: null,
    });
    const join = insertAfter(outline, 'welcome', 'join');
    expect(applyPictureTarget(join.outline, join.stepId, { kind: 'media' }, PICTURE)).toEqual({
      outline: join.outline,
      partKey: null,
    });
    expect(applyPictureTarget(join.outline, join.stepId, { kind: 'new' }, PICTURE)).toEqual({
      outline: join.outline,
      partKey: null,
    });
  });
});

describe('media on an activity', () => {
  it('places and resizes a picture on this slide', () => {
    const withPicture = setMedia(base(), 'welcome', PICTURE);
    const left = setMediaPlace(withPicture, 'welcome', 'left');
    expect(stepOf(left, 'welcome').layout).toBe('split');
    expect(stepMedia(stepOf(left, 'welcome'))?.place).toBe('left');
    const sized = setMediaSize(left, 'welcome', 30);
    expect(stepMedia(stepOf(sized, 'welcome'))?.size).toBe(30);
    const reset = setMediaSize(sized, 'welcome', 42);
    expect(stepMedia(stepOf(reset, 'welcome'))?.size).toBeUndefined();
    expectValid(reset);
  });

  it('puts a picture on a title slide instead of inserting a new one', () => {
    const before = base().steps.length;
    const withPicture = setMedia(base(), 'welcome', PICTURE);
    expectValid(withPicture);
    expect(withPicture.steps).toHaveLength(before);
    expect(stepOf(withPicture, 'welcome').kind).toBe('title');
    expect(stepMedia(stepOf(withPicture, 'welcome'))).toEqual(PICTURE);
    expect(stepOf(withPicture, 'welcome').layout).toBe('split');
    expect(partKeysForStep(stepOf(withPicture, 'welcome'))).toContain('image');

    const without = removeMedia(withPicture, 'welcome');
    expect(stepOf(without, 'welcome').kind).toBe('title');
    expect(stepMedia(stepOf(without, 'welcome'))).toBeUndefined();
    expect(partKeysForStep(stepOf(without, 'welcome'))).not.toContain('image');
    expectValid(without);
  });

  it('does not put a picture on a join or timer slide', () => {
    const withJoin = insertAfter(base(), 'welcome', 'join');
    const attempted = setMedia(withJoin.outline, withJoin.stepId, PICTURE);
    expect(attempted).toEqual(withJoin.outline);
  });

  it('adds an image part when a picture is put on the block, and takes it away again', () => {
    const withPicture = setMedia(base(), 'tower', PICTURE);
    expectValid(withPicture);
    expect(stepMedia(stepOf(withPicture, 'tower'))).toEqual(PICTURE);
    expect(partKeysForStep(stepOf(withPicture, 'tower'))).toEqual([
      'header',
      'cell-0',
      'cell-1',
      'materials',
      'image',
    ]);

    const without = removeMedia(withPicture, 'tower');
    expect(stepMedia(stepOf(without, 'tower'))).toBeUndefined();
    expect(partKeysForStep(stepOf(without, 'tower'))).not.toContain('image');
    expectValid(without);
  });

  it('writes the image part’s text to the alt text', () => {
    const withPicture = setMedia(base(), 'tower', PICTURE);
    const after = setPartText(withPicture, 'tower', 'image', 'Spaghetti and tape');
    expect(stepMedia(stepOf(after, 'tower'))?.alt).toBe('Spaghetti and tape');
  });

  it('removes a media block outright, since the block is the picture', () => {
    // `image` is a freeform composition now; the wired media kinds are the
    // ones whose block *is* the picture.
    const media = insertAfter(base(), 'welcome', 'media-full');
    const after = removeMedia(media.outline, media.stepId);
    expect(after.steps.some((step) => step.id === media.stepId)).toBe(false);
    expectValid(after);
  });
});

describe('setDurationSeconds, setTimerStyle and setInteraction', () => {
  it('sets timer duration in whole seconds', () => {
    const timer = insertAfter(base(), 'welcome', 'timer');
    const after = setDurationSeconds(timer.outline, timer.stepId, 95);
    expect(stepSeconds(stepOf(after, timer.stepId))).toBe(95);
    expect(stepMinutes(stepOf(after, timer.stepId))).toBe(2);
    expectValid(after);
  });

  it('sets timer look and clears the field for the default countdown', () => {
    const timer = insertAfter(base(), 'welcome', 'timer');
    const hourglass = setTimerStyle(timer.outline, timer.stepId, 'hourglass');
    expect(stepOf(hourglass, timer.stepId)).toMatchObject({ style: 'hourglass' });
    expectValid(hourglass);
    const back = setTimerStyle(hourglass, timer.stepId, 'countdown');
    const backStep = stepOf(back, timer.stepId);
    expect(backStep.kind).toBe('timer');
    if (backStep.kind === 'timer') expect(backStep.style).toBeUndefined();
    expectValid(back);
  });

  it('keeps duration tokens when the canvas commits the expanded title', () => {
    const timer = insertAfter(base(), 'welcome', 'timer');
    timer.outline = setPartText(timer.outline, timer.stepId, 'header', '{timer-minutes} minutes');
    // Slide shows "10 minutes"; blur would commit that display string.
    const after = setPartText(timer.outline, timer.stepId, 'header', '10 minutes');
    expect(stepOf(after, timer.stepId)).toMatchObject({ title: '{timer-minutes} minutes' });
    // Real rewrite is stored as plain text.
    const rewritten = setPartText(timer.outline, timer.stepId, 'header', 'Think');
    expect(stepOf(rewritten, timer.stepId)).toMatchObject({ title: 'Think' });
  });

  it('replaces a question’s interaction (type and chart)', () => {
    const q = insertAfter(base(), 'welcome', 'question');
    const step = stepOf(q.outline, q.stepId);
    if (step.kind !== 'interaction') throw new Error('expected interaction');
    const next: Interaction = {
      id: step.interactionId,
      type: 'scale',
      prompt: 'How confident?',
      min: 1,
      max: 5,
      display: 'gauge',
    };
    const after = setInteraction(q.outline, q.stepId, next);
    const ix = after.interactions.find((item) => item.id === step.interactionId);
    expect(ix).toMatchObject({ type: 'scale', display: 'gauge', min: 1, max: 5 });
    expectValid(after);
  });
});

describe('timer placement, persist, homework and recap', () => {
  it('sets timer placement and clears the default slide field', () => {
    const timer = insertAfter(base(), 'welcome', 'timer');
    const corner = setTimerPlacement(timer.outline, timer.stepId, 'corner');
    expect(stepOf(corner, timer.stepId)).toMatchObject({ placement: 'corner' });
    expectValid(corner);
    const back = setTimerPlacement(corner, timer.stepId, 'slide');
    const step = stepOf(back, timer.stepId);
    expect(step.kind).toBe('timer');
    if (step.kind === 'timer') expect(step.placement).toBeUndefined();
    expectValid(back);
  });

  it('sets persist false and clears the default true field', () => {
    const timer = insertAfter(base(), 'welcome', 'timer');
    const off = setTimerPersist(timer.outline, timer.stepId, false);
    expect(stepOf(off, timer.stepId)).toMatchObject({ persist: false });
    expectValid(off);
    const on = setTimerPersist(off, timer.stepId, true);
    const step = stepOf(on, timer.stepId);
    expect(step.kind).toBe('timer');
    if (step.kind === 'timer') expect(step.persist).toBeUndefined();
    expectValid(on);
  });

  it('writes homework and recap asides that stay off the running order', () => {
    const withHomework = setHomework(base(), {
      title: 'Tonight',
      items: ['Write six sentences.'],
    });
    expect(withHomework.homework).toEqual({ title: 'Tonight', items: ['Write six sentences.'] });
    expect(withHomework.steps).toEqual(base().steps);
    expectValid(withHomework);

    const withRecap = setRecap(withHomework, { body: 'We practised avoir.' });
    expect(withRecap.recap).toEqual({ body: 'We practised avoir.' });
    expectValid(withRecap);

    const cleared = setHomework(withRecap, undefined);
    expect(cleared.homework).toBeUndefined();
    expectValid(cleared);
  });

  it('adds typed homework tasks without turning them into slides', () => {
    const withQuiz = addHomeworkQuiz(base());
    expect(withQuiz.homework?.tasks).toHaveLength(1);
    expect(withQuiz.homework?.tasks?.[0]?.kind).toBe('quiz');
    expect(withQuiz.steps).toEqual(base().steps);
    expect(withQuiz.interactions.length).toBe(base().interactions.length + 1);
    expectValid(withQuiz);

    const withReading = addHomeworkReading(withQuiz);
    expect(withReading.homework?.tasks).toHaveLength(2);
    const dropped = removeHomeworkTask(withReading, withReading.homework!.tasks![0]!.id);
    expect(dropped.homework?.tasks).toHaveLength(1);
    expectValid(dropped);
  });
});

describe('text element formatting', () => {
  function withTextBox(): { outline: Outline; boxId: string } {
    const result = addTextElement(base(), 'welcome');
    expect(result.elementId).not.toBe('');
    return { outline: setElementText(result.outline, 'welcome', result.elementId, 'Type here'), boxId: result.elementId };
  }

  function textOf(outline: Outline, boxId: string) {
    const step = outline.steps.find((item) => item.id === 'welcome')!;
    return stepElements(step).find(
      (item): item is Extract<typeof item, { type: 'text' }> =>
        item.id === boxId && item.type === 'text',
    );
  }

  it('styles a character range and keeps spans consistent with text', () => {
    const { outline, boxId } = withTextBox();
    const styled = styleElementRange(outline, 'welcome', boxId, 0, 4, { bold: true, color: '#0F6CBD' });
    const element = textOf(styled, boxId)!;
    expect(element.text).toBe('Type here');
    expect(element.spans).toEqual([
      { text: 'Type', bold: true, color: '#0F6CBD' },
      { text: ' here' },
    ]);
    expectValid(styled);
  });

  it('retargets spans when the text is edited so the mirror never drifts', () => {
    const { outline, boxId } = withTextBox();
    const styled = styleElementRange(outline, 'welcome', boxId, 0, 4, { bold: true });
    const edited = setElementText(styled, 'welcome', boxId, 'Typing more words');
    const element = textOf(edited, boxId)!;
    expect(element.text).toBe('Typing more words');
    // The diff consumes "Type"'s final e into the edit, so the bold span keeps
    // "Typ"; the replacement inherits nothing because it spanned two spans.
    expect(element.spans?.[0]).toEqual({ text: 'Typ', bold: true });
    expect(element.spans?.[1]).toEqual({ text: 'ing more words' });
    expect(element.spans?.map((span) => span.text).join('')).toBe('Typing more words');
    expectValid(edited);
  });

  it('writes a full span list and derives the text mirror from it', () => {
    const { outline, boxId } = withTextBox();
    const written = setElementSpans(outline, 'welcome', boxId, [
      { text: 'Bonjour', italic: true, size: 200 },
      { text: ', tout le monde' },
    ]);
    const element = textOf(written, boxId)!;
    expect(element.text).toBe('Bonjour, tout le monde');
    expect(element.spans?.[0]?.size).toBe(200);
    expectValid(written);
  });

  it('sets alignment and clears styling back to plain text', () => {
    const { outline, boxId } = withTextBox();
    const centered = setElementAlign(outline, 'welcome', boxId, 'center');
    expect(textOf(centered, boxId)?.align).toBe('center');
    expectValid(centered);

    const styled = styleElementRange(centered, 'welcome', boxId, 0, 9, { underline: true, size: 300 });
    const cleared = clearElementStyling(styled, 'welcome', boxId);
    const element = textOf(cleared, boxId)!;
    expect(element.align).toBe('center'); // alignment is not span styling
    expect(element.spans).toBeUndefined();
    expectValid(cleared);
  });

  it('clears only the selected range', () => {
    const { outline, boxId } = withTextBox();
    const styled = styleElementRange(outline, 'welcome', boxId, 0, 9, { bold: true });
    const cleared = clearElementStyling(styled, 'welcome', boxId, 5, 9);
    // Index 4 is the space, inside the originally styled range and outside
    // the cleared one — it keeps its bold along with "Type".
    const element = textOf(cleared, boxId)!;
    expect(element.spans).toEqual([{ text: 'Type ', bold: true }, { text: 'here' }]);
    expectValid(cleared);
  });

  it('clamps out-of-range sizes into the schema budget', () => {
    const { outline, boxId } = withTextBox();
    const huge = styleElementRange(outline, 'welcome', boxId, 0, 4, { size: 9999 });
    expect(textOf(huge, boxId)?.spans?.[0]?.size).toBeLessThanOrEqual(400);
    expectValid(huge);

    const tiny = styleElementRange(outline, 'welcome', boxId, 0, 4, { size: 1 });
    expect(textOf(tiny, boxId)?.spans?.[0]?.size).toBeGreaterThanOrEqual(25);
    expectValid(tiny);
  });
});

describe('styled spans on fixed slots', () => {
  it('says which parts accept styling, and which never can', () => {
    const outline = base();
    expect(partSpanCapable(outline, stepOf(outline, 'welcome'), 'header')).toBe(true);
    expect(partSpanCapable(outline, stepOf(outline, 'welcome'), 'body')).toBe(true);
    expect(partSpanCapable(outline, stepOf(outline, 'boxes'), 'cell-0')).toBe(true);
    expect(partSpanCapable(outline, stepOf(outline, 'tower'), 'cell-0')).toBe(true);
    expect(partSpanCapable(outline, stepOf(outline, 'tower'), 'material-0')).toBe(true);
    // The whole-materials free-text rewrite is not itself a span-capable part.
    expect(partSpanCapable(outline, stepOf(outline, 'tower'), 'materials')).toBe(false);
    // A question with no title override styles the interaction's own prompt.
    expect(partSpanCapable(outline, stepOf(outline, 'check'), 'header')).toBe(true);

    const timer = insertAfter(outline, 'welcome', 'timer');
    expect(partSpanCapable(timer.outline, stepOf(timer.outline, timer.stepId), 'header')).toBe(false);
    expect(partSpanCapable(timer.outline, stepOf(timer.outline, timer.stepId), 'body')).toBe(false);

    const gaps = insertAfter(outline, 'welcome', 'fill-the-gaps');
    expect(partSpanCapable(gaps.outline, stepOf(gaps.outline, gaps.stepId), 'header')).toBe(false);
  });

  it('styles a range of a heading and leaves the text mirror alone', () => {
    const after = stylePartRange(base(), 'welcome', 'header', 0, 3, { bold: true });
    expectValid(after);
    const step = stepOf(after, 'welcome');
    expect(step.kind === 'title' ? step.title : '').toBe('Les voyages');
    expect(partSpans(after, step, 'header')).toEqual([
      { text: 'Les', bold: true },
      { text: ' voyages' },
    ]);
  });

  it('drops the span field again when the last styling goes', () => {
    const styled = stylePartRange(base(), 'welcome', 'header', 0, 3, { bold: true });
    const plain = clearPartStyling(styled, 'welcome', 'header');
    expectValid(plain);
    const step = stepOf(plain, 'welcome');
    expect(partSpans(plain, step, 'header')).toBeUndefined();
    expect('titleSpans' in step).toBe(false);
  });

  it('clears only the selected range', () => {
    const styled = stylePartRange(base(), 'welcome', 'header', 0, 11, { italic: true });
    const partial = clearPartStyling(styled, 'welcome', 'header', 0, 4);
    expectValid(partial);
    expect(partSpans(partial, stepOf(partial, 'welcome'), 'header')).toEqual([
      { text: 'Les ' },
      { text: 'voyages', italic: true },
    ]);
  });

  it('writes a question prompt’s styling onto the interaction', () => {
    const after = stylePartRange(base(), 'check', 'header', 0, 6, { color: '#0f6cbd' });
    expectValid(after);
    expect(after.interactions[0]?.promptSpans).toEqual([
      { text: 'Choose', color: '#0f6cbd' },
      { text: ' the correct sentence.' },
    ]);
    const cleared = clearPartStyling(after, 'check', 'header');
    expect(cleared.interactions[0]?.promptSpans).toBeUndefined();
  });

  it('does nothing on a timer, whose stored text is not its drawn text', () => {
    const timer = insertAfter(base(), 'welcome', 'timer');
    const after = stylePartRange(timer.outline, timer.stepId, 'header', 0, 2, { bold: true });
    expect(after).toBe(timer.outline);
  });

  it('delegates an el- key to the element path', () => {
    const added = addTextElement(base(), 'welcome');
    const after = stylePartRange(setElementText(added.outline, 'welcome', added.elementId, 'Type here'), 'welcome', `el-${added.elementId}`, 0, 4, {
      bold: true,
    });
    expectValid(after);
    const element = stepElements(stepOf(after, 'welcome')).find((item) => item.id === added.elementId);
    expect(element?.type === 'text' ? element.spans : undefined).toEqual([
      { text: 'Type', bold: true },
      { text: ' here' },
    ]);
  });

  it('clamps an out-of-range size into the schema budget', () => {
    const after = stylePartRange(base(), 'welcome', 'header', 0, 3, { size: 5000 });
    expectValid(after);
    expect(partSpans(after, stepOf(after, 'welcome'), 'header')?.[0]?.size).toBe(400);
  });

  it('keeps styling on the words a text edit did not touch', () => {
    const styled = stylePartRange(base(), 'welcome', 'header', 0, 3, { bold: true });
    const edited = setPartText(styled, 'welcome', 'header', 'Les voyages en train');
    expectValid(edited);
    expect(partSpans(edited, stepOf(edited, 'welcome'), 'header')).toEqual([
      { text: 'Les', bold: true },
      { text: ' voyages en train' },
    ]);
  });

  it('retargets a styled prompt when the question’s words change', () => {
    const styled = stylePartRange(base(), 'check', 'header', 0, 6, { bold: true });
    const edited = setPartText(styled, 'check', 'header', 'Choose the right sentence.');
    expectValid(edited);
    expect(edited.interactions[0]?.promptSpans?.[0]).toEqual({ text: 'Choose', bold: true });
  });

  it('drops a span list a rewrite left carrying nothing', () => {
    const styled = stylePartRange(base(), 'welcome', 'body', 0, 4, { bold: true });
    const edited = setPartText(styled, 'welcome', 'body', 'Completely different.');
    expectValid(edited);
    expect(partSpans(edited, stepOf(edited, 'welcome'), 'body')).toBeUndefined();
  });

  it('styles an answer option onto the interaction option list', () => {
    const styled = stylePartRange(base(), 'check', 'option-0', 0, 4, { bold: true });
    expectValid(styled);
    expect(optionsFor(styled, stepOf(styled, 'check'))[0]?.labelSpans).toEqual([
      { text: "J'ai", bold: true },
      { text: ' raté le train.' },
    ]);
  });

  it('styles a steps cell onto the itemsSpans mirror', () => {
    const steps = insertAfter(base(), 'welcome', 'steps');
    const styled = stylePartRange(setPartText(steps.outline, steps.stepId, 'cell-0', 'First step'), steps.stepId, 'cell-0', 0, 5, { italic: true });
    expectValid(styled);
    const step = stepOf(styled, steps.stepId);
    expect(step.kind === 'steps' ? step.itemsSpans : undefined).toEqual([
      [{ text: 'First', italic: true }, { text: ' step' }],
    ]);
  });

  it('styles a material line onto the materialsSpans mirror', () => {
    const styled = stylePartRange(base(), 'tower', 'material-0', 0, 9, { bold: true });
    expectValid(styled);
    const step = stepOf(styled, 'tower');
    expect(step.kind === 'activity' ? step.materialsSpans : undefined).toEqual([
      [{ text: 'Spaghetti', bold: true }],
    ]);
  });

  it('keeps an option label’s styling on the words a text edit did not touch', () => {
    const styled = stylePartRange(base(), 'check', 'option-0', 0, 4, { bold: true });
    const edited = setPartText(styled, 'check', 'option-0', "J'ai perdu le train.");
    expectValid(edited);
    expect(optionsFor(edited, stepOf(edited, 'check'))[0]?.labelSpans?.[0]).toEqual({
      text: "J'ai",
      bold: true,
    });
  });

  it('keeps a steps cell’s styling on the words a text edit did not touch', () => {
    const steps = insertAfter(base(), 'welcome', 'steps');
    const styled = stylePartRange(setPartText(steps.outline, steps.stepId, 'cell-0', 'First step'), steps.stepId, 'cell-0', 0, 5, { bold: true });
    const edited = setPartText(styled, steps.stepId, 'cell-0', 'First stage');
    expectValid(edited);
    const step = stepOf(edited, steps.stepId);
    expect(step.kind === 'steps' ? step.itemsSpans?.[0]?.[0] : undefined).toEqual({
      text: 'First',
      bold: true,
    });
  });
});

describe('list edits keep the SpanRows mirror aligned', () => {
  it('addListItem shifts a styled instruction to its new line, not a stranger one', () => {
    const styled = stylePartRange(base(), 'tower', 'cell-1', 0, 4, { bold: true });
    const grown = addListItem(styled, 'tower', 'instruction', 0);
    expectValid(grown);
    const step = stepOf(grown, 'tower');
    expect(step.kind === 'activity' ? step.instructions[2] : undefined).toBe('Plan for two minutes');
    expect(step.kind === 'activity' ? step.instructionsSpans?.[2]?.[0] : undefined).toEqual({
      text: 'Plan',
      bold: true,
    });
  });

  it('removeListItem shifts a styled instruction to its new line, not a stranger one', () => {
    const styled = stylePartRange(base(), 'tower', 'cell-1', 0, 4, { bold: true });
    const shrunk = removeListItem(styled, 'tower', 'instruction', 0);
    expectValid(shrunk);
    const step = stepOf(shrunk, 'tower');
    expect(step.kind === 'activity' ? step.instructions[0] : undefined).toBe('Plan for two minutes');
    expect(step.kind === 'activity' ? step.instructionsSpans?.[0]?.[0] : undefined).toEqual({
      text: 'Plan',
      bold: true,
    });
  });

  it('a whole-materials rewrite drops the materialsSpans mirror', () => {
    const styled = stylePartRange(base(), 'tower', 'material-0', 0, 4, { bold: true });
    const rewritten = setPartText(styled, 'tower', 'materials', 'Pen\nPaper');
    expectValid(rewritten);
    const step = stepOf(rewritten, 'tower');
    expect(step.kind === 'activity' ? step.materials : undefined).toEqual(['Pen', 'Paper']);
    expect(step.kind === 'activity' ? step.materialsSpans : undefined).toBeUndefined();
  });

  it('removing the last material removes materials and materialsSpans together', () => {
    const styled = stylePartRange(base(), 'tower', 'material-0', 0, 4, { bold: true });
    const oneLeft = removeListItem(styled, 'tower', 'material', 1);
    const noneLeft = removeListItem(oneLeft, 'tower', 'material', 0);
    expectValid(noneLeft);
    const step = stepOf(noneLeft, 'tower');
    expect(step.kind === 'activity' ? step.materials : undefined).toBeUndefined();
    expect(step.kind === 'activity' ? step.materialsSpans : undefined).toBeUndefined();
  });
});

describe('fill-the-gaps prompt font', () => {
  it('sets a font-only prompt’s family; "default" removes it', () => {
    const gaps = authoredGap();
    const step = stepOf(gaps.outline, gaps.stepId);
    const interactionId = step.kind === 'interaction' ? step.interactionId : '';

    const withFont = setPartFont(gaps.outline, gaps.stepId, 'header', 'serif');
    expectValid(withFont);
    expect(partFont(withFont, stepOf(withFont, gaps.stepId), 'header')).toBe('serif');
    expect(promptFontFor(withFont, stepOf(withFont, gaps.stepId))).toBe('serif');

    const cleared = setPartFont(withFont, gaps.stepId, 'header', 'default');
    expectValid(cleared);
    expect(partFont(cleared, stepOf(cleared, gaps.stepId), 'header')).toBeUndefined();
    expect(cleared.interactions.find((item) => item.id === interactionId)).not.toHaveProperty(
      'promptFont',
    );
  });

  it('partFontOnly is true only for a fill-the-gaps prompt heading, false once the step has its own title', () => {
    const gaps = authoredGap();
    const step = stepOf(gaps.outline, gaps.stepId);
    expect(partFontOnly(gaps.outline, step, 'header')).toBe(true);

    const titled: Outline = {
      ...gaps.outline,
      steps: gaps.outline.steps.map((item) =>
        item.id === gaps.stepId ? { ...item, title: 'Custom title' } : item,
      ),
    };
    expect(partFontOnly(titled, stepOf(titled, gaps.stepId), 'header')).toBe(false);
  });
});

describe('element layouts', () => {
  function composition(kind: 'title' | 'image') {
    const result = insertAfter(base(), 'welcome', kind);
    return { outline: result.outline, stepId: result.stepId };
  }

  function boxOf(outline: Outline, stepId: string, elementId: string) {
    return stepElements(stepOf(outline, stepId)).find((item) => item.id === elementId)?.box;
  }

  it('offers presets only for a composition slide', () => {
    const { outline, stepId } = composition('title');
    expect(elementLayoutsFor(stepOf(outline, stepId))).toBe(ELEMENT_LAYOUTS);
    expect(elementLayoutsFor(stepOf(outline, 'boxes'))).toEqual([]);
    const empty = insertAfter(base(), 'welcome', 'blank');
    expect(elementLayoutsFor(stepOf(empty.outline, empty.stepId))).toEqual([]);
  });

  it('re-boxes heading, body and picture into the preset it is given', () => {
    const { outline, stepId } = composition('image');
    for (const layout of ELEMENT_LAYOUTS) {
      const after = applyElementLayout(outline, stepId, layout.id);
      expectValid(after);
      if (layout.slots.heading !== undefined) {
        expect([layout.id, boxOf(after, stepId, 'head')]).toEqual([layout.id, layout.slots.heading]);
      }
      if (layout.slots.body !== undefined) {
        expect([layout.id, boxOf(after, stepId, 'body')]).toEqual([layout.id, layout.slots.body]);
      }
      if (layout.slots.media !== undefined) {
        expect([layout.id, boxOf(after, stepId, 'pic')]).toEqual([layout.id, layout.slots.media]);
      }
    }
  });

  it('skips a slot the slide has nothing to fill it with', () => {
    // A title composition has no picture: the media slot is simply not used,
    // and its text still moves.
    const { outline, stepId } = composition('title');
    const after = applyElementLayout(outline, stepId, 'split');
    expectValid(after);
    expect(boxOf(after, stepId, 'head')).toEqual({ x: 8, y: 18, w: 38, h: 20 });
    expect(stepElements(stepOf(after, stepId))).toHaveLength(2);
  });

  it('leaves everything past the first of each role where the author put it', () => {
    const { outline, stepId } = composition('title');
    const added = addTextElement(outline, stepId);
    const before = boxOf(added.outline, stepId, added.elementId);
    const after = applyElementLayout(added.outline, stepId, 'centered');
    expect(boxOf(after, stepId, added.elementId)).toEqual(before);
  });

  it('does nothing for an unknown preset or a wired kind', () => {
    const { outline, stepId } = composition('title');
    expect(applyElementLayout(outline, stepId, 'nope')).toBe(outline);
    expect(applyElementLayout(outline, 'boxes', 'centered')).toBe(outline);
  });
});

/** These editing tests operate on authored content, not insertion watermarks. */
function authoredGap() {
  const inserted = insertAfter(base(), 'welcome', 'fill-the-gaps');
  const interaction = inserted.outline.interactions.find((item) => item.type === 'fill-the-gaps')!;
  return { ...inserted, outline: setInteraction(inserted.outline, inserted.stepId, { id: interaction.id, type: 'fill-the-gaps', prompt: "J'{{g1}} raté le train.", gaps: [{ id: 'g1', answers: ['ai'] }] }) };
}
