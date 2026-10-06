import { describe, expect, it } from 'vitest';

import {
  ErrorCodes,
  compileOutline,
  parseOutline,
  projectOutlineStep,
  projectOutlineSteps,
  validateSession,
  validateOutline,
  OUTLINE_STEP_KINDS,
  type LearnerOutlineStep,
  type Outline,
} from '../src/index.js';

const outline: Outline = {
  version: 1,
  meta: {
    title: 'French B1: travel problems',
    subject: 'French',
    language: 'French',
    level: 'B1',
    durationMinutes: 45,
    objectives: ['Explain a travel problem', 'Choose the correct past tense'],
    provenance: [{ label: 'Friday test topics', note: 'Prepared outside OpenRoom' }],
  },
  steps: [
    { id: 'welcome', kind: 'title', title: 'Les voyages', tutorNotes: 'Ask what happened last weekend.' },
    { id: 'phrase', kind: 'term', term: 'rater le train', meaning: 'to miss the train', example: "J'ai raté le train." },
    { id: 'check', kind: 'interaction', interactionId: 'past-tense' },
    { id: 'reflect', kind: 'debrief', title: 'À retenir', prompts: ['What changed in the past tense?'] },
  ],
  interactions: [
    {
      id: 'past-tense',
      type: 'choice',
      prompt: 'Choose the correct sentence.',
      options: [
        { id: 'a', label: "J'ai raté le train.", correct: true },
        { id: 'b', label: 'Je rate le train hier.' },
        { id: 'c', label: 'Je suis rater le train.' },
      ],
      notes: 'Ask the learner to explain why before revealing.',
    },
  ],
};

