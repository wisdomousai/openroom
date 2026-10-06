import { partKeysForStep } from '@openroom/schema';
import type { Interaction, OutlineStep } from '@openroom/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LAYOUTS_FOR_KIND, defaultLayoutForKind, type SlideLayout, type SlideStepKind } from './layout';
import { StepLayout, type SlideOption, type SlideStep } from './StepLayout';

/**
 * One step of every kind, shaped so that every part key the kind can have is
 * present. Anything less and "the rendered parts match `partKeysForStep`" would
 * pass by not rendering much.
 */
const STEPS: Record<SlideStepKind, SlideStep> = {
  title: { id: 's', kind: 'title', title: 'Les voyages', body: 'Tell a short story.' },
  statement: { id: 's', kind: 'statement', title: 'Most trips fail here', body: 'At the gate.', stat: '78%' },
  cards: {
    id: 's',
    kind: 'cards',
    title: 'Choose a word',
    items: [{ label: 'A', text: 'gare' }, { label: 'B', text: 'quai' }, { text: 'billet' }, { text: 'horaire' }],
  },
  steps: { id: 's', kind: 'steps', title: 'How to ask', items: ['Greet', 'Ask', 'Confirm', 'Thank'] },
  term: { id: 's', kind: 'term', term: 'le quai', meaning: 'the platform', example: 'Le train part du quai 3.' },
  activity: {
    id: 's',
    kind: 'activity',
    title: 'Build the tallest tower',
    instructions: ['Form groups of four', 'Plan for two minutes', 'Build for ten'],
    materials: ['20 sticks of spaghetti', 'One metre of tape', 'One marshmallow'],
    media: { type: 'image', url: 'https://example.test/tower.jpg', alt: 'A spaghetti tower' },
    durationSec: 900,
  },
  timer: { id: 's', kind: 'timer', title: 'Think alone', body: 'No talking yet.', seconds: 300 },
  media: {
    id: 's',
    kind: 'media',
    title: 'Gare de Lyon',
    media: { type: 'image', url: 'https://example.test/gare.jpg', alt: 'A station concourse', caption: 'Paris, 1900' },
  },
  debrief: { id: 's', kind: 'debrief', title: 'What happened?', prompts: ['What worked?', 'What broke?'] },
  break: { id: 's', kind: 'break', title: 'Coffee', body: 'Back at half past.', minutes: 10 },
  join: { id: 's', kind: 'join' },
  blank: {
    id: 's',
    kind: 'blank',
    title: 'A canvas',
    elements: [
      { id: 'box', type: 'text', text: 'Free text', box: { x: 8, y: 42, w: 70, h: 22 } },
    ],
  },
  interaction: { id: 's', kind: 'interaction', interactionId: 'q1', title: 'Which platform?', body: 'Pick one.' },
};

const INTERACTIONS: Interaction[] = [
  {
    id: 'q1',
    type: 'choice',
    prompt: 'Which platform?',
    options: [
      { id: 'a', label: 'Quai 1' },
      { id: 'b', label: 'Quai 3' },
    ],
  } as Interaction,
];

const OPTIONS: SlideOption[] = [
  { id: 'a', label: 'Quai 1' },
  { id: 'b', label: 'Quai 3' },
];

const KINDS = Object.keys(STEPS) as SlideStepKind[];

function render(kind: SlideStepKind, layout?: SlideLayout): string {
  const step = layout === undefined ? STEPS[kind] : { ...STEPS[kind], layout };
  return renderToStaticMarkup(
    <StepLayout step={step} options={OPTIONS} prompt="Which platform?" renderInteraction />,
  );
}

/** The `data-part` values actually present in the markup, in document order. */
function renderedParts(html: string): string[] {
  return [...html.matchAll(/data-part="([^"]+)"/g)].map((match) => match[1] ?? '');
}

describe('the resolved layout reaches the root class', () => {
  it('names the kind default when the step authors no layout', () => {
    for (const kind of KINDS) {
      expect(render(kind)).toContain(`outline-step--layout-${defaultLayoutForKind(kind)}`);
    }
  });

  it('names the authored layout for every layout the kind may claim', () => {
    for (const kind of KINDS) {
      for (const layout of LAYOUTS_FOR_KIND[kind]) {
        const html = render(kind, layout);
        expect([kind, layout, html.includes(`outline-step--layout-${layout}`)]).toEqual([
          kind,
          layout,
          true,
        ]);
        // Exactly one layout modifier, so a skin can never see two compositions.
        expect([...html.matchAll(/outline-step--layout-/g)]).toHaveLength(1);
      }
    }
  });

  it('keeps the kind modifier the projector already had beside it', () => {
    expect(render('title')).toContain('outline-step outline-step--title outline-step--layout-title');
    expect(render('media')).toContain('outline-step outline-step--media outline-step--layout-media');
    expect(render('interaction')).toContain('outline-step--question outline-step--layout-poll');
    // Kinds the projector never modified stay unmodified.
    expect(render('cards')).toContain('class="outline-step outline-step--layout-grid"');
  });
});

