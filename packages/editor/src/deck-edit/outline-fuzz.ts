/**
 * Integration layer for the deck editor's structured writes.
 *
 * The deck editor never types YAML: every button and caret commit is a pure function in
 * `outline-edit.ts`. The lockout screen is `stringify` then `parseOutline`
 * rejecting the result. This file walks those functions the same way
 * `DeckEditor.apply` persists them.
 *
 * Keep it current: `INSERT_KINDS` / `LIST_TARGETS` live in outline-edit, and
 * every runtime export of that module is classified below as a walked write,
 * a helper covered by a write, or a read. Adding `setFoo` fails the registry
 * test until you add an op or mark it read-only.
 *
 * Agents do not belong on this path. `/outline-write-hunt` is only for writes
 * that skipped outline-edit entirely.
 */
import { stringify } from 'yaml';
import {
  LAYOUTS_FOR_KIND,
  defaultDeckDesign,
  slideTheme,
  SLIDE_THEME_FAMILIES,
  SLIDE_TEMPLATES,
  WORKSHOP_SEQUENCES,
  DECK_ASPECT_RATIOS,
  TIMER_STYLES,
  fillTheGapsPromptText,
  gapsForFillTheGapsPrompt,
  parseOutline,
  partKeysForStep,
  stepElements,
  validateOutline,
  type Interaction,
  type Outline,
  type OutlineMediaAspect,
  type OutlineMediaFocal,
  type OutlineMediaPlace,
  type OutlineStep,
} from '@openroom/schema';

import {
  INSERT_KINDS,
  LIST_TARGETS,
  addHtmlElement,
  addIframeElement,
  addMarkdownElement,
  addPdfElement,
  addImageElement,
  addTextElement,
  addListItem,
  applyPictureTarget,
  canAddListItem,
  canRemoveListItem,
  applyElementLayout,
  clearPairWork,
  clearPartStyling,
  duplicateStep,
  insertAfter,
  insertTemplate,
  insertWorkshop,
  insertCorrection,
  resetTemplateFormatting,
  moveBlock,
  orderedBlocks,
  elementLayoutsFor,
  partFontOnly,
  partSpanCapable,
  partText,
  removeListItem,
  removeElement,
  removeMedia,
  removeStep,
  setDurationSeconds,
  addHomeworkQuiz,
  setHomeworkInteraction,
  addHomeworkReading,
  addHomeworkWriting,
  addHomeworkVoice,
  addPracticeHomework,
  insertPracticeExercise,
  removeHomeworkTask,
  setHomework,
  setHomeworkTask,
  setInteraction,
  setLayout,
  setElementBox,
  setElementHtml,
  setElementIframe,
  setElementMarkdown,
  setElementPdf,
  setElementImage,
  setElementText,
  clearElementStyling,
  setElementAlign,
  setElementSpans,
  styleElementRange,
  setMediaAspect,
  setMedia,
  setMediaFocal,
  setMediaPlace,
  setMediaSize,
  setMinutes,
  setOptionCorrect,
  setGapAnswers,
  setGapDistractors,
  setFillTheGapsBank,
  insertGapAtRange,
  setPartFont,
  setPartText,
  stylePartRange,
  setRecap,
  setReveal,
  setTimerPersist,
  setTimerPlacement,
  setTimerStyle,
  setTutorNotes,
  applyBrandKit,
  setDeckDesign,
  setSlideDesign,
  splitForPairWork,
  stepMedia,
  type PictureTarget,
} from './outline-edit';
import * as outlineEdits from './outline-edit';

export const FUZZ_INSERT_KINDS = INSERT_KINDS;
export const FUZZ_LIST_TARGETS = LIST_TARGETS;

const PICTURE = {
  type: 'image' as const,
  url: 'https://example.test/fuzz.png',
  alt: 'A photograph',
};

export function seedOutline(): Outline {
  return {
    version: 1,
    meta: { title: 'Fuzz deck' },
    steps: [{ id: 'welcome', kind: 'title', title: 'Welcome', body: 'One line.' }],
    interactions: [
      {
        id: 'warmup',
        type: 'choice',
        prompt: 'How ready are you?',
        options: [
          { id: 'a', label: 'Ready' },
          { id: 'b', label: 'Not yet' },
        ],
      },
    ],
  };
}

export interface FuzzFailure {
  seed: number;
  walk: number;
  step: number;
  op: string;
  errors: string[];
}