describe('Outline v1', () => {
  it('accepts a picture on a title slide and rejects one on a join slide', () => {
    const withPicture: Outline = {
      ...outline,
      steps: [
        {
          id: 'welcome',
          kind: 'title',
          title: 'Les voyages',
          layout: 'split',
          media: { type: 'image', url: 'https://example.test/train.jpg', alt: 'A departing train' },
        },
        ...outline.steps.slice(1),
      ],
    };
    expect(validateOutline(withPicture).ok).toBe(true);

    const sized: Outline = {
      ...withPicture,
      steps: [
        {
          id: 'welcome',
          kind: 'title',
          title: 'Les voyages',
          layout: 'split',
          media: {
            type: 'image',
            url: 'https://example.test/train.jpg',
            alt: 'A departing train',
            place: 'left',
            size: 30,
          },
        },
        ...withPicture.steps.slice(1),
      ],
    };
    expect(validateOutline(sized).ok).toBe(true);
    const tooSmall = structuredClone(sized);
    (tooSmall.steps[0] as { media: { size: number } }).media.size = 5;
    expect(validateOutline(tooSmall).ok).toBe(false);

    const onJoin: Outline = {
      ...outline,
      steps: [...outline.steps, { id: 'scan', kind: 'join', media: { type: 'image', url: 'https://example.test/x.jpg', alt: 'No' } } as Outline['steps'][number]],
    };
    expect(validateOutline(onJoin).ok).toBe(false);
  });

  it('accepts freeform elements on a title and rejects them on a question', () => {
    const withBoxes: Outline = {
      ...outline,
      steps: [
        {
          id: 'welcome',
          kind: 'title',
          title: 'Les voyages',
          elements: [
            {
              id: 'note',
              type: 'text',
              text: 'Three things we already know',
              box: { x: 8, y: 40, w: 50, h: 20 },
            },
            {
              id: 'fig',
              type: 'html',
              html: '<svg viewBox="0 0 10 10" aria-label="dot"><circle cx="5" cy="5" r="3"/></svg>',
              box: { x: 60, y: 20, w: 30, h: 40 },
            },
          ],
        },
        ...outline.steps.slice(1),
      ],
    };
    expect(validateOutline(withBoxes).ok).toBe(true);

    const onPoll = {
      ...outline,
      steps: outline.steps.map((step) =>
        step.kind === 'interaction'
          ? { ...step, elements: [{ id: 'x', type: 'text', text: 'no', box: { x: 0, y: 0, w: 20, h: 20 } }] }
          : step,
      ),
    };
    expect(validateOutline(onPoll).ok).toBe(false);

    const withScript: Outline = {
      ...withBoxes,
      steps: [
        {
          id: 'welcome',
          kind: 'title',
          title: 'Les voyages',
          elements: [
            {
              id: 'bad',
              type: 'html',
              html: '<script>alert(1)</script>',
              box: { x: 0, y: 0, w: 20, h: 20 },
            },
          ],
        },
        ...outline.steps.slice(1),
      ],
    };
    expect(validateOutline(withScript).ok).toBe(false);
  });

  it('accepts a sandboxed iframe element and rejects unsafe addresses', () => {
    const withIframe: Outline = {
      ...outline,
      steps: [
        {
          id: 'article',
          kind: 'blank',
          elements: [
            {
              id: 'news',
              type: 'iframe',
              url: 'https://example.test/embed/article',
              title: 'News article',
              box: { x: 0, y: 0, w: 100, h: 100 },
            },
          ],
        },
        ...outline.steps,
      ],
    };
    expect(validateOutline(withIframe).ok).toBe(true);

    const insecure = structuredClone(withIframe);
    const first = insecure.steps[0];
    if (first?.kind === 'blank' && first.elements?.[0]?.type === 'iframe') {
      first.elements[0].url = 'http://example.test/embed/article';
    }
    const result = validateOutline(insecure);
    expect(result.ok ? [] : result.errors).toContainEqual(
      expect.objectContaining({ path: '/steps/0/elements/0/url' }),
    );
  });

  it('accepts a scrollable PDF element without relying on its filename suffix', () => {
    const withPdf: Outline = {
      ...outline,
      steps: [
        {
          id: 'handout',
          kind: 'blank',
          elements: [
            {
              id: 'document',
              type: 'pdf',
              url: 'https://example.test/documents/handout?id=42',
              title: 'Lesson handout',
              box: { x: 0, y: 0, w: 100, h: 100 },
            },
          ],
        },
        ...outline.steps,
      ],
    };
    expect(validateOutline(withPdf).ok).toBe(true);
  });

  it('accepts a picture on an activity, and rejects one without an address', () => {
    const withPicture: Outline = {
      ...outline,
      steps: [
        ...outline.steps,
        {
          id: 'tower',
          kind: 'activity',
          title: 'Build the tallest tower',
          instructions: ['Form groups of four'],
          media: { type: 'image', url: 'https://example.test/tower.jpg', alt: 'A spaghetti tower' },
        },
      ],
    };
    expect(validateOutline(withPicture).ok).toBe(true);

    const noAddress = structuredClone(withPicture);
    // Neither `assetId` nor `url`: a picture nobody can fetch.
    (noAddress.steps[4] as { media: { url?: string } }).media.url = undefined;
    delete (noAddress.steps[4] as { media: { url?: string } }).media.url;
    expect(validateOutline(noAddress).ok).toBe(false);
  });

  it('validates and compiles to an Outline of interaction steps', () => {
    const result = compileOutline(outline);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.meta.title).toBe(outline.meta.title);
    expect(result.session.interactions).toEqual(outline.interactions);
    expect(validateSession(result.session).ok).toBe(true);
  });

  it('accepts a join slide and rejects a layout it cannot fill', () => {
    const withJoin: Outline = {
      ...outline,
      steps: [...outline.steps, { id: 'scan', kind: 'join' }],
    };
    expect(validateOutline(withJoin).ok).toBe(true);

    const extraField = { ...withJoin, steps: [...outline.steps, { id: 'scan', kind: 'join', title: 'Scan' }] };
    expect(validateOutline(extraField).ok).toBe(false);

    const wrongLayout: Outline = {
      ...outline,
      steps: [...outline.steps, { id: 'scan', kind: 'join', layout: 'poll' }],
    };
    const result = validateOutline(wrongLayout);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.code === ErrorCodes.E_LAYOUT_MISMATCH)).toBe(true);
  });

  it('rejects missing interaction references', () => {
    const result = validateOutline({
      ...outline,
      steps: [{ id: 'missing', kind: 'interaction', interactionId: 'does-not-exist' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ code: ErrorCodes.E_UNKNOWN_REFERENCE }));
  });

  it('rejects duplicate step ids', () => {
    const result = validateOutline({
      ...outline,
      steps: [outline.steps[0], { id: 'welcome', kind: 'break', title: 'Pause' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ code: ErrorCodes.E_DUPLICATE_ID }));
  });

  it('strips tutor notes from projected steps', () => {
    const projected = projectOutlineSteps(outline);
    expect(projected[0]).not.toHaveProperty('tutorNotes');
    expect(JSON.stringify(projected)).not.toContain('Ask what happened');
  });

  it('keeps kind-specific fields on LearnerOutlineStep (distributive omit)', () => {
    const title = projectOutlineStep(outline.steps[0]!);
    // Type-level: title steps retain title; a collapsed Omit would only have id/kind.
    const check: Extract<LearnerOutlineStep, { kind: 'title' }> = title as Extract<
      LearnerOutlineStep,
      { kind: 'title' }
    >;
    expect(check.kind).toBe('title');
    expect(check.title).toBe('Les voyages');
    // @ts-expect-error tutorNotes must not remain on the learner projection type
    const _notes: never | undefined = (check as { tutorNotes?: string }).tutorNotes;
    void _notes;
  });

  it('accepts an outline still carrying the withdrawn "kicker" and drops it', () => {
    const stored = {
      ...outline,
      steps: [{ ...outline.steps[0], kicker: 'French B1' }, ...outline.steps.slice(1)],
    };
    const result = validateOutline(stored);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline.steps[0]).not.toHaveProperty('kicker');
    expect(JSON.stringify(result.outline)).not.toContain('kicker');
  });

  it('rejects arbitrary layout and styling properties', () => {
    const result = validateOutline({
      ...outline,
      steps: [{ id: 'styled', kind: 'title', title: 'No', css: 'position: absolute' }],
    });
    expect(result.ok).toBe(false);
  });

  it('accepts timer placement and persist, defaulting when omitted', () => {
    const withTimer: Outline = {
      ...outline,
      steps: [
        ...outline.steps,
        {
          id: 'think',
          kind: 'timer',
          title: 'Think',
          seconds: 60,
          placement: 'corner',
          persist: false,
        },
      ],
    };
    const result = validateOutline(withTimer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const step = result.outline.steps.find((row) => row.id === 'think');
    expect(step).toMatchObject({ kind: 'timer', placement: 'corner', persist: false, seconds: 60 });
  });

  it('rejects an unknown timer placement', () => {
    const result = validateOutline({
      ...outline,
      steps: [{ id: 'think', kind: 'timer', seconds: 30, placement: 'overlay' }],
    });
    expect(result.ok).toBe(false);
  });

  it('accepts homework and recap asides that never become steps', () => {
    const withAsides: Outline = {
      ...outline,
      homework: {
        title: 'Tonight',
        items: ['Write six sentences in the passé composé.'],
      },
      recap: {
        title: 'What we covered',
        body: 'Avoir with rater. Ask for the next train.',
      },
    };
    const result = validateOutline(withAsides);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline.homework).toEqual(withAsides.homework);
    expect(result.outline.recap).toEqual(withAsides.recap);
    expect(result.outline.steps.some((step) => step.kind === 'timer' && 'homework' in step)).toBe(
      false,
    );
    expect(result.session.interactions.map((row) => row.id)).toEqual(
      outline.interactions.map((row) => row.id),
    );
  });

  it('rejects an empty homework aside', () => {
    const result = validateOutline({
      ...outline,
      homework: { title: 'Nothing here' },
    });
    expect(result.ok).toBe(false);
  });

  it('accepts typed homework tasks and rejects a quiz with no interaction', () => {
    const withTasks: Outline = {
      ...outline,
      homework: {
        title: 'Tonight',
        tasks: [
          { id: 'read-pass', kind: 'reading', body: 'Read the six sentences from class.' },
          { id: 'write-pass', kind: 'writing', prompt: 'Write six sentences in the passé composé.' },
          { id: 'check-pass', kind: 'quiz', interactionId: 'past-tense' },
        ],
      },
    };
    const ok = validateOutline(withTasks);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.outline.homework?.tasks).toHaveLength(3);

    const missing = validateOutline({
      ...outline,
      homework: { tasks: [{ id: 'gone', kind: 'quiz', interactionId: 'no-such' }] },
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors.some((error) => error.code === ErrorCodes.E_UNKNOWN_REFERENCE)).toBe(true);
  });

  it('rejects homework quizzes that use a live-only interaction type', () => {
    const result = validateOutline({
      ...outline,
      interactions: [
        ...outline.interactions,
        { id: 'ask-me', type: 'qna', prompt: 'Any questions?' },
      ],
      homework: { tasks: [{ id: 'bad-quiz', kind: 'quiz', interactionId: 'ask-me' }] },
    });
    expect(result.ok).toBe(false);
  });

  it('round-trips homework, recap, and timer placement through YAML', () => {
    const result = parseOutline(
      `
version: 1
meta:
  title: Aside check
steps:
  - id: welcome
    kind: title
    title: Hello
  - id: think
    kind: timer
    seconds: 90
    placement: corner
    persist: true
homework:
  title: Tonight
  items:
    - Write six sentences
recap:
  body: We practised avoir.
interactions:
  - id: past-tense
    type: choice
    prompt: Choose.
    options:
      - id: a
        label: A
      - id: b
        label: B
`,
      'yaml',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline.homework).toEqual({ title: 'Tonight', items: ['Write six sentences'] });
    expect(result.outline.recap).toEqual({ body: 'We practised avoir.' });
    expect(result.outline.steps[1]).toMatchObject({
      kind: 'timer',
      placement: 'corner',
      persist: true,
      seconds: 90,
    });
  });
});