describe('region wrappers', () => {
  it('groups the blocks into two regions for every split layout', () => {
    for (const kind of KINDS) {
      if (!LAYOUTS_FOR_KIND[kind].includes('split')) continue;
      const html = render(kind, 'split');
      expect([kind, html.includes('outline-step__region--lede')]).toEqual([kind, true]);
      expect([kind, html.includes('outline-step__region--support')]).toEqual([kind, true]);
    }
  });

  it('groups an activity and a full-bleed picture too', () => {
    expect(render('activity', 'activity')).toContain('outline-step__region--support');
    expect(render('media', 'media')).toContain('outline-step__region--lede');
  });

  it('adds nothing at all to the stacking layouts', () => {
    for (const kind of KINDS) {
      for (const layout of LAYOUTS_FOR_KIND[kind]) {
        if (layout === 'split') continue;
        if (kind === 'activity' && layout === 'activity') continue;
        if (kind === 'media' && layout === 'media') continue;
        expect([kind, layout, render(kind, layout).includes('outline-step__region')]).toEqual([
          kind,
          layout,
          false,
        ]);
      }
    }
  });

  it('leaves the markup byte-identical to the unwrapped rendering', () => {
    // A region groups parts; it is not one. Stripping the wrappers has to give
    // back exactly what the stacking layout draws.
    const strip = (html: string): string =>
      html
        .replace(/<div class="outline-step__region outline-step__region--(?:lede|support)">/g, '')
        .replace(/<\/div>/g, '')
        .replace(/ outline-step--layout-[a-z]+/g, '');
    expect(strip(render('term', 'split'))).toEqual(strip(render('term', 'title')));
    expect(strip(render('cards', 'split'))).toEqual(strip(render('cards', 'grid')));
    expect(strip(render('interaction', 'split'))).toEqual(strip(render('interaction', 'poll')));
  });
});

/**
 * The known bug class: a layout that quietly stopped drawing a part, or drew an
 * extra one, would desync the reveal editor from the slide. Layout changes
 * composition, never the parts.
 */
describe('parts are unchanged by layout', () => {
  it('renders exactly the part keys the schema derives, under every layout', () => {
    for (const kind of KINDS) {
      const expected = [...partKeysForStep(STEPS[kind] as unknown as OutlineStep, INTERACTIONS)].sort();
      for (const layout of LAYOUTS_FOR_KIND[kind]) {
        const parts = [...renderedParts(render(kind, layout))].sort();
        expect([kind, layout, parts]).toEqual([kind, layout, expected]);
      }
    }
  });

  it('draws them in the derived order, and records the one place it does not', () => {
    for (const kind of KINDS) {
      const expected = partKeysForStep(STEPS[kind] as unknown as OutlineStep, INTERACTIONS);
      // Pre-existing and unrelated to layout: `partKeysForStep` lists a
      // statement as header-then-stat, while the projector has always drawn the
      // number above the title. Only the *set* has to match for the reveal
      // editor to be correct; this test pins the exception so it stays a known
      // one instead of quietly spreading.
      const order = kind === 'statement' ? ['stat', 'header', 'body'] : expected;
      for (const layout of LAYOUTS_FOR_KIND[kind]) {
        expect([kind, layout, renderedParts(render(kind, layout))]).toEqual([kind, layout, order]);
      }
    }
  });

  it('lets the deck editor park an add-option row after the answers without making it a part', () => {
    const html = renderToStaticMarkup(
      <StepLayout
        step={STEPS.interaction}
        options={OPTIONS}
        prompt="Which platform?"
        renderInteraction
        optionsFooter={<li className="add">Add option</li>}
      />,
    );
    expect(html).toContain('class="add">Add option</li>');
    expect(renderedParts(html)).toEqual(['header', 'body', 'option-0', 'option-1']);
  });

  it('draws a fill-the-gaps prompt as blanks, and fills them once the gaps carry answers', () => {
    // `{{g1}}` is authoring syntax. A session must never read it off the wall.
    const step = { id: 's', kind: 'interaction' as const, interactionId: 'gap' };
    const blanked = renderToStaticMarkup(
      <StepLayout step={step} prompt="Il {{g1}} raté le train." renderInteraction />,
    );
    expect(blanked).toContain("Il ____ raté le train.");
    const revealed = renderToStaticMarkup(
      <StepLayout
        step={step}
        prompt="Il {{g1}} raté le train."
        gaps={[{ id: 'g1', answers: ['a'] }]}
        renderInteraction
      />,
    );
    expect(revealed).toContain("Il a raté le train.");
  });

  it('draws a word-bank strip when bankWords are supplied', () => {
    const html = renderToStaticMarkup(
      <StepLayout
        step={{ id: 's', kind: 'interaction', interactionId: 'gap' }}
        prompt="Il {{g1}} raté le train."
        bankWords={['ai', 'suis']}
        bankSeed="gap"
        renderInteraction
      />,
    );
    expect(html).toContain('aria-label="Word bank"');
    expect(html).toContain('ai');
    expect(html).toContain('suis');
  });
});