/** Object validates, and the YAML the editor would persist still parses. */
export function editorRoundtrip(outline: Outline): { ok: true; outline: Outline } | { ok: false; errors: string[] } {
  const object = validateOutline(outline);
  if (!object.ok) {
    return { ok: false, errors: object.errors.map((error) => `${error.code} ${error.path}: ${error.message}`) };
  }
  const parsed = parseOutline(stringify(outline, { lineWidth: 100 }), 'yaml');
  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.errors.map((error) => `yaml ${error.code} ${error.path}: ${error.message}`),
    };
  }
  return { ok: true, outline: parsed.outline };
}

export interface FuzzState {
  outline: Outline;
  selectedId: string;
}

function selectedStep(state: FuzzState): OutlineStep | undefined {
  return state.outline.steps.find((step) => step.id === state.selectedId) ?? state.outline.steps[0];
}

function pick<T>(rng: () => number, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

/** Deterministic, seeded PRNG (mulberry32) — same as the domain fuzz. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FuzzOpName =
  | 'workshop-insert'
  | 'template-insert'
  | 'correction-insert'
  | 'practice-reuse'
  | 'template-reset'
  | 'brand-kit'
  | 'deck-design'
  | 'slide-design'
  | 'rename'
  | 'insert'
  | 'insert-breakout'
  | 'duplicate'
  | 'remove'
  | 'move'
  | 'part-text'
  | 'part-text-blank'
  | 'part-text-display'
  | 'add-list'
  | 'remove-list'
  | 'layout'
  | 'reveal-together'
  | 'reveal-sequence'
  | 'minutes'
  | 'duration'
  | 'option-correct'
  | 'homework'
  | 'homework-task'
  | 'recap'
  | 'notes'
  | 'media'
  | 'remove-media'
  | 'media-focal'
  | 'media-aspect'
  | 'media-place'
  | 'media-size'
  | 'element'
  | 'element-style'
  | 'part-style'
  | 'element-layout'
  | 'reading'
  | 'pair-work'
  | 'timer-style'
  | 'timer-placement'
  | 'timer-persist'
  | 'ask'
  | 'gap-extras';

/**
 * Every runtime export of `outline-edit` is one of these. Types vanish at
 * runtime; the registry test compares `Object.keys(outlineEdits)` to this set.
 */
export const EDIT_WRITE_OPS = {
  insertWorkshop: 'workshop-insert',
  insertTemplate: 'template-insert',
  insertCorrection: 'correction-insert',
  resetTemplateFormatting: 'template-reset',
  applyBrandKit: 'brand-kit',
  setDeckDesign: 'deck-design',
  setSlideDesign: 'slide-design',
  insertAfter: ['insert', 'insert-breakout'],
  duplicateStep: 'duplicate',
  removeStep: 'remove',
  moveBlock: 'move',
  setPartText: ['part-text', 'part-text-blank', 'part-text-display'],
  addListItem: 'add-list',
  removeListItem: 'remove-list',
  setLayout: 'layout',
  setReveal: ['reveal-together', 'reveal-sequence'],
  setMinutes: 'minutes',
  setDurationSeconds: 'duration',
  setOptionCorrect: 'option-correct',
  setHomework: 'homework',
  setHomeworkTask: 'homework-task',
  removeHomeworkTask: 'homework-task',
  addHomeworkReading: 'homework-task',
  addHomeworkWriting: 'homework-task',
  addHomeworkVoice: 'homework-task',
  addHomeworkQuiz: 'homework-task',
  setHomeworkInteraction: 'homework-task',
  addPracticeHomework: 'practice-reuse',
  insertPracticeExercise: 'practice-reuse',
  setRecap: 'recap',
  setTutorNotes: 'notes',
  setMedia: 'media',
  applyPictureTarget: 'media',
  removeMedia: 'remove-media',
  setMediaFocal: 'media-focal',
  setMediaAspect: 'media-aspect',
  setMediaPlace: 'media-place',
  setMediaSize: 'media-size',
  withMediaFocal: 'media-focal',
  withMediaAspect: 'media-aspect',
  withMediaPlace: 'media-place',
  withMediaSize: 'media-size',
  addTextElement: 'element',
  addImageElement: 'element',
  addHtmlElement: 'element',
  addIframeElement: 'element',
  addMarkdownElement: 'reading',
  addPdfElement: 'element',
  setElementBox: 'element',
  setElementText: 'element',
  setElementSpans: 'element-style',
  styleElementRange: 'element-style',
  setElementAlign: 'element-style',
  clearElementStyling: 'element-style',
  stylePartRange: 'part-style',
  clearPartStyling: 'part-style',
  setPartFont: 'part-style',
  applyElementLayout: 'element-layout',
  setElementHtml: 'element',
  setElementIframe: 'element',
  setElementMarkdown: 'reading',
  setElementPdf: 'element',
  setElementImage: 'element',
  removeElement: 'element',
  splitForPairWork: 'pair-work',
  clearPairWork: 'pair-work',
  setTimerStyle: 'timer-style',
  renameDeck: 'rename',
  setTimerPlacement: 'timer-placement',
  setTimerPersist: 'timer-persist',
  setInteraction: 'ask',
  setGapAnswers: 'gap-extras',
  setGapDistractors: 'gap-extras',
  setFillTheGapsBank: 'gap-extras',
  insertGapAtRange: 'gap-extras',
} as const satisfies Record<string, FuzzOpName | readonly FuzzOpName[]>;

export const EDIT_READS = [
  'INSERT_KINDS',
  'INSERT_TOP',
  'INSERT_CATALOG',
  'ELEMENT_LAYOUTS',
  'elementLayoutsFor',
  'LIST_TARGETS',
  'STEP_KIND_WORDS',
  'orderedBlocks',
  'stepMinutes',
  'hasMinutes',
  'totalMinutes',
  'stepTitle',
  'stepSeconds',
  'asksTheClass',
  'askTheClassCount',
  'asideMeta',
  'stepMedia',
  'partText',
  'partEditable',
  'partFont',
  'partFontOnly',
  'partSpanCapable',
  'partSpans',
  'retargetSlotSpans',
  'materialIndex',
  'partLabel',
  'optionsFor',
  'promptFor',
  'promptSpansFor',
  'promptFontFor',
  'canAddListItem',
  'canRemoveListItem',
  'optionCorrect',
  // Starter-content helpers shared by the insert path: pure, no outline in, no
  // outline out — reads by the same rule as stepTitle.
  'insertIdBase',
  'starterStep',
] as const;

export function unclassifiedEditExports(mod: Record<string, unknown> = outlineEdits): string[] {
  const classified = new Set<string>([...Object.keys(EDIT_WRITE_OPS), ...EDIT_READS]);
  return Object.keys(mod)
    .filter((name) => !classified.has(name))
    .sort();
}

export const FUZZ_OP_NAMES: FuzzOpName[] = [
  'workshop-insert',
  'template-insert',
  'correction-insert',
  'practice-reuse',
  'template-reset',
  'brand-kit',
  'deck-design',
  'slide-design',
  'rename',
  'insert',
  'insert-breakout',
  'duplicate',
  'remove',
  'move',
  'part-text',
  'part-text-blank',
  'part-text-display',
  'add-list',
  'remove-list',
  'layout',
  'reveal-together',
  'reveal-sequence',
  'minutes',
  'duration',
  'option-correct',
  'homework',
  'homework-task',
  'recap',
  'notes',
  'media',
  'remove-media',
  'element',
  'element-style',
  'part-style',
  'element-layout',
  'reading',
  'pair-work',
  'timer-style',
  'timer-placement',
  'timer-persist',
  'ask',
  'gap-extras',
];

function applyNamedOp(state: FuzzState, name: FuzzOpName, rng: () => number): FuzzState {
  const step = selectedStep(state);
  if (step === undefined) return state;
  const outline = state.outline;

  switch (name) {
    case 'rename': return { ...state, outline: outlineEdits.renameDeck(outline, rng() < 0.5 ? 'Renamed deck' : '') };
    case 'insert': {
      const kind = pick(rng, FUZZ_INSERT_KINDS);
      if (kind === undefined) return state;
      const result = insertAfter(outline, step.id, kind);
      if (result.stepId === '') return state;
      return { outline: result.outline, selectedId: result.stepId };
    }
    case 'insert-breakout': {
      const kind = pick(rng, FUZZ_INSERT_KINDS);
      const keys = partKeysForStep(step, outline.interactions);
      const afterKey = pick(rng, keys);
      if (kind === undefined || afterKey === undefined || step.breakoutOf !== undefined) return state;
      const result = insertAfter(outline, step.id, kind, { asBreakout: true, afterKey });
      if (result.stepId === '') return state;
      return { outline: result.outline, selectedId: result.stepId };
    }
    case 'duplicate': {
      const result = duplicateStep(outline, step.id);
      return { outline: result.outline, selectedId: result.stepId };
    }
    case 'remove': {
      const blocks = orderedBlocks(outline);
      if (step.breakoutOf === undefined && blocks.length < 2) return state;
      const next = removeStep(outline, step.id);
      const fallback = next.steps[0]?.id ?? step.id;
      return { outline: next, selectedId: fallback };
    }
    case 'move': {
      const blocks = orderedBlocks(outline);
      return { outline: moveBlock(outline, step.id, Math.floor(rng() * Math.max(1, blocks.length))), selectedId: step.id };
    }
    case 'part-text':
    case 'part-text-blank':
    case 'part-text-display': {
      const keys = partKeysForStep(step, outline.interactions);
      const key = pick(rng, keys);
      if (key === undefined) return state;
      const current = partText(outline, step, key);
      const text =
        name === 'part-text-blank'
          ? ''
          : name === 'part-text-display'
            ? displayCommit(current)
            : rng() < 0.5
              ? `${current} x`
              : 'Rewritten';
      return { outline: setPartText(outline, step.id, key, text), selectedId: step.id };
    }
    case 'add-list': {
      const target = pick(rng, FUZZ_LIST_TARGETS);
      if (target === undefined || !canAddListItem(outline, step, target)) return state;
      return { outline: addListItem(outline, step.id, target), selectedId: step.id };
    }
    case 'remove-list': {
      const target = pick(rng, FUZZ_LIST_TARGETS);
      if (target === undefined || !canRemoveListItem(outline, step, target)) return state;
      return { outline: removeListItem(outline, step.id, target, 0), selectedId: step.id };
    }
    case 'layout': {
      const allowed = LAYOUTS_FOR_KIND[step.kind];
      const layout = pick(rng, allowed);
      if (layout === undefined) return state;
      return { outline: setLayout(outline, step.id, layout), selectedId: step.id };
    }
    case 'reveal-together': {
      const keys = partKeysForStep(step, outline.interactions);
      return { outline: setReveal(outline, step.id, keys.length === 0 ? [] : [keys]), selectedId: step.id };
    }
    case 'reveal-sequence': {
      const keys = partKeysForStep(step, outline.interactions);
      return { outline: setReveal(outline, step.id, keys.map((key) => [key])), selectedId: step.id };
    }
    case 'minutes':
      return { outline: setMinutes(outline, step.id, rng() < 0.5 ? 1 : -1), selectedId: step.id };
    case 'duration':
      return { outline: setDurationSeconds(outline, step.id, 1 + Math.floor(rng() * 600)), selectedId: step.id };
    case 'option-correct':
      return { outline: setOptionCorrect(outline, step.id, Math.floor(rng() * 4)), selectedId: step.id };
    case 'homework':
      return {
        outline:
          rng() < 0.2
            ? setHomework(outline, undefined)
            : setHomework(outline, { title: 'Homework', body: rng() < 0.3 ? '' : 'Do this.', items: rng() < 0.3 ? [''] : ['One'] }),
        selectedId: step.id,
      };
    case 'homework-task': {
      const roll = rng();
      const firstTask = outline.homework?.tasks?.[0];
      if (roll < 0.25) return { outline: addHomeworkReading(outline), selectedId: step.id };
      if (roll < 0.5) return { outline: addHomeworkWriting(outline), selectedId: step.id };
      if (roll < 0.6) return { outline: addHomeworkVoice(outline), selectedId: step.id };
      if (roll < 0.7) return { outline: addHomeworkQuiz(outline), selectedId: step.id };
      if (roll < 0.8 && firstTask?.kind === 'quiz') {
        const question = outline.interactions.find((item) => item.id === firstTask.interactionId);
        if (question) return { outline: setHomeworkInteraction(outline, { ...question, prompt: rng() < 0.5 ? '' : 'What changed?' }), selectedId: step.id };
      }
      if (roll < 0.85 && firstTask !== undefined) {
        return { outline: removeHomeworkTask(outline, firstTask.id), selectedId: step.id };
      }
      if (firstTask !== undefined && firstTask.kind === 'reading') {
        return {
          outline: setHomeworkTask(outline, { ...firstTask, body: 'Read it again.' }),
          selectedId: step.id,
        };
      }
      return {
        outline: addPracticeHomework(outline, { interaction: { id: 'past-tense', type: 'text', prompt: 'Say the past tense.', correctAnswers: ['went'] } }),
        selectedId: step.id,
      };
    }
    case 'recap':
      return {
        outline:
          rng() < 0.2
            ? setRecap(outline, undefined)
            : setRecap(outline, { title: 'Recap', body: 'What we kept.' }),
        selectedId: step.id,
      };
    case 'notes':
      return { outline: setTutorNotes(outline, step.id, rng() < 0.3 ? '' : 'Private note.'), selectedId: step.id };
    case 'workshop-insert': {
      const result = insertWorkshop(outline, step.id, pick(rng, WORKSHOP_SEQUENCES)!.id);
      return { outline: result.outline, selectedId: result.stepId || step.id };
    }
    case 'template-insert': {
      const result = insertTemplate(outline, step.id, pick(rng, SLIDE_TEMPLATES)!.id);
      return { outline: result.outline, selectedId: result.stepId || step.id };
    }
    case 'correction-insert': {
      const result = insertCorrection(outline, step.id, { original: 'Je suis allé.', replacement: 'Je suis allée.', explanation: rng() < 0.5 ? 'Accord avec le sujet.' : '' });
      return { outline: result.outline, selectedId: result.stepId || step.id };
    }
    case 'practice-reuse': {
      const template = pick(rng, SLIDE_TEMPLATES.filter((item) => item.interaction && ['choice', 'text', 'fill-the-gaps', 'match', 'ranking'].includes(item.interaction.type)))!;
      const exercise = { interaction: template.interaction as import('@openroom/schema').HomeworkPracticeInteraction };
      if (rng() < 0.5) return { outline: addPracticeHomework(outline, exercise), selectedId: step.id };
      const result = insertPracticeExercise(outline, step.id, exercise);
      return { outline: result.outline, selectedId: result.stepId || step.id };
    }
    case 'template-reset':
      return { outline: resetTemplateFormatting(outline, step.id), selectedId: step.id };
    case 'brand-kit':
      return { outline: applyBrandKit(outline, defaultDeckDesign(pick(rng, SLIDE_THEME_FAMILIES)!)), selectedId: step.id };
    case 'deck-design': {
      const design = structuredClone(outline.design ?? defaultDeckDesign());
      if (rng() < 0.5 && design.masters.length < 3) {
        design.masters.push({ ...structuredClone(design.masters[0]!), id: `m-${design.masters.length}`, name: 'Alternative' });
      } else if (design.masters.length > 1) {
        design.masters.pop();
      }
      design.theme = slideTheme(pick(rng, SLIDE_THEME_FAMILIES)!);
      design.aspectRatio = pick(rng, DECK_ASPECT_RATIOS)!;
      design.masters[0]!.background = rng() < 0.5
        ? { kind: 'gradient', from: '#FFFFFF', to: '#CCDDEE', angle: Math.floor(rng() * 361) }
        : { kind: 'image', url: 'https://local.openroom.invalid/923ae01f-e7ed-47b6-8735-ecf8ec9c72b6', focal: { x: 20, y: 70 }, overlay: { color: '#FFFFFF', opacity: 0.8 } };
      design.masters[0]!.logo = { assetId: 'logo-asset', url: '/api/assets/logo-asset', alt: 'School logo' };
      return { outline: setDeckDesign(outline, design), selectedId: step.id };
    }
    case 'slide-design':
      return { outline: setSlideDesign(outline, step.id, { masterId: pick(rng, outline.design?.masters ?? defaultDeckDesign().masters)!.id, background: { kind: 'solid', color: '#FFFFFF' }, hideMasterDecorations: rng() < 0.5 }), selectedId: step.id };
    case 'media': {
      if (rng() < 0.4) return { outline: setMedia(outline, step.id, {
        type: 'audio', url: 'https://example.org/listening.mp3', alt: 'Écoutez le rendez-vous',
        listening: { mode: rng() < 0.5 ? 'room' : 'individual', transcript: 'Der Termin fällt aus. À jeudi !' },
      }), selectedId: step.id };
      // The picture dialog's routing verb: filling the slide's wired picture
      // slot and putting a freeform picture object on the slide are the same
      // gesture with different targets, so the walk exercises both.
      const image = stepElements(step).find((item) => item.type === 'image');
      const roll = rng();
      const target: PictureTarget =
        image !== undefined && roll < 0.34
          ? { kind: 'element', elementId: image.id }
          : roll < 0.67
            ? { kind: 'new' }
            : { kind: 'media' };
      const result = applyPictureTarget(outline, step.id, target, PICTURE);
      return { outline: result.outline, selectedId: step.id };
    }
    case 'remove-media':
      return { outline: stepMedia(step) === undefined ? outline : removeMedia(outline, step.id), selectedId: step.id };
    case 'pair-work':
      return {
        outline: rng() < 0.5 ? splitForPairWork(outline, step.id) : clearPairWork(outline, step.id),
        selectedId: step.id,
      };
    case 'timer-style': {
      const style = pick(rng, TIMER_STYLES);
      if (style === undefined) return state;
      return { outline: setTimerStyle(outline, step.id, style), selectedId: step.id };
    }
    case 'timer-placement':
      return {
        outline: setTimerPlacement(outline, step.id, rng() < 0.5 ? 'slide' : 'corner'),
        selectedId: step.id,
      };
    case 'timer-persist':
      return { outline: setTimerPersist(outline, step.id, rng() < 0.5), selectedId: step.id };
    case 'media-focal': {
      if (stepMedia(step) === undefined) return state;
      const focal = pick(rng, FOCALS);
      return { outline: setMediaFocal(outline, step.id, focal), selectedId: step.id };
    }
    case 'media-aspect': {
      if (stepMedia(step) === undefined) return state;
      const aspect = pick(rng, ASPECTS);
      return { outline: setMediaAspect(outline, step.id, aspect), selectedId: step.id };
    }
    case 'media-place': {
      if (stepMedia(step) === undefined) return state;
      const place = pick(rng, PLACES);
      if (place === undefined) return state;
      return { outline: setMediaPlace(outline, step.id, place), selectedId: step.id };
    }
    case 'media-size': {
      if (stepMedia(step) === undefined) return state;
      return { outline: setMediaSize(outline, step.id, 20 + Math.floor(rng() * 81)), selectedId: step.id };
    }
    case 'element': {
      const added = addTextElement(outline, step.id);
      if (added.elementId === '') return state;
      const moved = setElementBox(added.outline, step.id, added.elementId, {
        x: 10,
        y: 20,
        w: 40,
        h: 20,
      });
      return { outline: moved, selectedId: step.id };
    }
    case 'element-layout': {
      // Re-box a freeform composition into one of the presets. Geometry only:
      // the walk proves the boxes stay inside the canvas and the slide stays
      // readable afterwards.
      const layouts = elementLayoutsFor(step);
      const layout = pick(rng, layouts);
      if (layout === undefined) return state;
      return { outline: applyElementLayout(outline, step.id, layout.id), selectedId: step.id };
    }
    case 'part-style': {
      // Style a fixed slot — heading, body, headline number, or a question's
      // own prompt. The walk proves the span mirror survives a text commit and
      // the YAML round-trip beside the element path.
      const all = partKeysForStep(step, outline.interactions);
      // A fill-the-gaps prompt takes one family over the whole slot instead of
      // spans, and the toolbar writes it the same way any other style is written.
      const fontKey = all.find((key) => partFontOnly(outline, step, key));
      if (fontKey !== undefined && rng() < 0.5) {
        const family = pick(rng, ['default', 'display', 'serif', 'mono'] as const);
        return {
          outline: setPartFont(outline, step.id, fontKey, family ?? 'serif'),
          selectedId: step.id,
        };
      }
      const keys = all.filter((key) => partSpanCapable(outline, step, key));
      const key = pick(rng, keys);
      if (key === undefined) return state;
      const text = partText(outline, step, key);
      const end = Math.max(1, text.length);
      const roll = rng();
      if (roll < 0.3) {
        return {
          outline: stylePartRange(outline, step.id, key, 0, end, {
            bold: true,
            color: '#0F6CBD',
            size: 150,
          }),
          selectedId: step.id,
        };
      }
      if (roll < 0.5) {
        return {
          outline: stylePartRange(outline, step.id, key, Math.floor(end / 2), end, { italic: true }),
          selectedId: step.id,
        };
      }
      if (roll < 0.7) {
        return { outline: clearPartStyling(outline, step.id, key), selectedId: step.id };
      }
      if (roll < 0.85) {
        return {
          outline: clearPartStyling(outline, step.id, key, 1, Math.max(1, end - 1)),
          selectedId: step.id,
        };
      }
      const styled = stylePartRange(outline, step.id, key, 0, end, { bold: true });
      return { outline: setPartText(styled, step.id, key, `${text} et puis`), selectedId: step.id };
    }
    case 'element-style': {
      // Style whatever text element exists on this step; the fuzz walk proves
      // spans + text stay consistent and survive the YAML round-trip together.
      const target = findTextElementTarget(outline, step.id);
      if (target === null) return state;
      const roll = rng();
      if (roll < 0.2) {
        return {
          outline: styleElementRange(outline, step.id, target.id, 0, Math.max(1, target.text.length), {
            bold: true,
            color: '#0F6CBD',
            size: 150,
          }),
          selectedId: step.id,
        };
      }
      if (roll < 0.4) {
        return {
          outline: setElementAlign(outline, step.id, target.id, rng() < 0.5 ? 'center' : 'right'),
          selectedId: step.id,
        };
      }
      if (roll < 0.6) {
        return {
          outline: clearElementStyling(outline, step.id, target.id),
          selectedId: step.id,
        };
      }
      if (roll < 0.8) {
        return {
          outline: clearElementStyling(outline, step.id, target.id, 1, Math.max(1, target.text.length - 1)),
          selectedId: step.id,
        };
      }
      const rewritten = setElementText(outline, step.id, target.id, `${target.text} et puis`);
      return { outline: rewritten, selectedId: step.id };
    }
    // Reading material is the one element whose html is derived rather than
    // authored, so the round trip has to prove the pair survives YAML together.
    case 'reading': {
      const added = addMarkdownElement(outline, step.id, '# Reading\n\nA line with **weight**.');
      if (added.elementId === '') return state;
      const rewritten = setElementMarkdown(
        added.outline,
        step.id,
        added.elementId,
        '## Rewritten\n\n- one\n- two',
      );
      return { outline: rewritten, selectedId: step.id };
    }
    case 'ask': {
      if (step.kind !== 'interaction') return state;
      const next = { ...askInteraction(step.interactionId, pick(rng, ASK_KINDS) ?? 'choice'), responseMode: rng() < 0.5 ? 'group' as const : 'individual' as const };
      return { outline: setInteraction(outline, step.id, next), selectedId: step.id };
    }
    case 'gap-extras': {
      if (step.kind !== 'interaction') return state;
      const interaction = outline.interactions.find((item) => item.id === step.interactionId);
      if (interaction === undefined || interaction.type !== 'fill-the-gaps') return state;
      const roll = rng();
      if (roll < 0.25) {
        const gap = interaction.gaps[0];
        if (gap === undefined) return state;
        return {
          outline: setGapAnswers(outline, step.id, 0, [...gap.answers, 'also']),
          selectedId: step.id,
        };
      }
      if (roll < 0.5) {
        return { outline: setGapDistractors(outline, step.id, 0, ['suis', 'es']), selectedId: step.id };
      }
      if (roll < 0.75) {
        return { outline: setFillTheGapsBank(outline, step.id, ['le', 'la']), selectedId: step.id };
      }
      const at = interaction.prompt.indexOf('raté');
      if (at === -1) return { outline: insertGapAtRange(outline, step.id, 0, 0), selectedId: step.id };
      return { outline: insertGapAtRange(outline, step.id, at, at + 4), selectedId: step.id };
    }
  }
}

const FOCALS: (OutlineMediaFocal | undefined)[] = [
  undefined,
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

const ASPECTS: (OutlineMediaAspect | undefined)[] = [undefined, '16:9', '9:16', '4:3', '1:1'];

const PLACES: OutlineMediaPlace[] = ['left', 'right', 'top', 'bottom', 'fill'];

const ASK_KINDS = ['choice', 'fill-the-gaps', 'match', 'text', 'ranking', 'fill-the-gaps-broken'] as const;

function askInteraction(id: string, kind: (typeof ASK_KINDS)[number]): Interaction {
  if (kind === 'fill-the-gaps' || kind === 'fill-the-gaps-broken') {
    const prompt = kind === 'fill-the-gaps' ? "J'{{g1}} raté le train." : 'A sentence with no gap.';
    return { id, type: 'fill-the-gaps', prompt, gaps: gapsForFillTheGapsPrompt(prompt, [{ id: 'g1', answers: ['ai'] }]) };
  }
  if (kind === 'match') {
    return {
      id,
      type: 'match',
      prompt: 'Match the word to its meaning',
      left: [
        { id: 'left-1', label: 'First word' },
        { id: 'left-2', label: 'Second word' },
      ],
      right: [
        { id: 'right-1', label: 'First meaning' },
        { id: 'right-2', label: 'Second meaning' },
      ],
      correct: { 'left-1': 'right-1', 'left-2': 'right-2' },
    };
  }
  if (kind === 'text') return { id, type: 'text', prompt: 'Type an answer' };
  if (kind === 'ranking') {
    return {
      id,
      type: 'ranking',
      prompt: 'Put these in order',
      options: [
        { id: 'option-1', label: 'First option' },
        { id: 'option-2', label: 'Second option' },
      ],
    };
  }
  return {
    id,
    type: 'choice',
    prompt: 'Ask the class something',
    options: [
      { id: 'option-1', label: 'First option' },
      { id: 'option-2', label: 'Second option' },
      { id: 'option-3', label: 'Third option' },
    ],
  };
}

/**
 * What the canvas actually commits for a fill-the-gaps heading: the blanked display
 * text, not `{{g1}}`. That was the write that locked the editor.
 */
function displayCommit(stored: string): string {
  if (stored.includes('{{')) return fillTheGapsPromptText(stored);
  return stored;
}

/** First text element on the step, or null when this step carries none. */
function findTextElementTarget(outline: Outline, stepId: string): { id: string; text: string } | null {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return null;
  const element = stepElements(step).find((item) => item.type === 'text');
  if (element === undefined || element.type !== 'text') return null;
  return { id: element.id, text: element.text };
}

export interface WalkOptions {
  seed: number;
  walks: number;
  steps: number;
}

/**
 * Run `walks` independent sequences of `steps` ops from `seed`.
 * Returns the first failure, or null when every apply stayed editor-safe.
 */
export function walkEdits(options: WalkOptions): FuzzFailure | null {
  const { seed, walks, steps } = options;
  for (let walk = 0; walk < walks; walk += 1) {
    const rng = mulberry32((seed + walk * 0x9e3779b9) >>> 0);
    let state: FuzzState = { outline: seedOutline(), selectedId: 'welcome' };
    const opened = editorRoundtrip(state.outline);
    if (!opened.ok) {
      return { seed, walk, step: -1, op: 'seed', errors: opened.errors };
    }
    state = { ...state, outline: opened.outline };

    for (let step = 0; step < steps; step += 1) {
      const name = pick(rng, FUZZ_OP_NAMES);
      if (name === undefined) continue;
      const next = applyNamedOp(state, name, rng);
      const object = validateOutline(next.outline);
      if (!object.ok) {
        // DeckEditor.apply refuses this write. Staying put is the editor.
        continue;
      }
      const checked = editorRoundtrip(next.outline);
      if (!checked.ok) {
        return { seed, walk, step, op: `${name} @ ${state.selectedId}`, errors: checked.errors };
      }
      state = { ...next, outline: checked.outline };
    }
  }
  return null;
}

/** Every insert kind, then every part-key write the canvas can commit. */
export function exhaustInsertKinds(): FuzzFailure | null {
  for (const kind of FUZZ_INSERT_KINDS) {
    const inserted = insertAfter(seedOutline(), 'welcome', kind);
    if (inserted.stepId === '') {
      return { seed: 0, walk: 0, step: 0, op: `insert ${kind}`, errors: ['insert produced no step'] };
    }
    const opened = editorRoundtrip(inserted.outline);
    if (!opened.ok) {
      return { seed: 0, walk: 0, step: 0, op: `insert ${kind}`, errors: opened.errors };
    }
    const step = opened.outline.steps.find((item) => item.id === inserted.stepId);
    if (step === undefined) continue;
    const keys = partKeysForStep(step, opened.outline.interactions);
    for (const key of keys) {
      const current = partText(opened.outline, step, key);
      for (const text of [current, displayCommit(current), '', 'Rewritten', `${current} {{g2}}`]) {
        const next = setPartText(opened.outline, inserted.stepId, key, text);
        const checked = editorRoundtrip(next);
        if (!checked.ok) {
          return {
            seed: 0,
            walk: 0,
            step: 0,
            op: `setPartText ${kind} ${key} ← ${JSON.stringify(text)}`,
            errors: checked.errors,
          };
        }
      }
    }
    for (const target of FUZZ_LIST_TARGETS) {
      if (!canAddListItem(opened.outline, step, target)) continue;
      const added = addListItem(opened.outline, inserted.stepId, target);
      const checked = editorRoundtrip(added);
      if (!checked.ok) {
        return { seed: 0, walk: 0, step: 0, op: `addList ${kind} ${target}`, errors: checked.errors };
      }
    }
  }
  return null;
}

/** Every Ask-dialog kind, including a fill-the-gaps sentence that dropped its `{{id}}`. */
export function exhaustAskRewrites(): FuzzFailure | null {
  const inserted = insertAfter(seedOutline(), 'welcome', 'question');
  if (inserted.stepId === '') {
    return { seed: 0, walk: 0, step: 0, op: 'insert question', errors: ['insert produced no step'] };
  }
  const step = inserted.outline.steps.find((item) => item.id === inserted.stepId);
  if (step === undefined || step.kind !== 'interaction') {
    return { seed: 0, walk: 0, step: 0, op: 'insert question', errors: ['expected an interaction step'] };
  }
  for (const kind of ASK_KINDS) for (const responseMode of ['individual', 'group'] as const) {
    const next = setInteraction(inserted.outline, inserted.stepId, { ...askInteraction(step.interactionId, kind), responseMode });
    const checked = editorRoundtrip(next);
    if (!checked.ok) {
      return { seed: 0, walk: 0, step: 0, op: `setInteraction ${kind}`, errors: checked.errors };
    }
  }
  return null;
}