describe('step union error pruning', () => {
  const base = {
    version: 1,
    meta: { title: 'Passé composé' },
    interactions: [
      {
        id: 'q1',
        type: 'choice',
        prompt: 'Nous ___ au zoo.',
        options: [
          { id: 'a', label: 'sommes allés', correct: true },
          { id: 'b', label: 'allons' },
        ],
      },
    ],
  };
  const withStep = (step: unknown) => validateOutline({ ...base, steps: [step] });

  it('names the unknown kind once instead of every branch it is not', () => {
    const result = withStep({ id: 's1', kind: 'exercise', prompt: 'Nous ___ au zoo.' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The whole point: one error, not one per branch of the 13-way union.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: ErrorCodes.E_UNKNOWN_KIND,
      path: '/steps/0/kind',
    });
    for (const kind of OUTLINE_STEP_KINDS) expect(result.errors[0].message).toContain(kind);
  });

  it('reports a missing kind as unknown rather than as thirteen missing fields', () => {
    const result = withStep({ id: 's1', title: 'Les animaux' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: ErrorCodes.E_UNKNOWN_KIND,
      path: '/steps/0/kind',
    });
  });

  it.each([
    ['a required field of the authored kind', { id: 'tm', kind: 'term', term: 'rater le train' }, '/steps/0/meaning'],
    ['a field the authored kind may not carry', { id: 'j', kind: 'join', title: 'Scan' }, '/steps/0/title'],
    ['a bad enum on the authored kind', { id: 'x', kind: 'timer', seconds: 30, placement: 'overlay' }, '/steps/0/placement'],
    ['stray css on a freeform kind', { id: 's', kind: 'title', title: 'Non', css: 'position:absolute' }, '/steps/0/css'],
    ['a missing interaction reference', { id: 'i', kind: 'interaction' }, '/steps/0/interactionId'],
  ])('reports only %s', (_label, step, path) => {
    const result = withStep(step);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: ErrorCodes.E_SCHEMA, path });
  });

  it('keeps errors from inside a freeform element, which sit under an allowed field', () => {
    const result = withStep({
      id: 's',
      kind: 'title',
      title: 'Le zoo',
      elements: [{ id: 'e1', type: 'iframe', url: 'http://insecure.test', title: 'Zoo', box: { x: 0, y: 0, w: 50, h: 50 } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.path.startsWith('/steps/0/elements/0'))).toBe(true);
  });

  it('leaves errors outside /steps untouched', () => {
    const result = validateOutline({ ...base, meta: {}, steps: [{ id: 't', kind: 'title', title: 'Le zoo' }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.path.startsWith('/meta'))).toBe(true);
  });

  it('prunes each bad step independently', () => {
    const result = validateOutline({
      ...base,
      steps: [
        { id: 'a', kind: 'exercise' },
        { id: 'b', kind: 'term', term: 'le train' },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({ code: ErrorCodes.E_UNKNOWN_KIND, path: '/steps/0/kind' });
    expect(result.errors[1]).toMatchObject({ code: ErrorCodes.E_SCHEMA, path: '/steps/1/meaning' });
  });
});


it('validates a blank deck with no questions through the file and session contracts', () => {
  const result = validateOutline({ version: 1, meta: { title: 'Untitled' }, steps: [{ id: 'slide-1', kind: 'blank', elements: [] }], interactions: [] });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.session.interactions).toEqual([]);
});