describe('Pixabay credit', () => {
  it('draws the credit on the picture and not as a slide caption', () => {
    const html = renderToStaticMarkup(
      <StepLayout
        step={{
          id: 's',
          kind: 'media',
          title: 'River',
          media: {
            type: 'image',
            url: 'https://cdn.pixabay.com/photo/river.jpg',
            alt: 'A river',
            caption: 'Photo by ralf82 on Pixabay',
          },
        }}
      />,
    );
    expect(html).toContain('outline-step__media-credit');
    expect(html).toContain('Photo by ralf82 on Pixabay');
    expect(html).not.toContain('outline-step__caption');
  });
});

describe('optional picture on a content slide', () => {
  it('draws the image part on a title slide and marks the root', () => {
    const html = renderToStaticMarkup(
      <StepLayout
        step={{
          id: 's',
          kind: 'title',
          title: 'Les voyages',
          body: 'Tell a short story.',
          layout: 'split',
          media: { type: 'image', url: 'https://example.test/train.jpg', alt: 'A departing train' },
        }}
      />,
    );
    expect(html).toContain('outline-step--has-picture');
    expect(html).toContain('data-part="image"');
    expect(html).toContain('A departing train');
    expect(html).toContain('outline-step--layout-split');
    expect(html).toContain('data-picture-place="right"');
  });

  it('honours an authored place and size', () => {
    const html = renderToStaticMarkup(
      <StepLayout
        step={{
          id: 's',
          kind: 'title',
          title: 'Les voyages',
          body: 'Tell a short story.',
          layout: 'split',
          media: {
            type: 'image',
            url: 'https://example.test/train.jpg',
            alt: 'A departing train',
            place: 'left',
            size: 30,
          },
        }}
      />,
    );
    expect(html).toContain('data-picture-place="left"');
    expect(html).toContain('--picture-size:30%');
  });
});

describe('join slide', () => {
  it('draws a sample QR when the session has not started', () => {
    const html = render('join');
    expect(html).toContain('outline-step--join outline-step--layout-join');
    expect(html).toContain('data-sample="true"');
    expect(html).toContain('Sample QR code');
    expect(html).toContain('ABCD1234');
  });

  it('encodes the live join URL when the session supplies one', () => {
    const html = renderToStaticMarkup(
      <StepLayout step={STEPS.join} join={{ url: 'https://join.openroom.app/?code=SESS1234', code: 'SESS1234' }} />,
    );
    expect(html).toContain('QR code to join session SESS1234');
    expect(html).toContain('SESS1234');
    expect(html).not.toContain('data-sample');
  });
});

describe('iframe element', () => {
  it('renders an external page in the restricted full-size frame', () => {
    const html = renderToStaticMarkup(
      <StepLayout
        step={{
          id: 'web',
          kind: 'blank',
          elements: [
            {
              id: 'article',
              type: 'iframe',
              url: 'https://example.test/embed',
              title: 'Example article',
              box: { x: 0, y: 0, w: 100, h: 100 },
            },
          ],
        }}
      />,
    );
    expect(html).toContain('src="https://example.test/embed"');
    expect(html).toContain('title="Example article"');
    expect(html).toContain('sandbox="allow-downloads allow-forms allow-modals');
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });
});

describe('PDF element', () => {
  it('renders a document in a restricted scrollable frame', () => {
    const html = renderToStaticMarkup(
      <StepLayout
        step={{
          id: 'handout',
          kind: 'blank',
          elements: [
            {
              id: 'document',
              type: 'pdf',
              url: 'https://example.test/handout.pdf',
              title: 'Lesson handout',
              box: { x: 0, y: 0, w: 100, h: 100 },
            },
          ],
        }}
      />,
    );
    expect(html).toContain('outline-step__element--pdf');
    expect(html).toContain('src="https://example.test/handout.pdf"');
    expect(html).toContain('scrolling="yes"');
    expect(html).toContain('sandbox="allow-downloads allow-same-origin"');
    expect(html).not.toContain('allow-scripts');
  });
});
