// @vitest-environment happy-dom
/**
 * The editor runs on nothing but its port: the deck editor and the presenter
 * mount with in-memory services and no workspace slots, and the slot-backed
 * affordances stay out of the page.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseOutline } from '@openroom/schema';
import { stringify } from 'yaml';

import { blankDeck } from './deck-document';
import { DeckEditor } from './deck-edit/DeckEditor';
import { Presenter } from './presenter/Presenter';
import { EditorServicesProvider } from './services';
import { memoryEditorServices } from './testing';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // happy-dom has no FontFaceSet; the overflow check only listens to it.
  if (!('fonts' in document)) {
    Object.defineProperty(document, 'fonts', {
      value: { addEventListener() {}, removeEventListener() {}, ready: Promise.resolve() },
    });
  }
});

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function mount(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<EditorServicesProvider services={memoryEditorServices()}>{node}</EditorServicesProvider>);
  });
  return container;
}

const outline = blankDeck('Mount check');
const source = stringify(outline, { lineWidth: 100 });

describe('editor mount', () => {
  it('mounts the deck editor without slots', async () => {
    const container = await mount(
      <DeckEditor
        deckId="d1"
        spaceId={null}
        source={source}
        onSourceChange={() => undefined}
        validation={parseOutline(source, 'yaml')}
        onPresentFrom={() => undefined}
      />,
    );
    const tabs = [...container.querySelectorAll('button')].map((button) => button.textContent);
    expect(tabs).toContain('Design');
    expect(tabs).toContain('Notes');
    // No version-history slot: no History tab.
    expect(tabs).not.toContain('History');
  });

  it('mounts the deck editor repair screen without a version history', async () => {
    const container = await mount(
      <DeckEditor
        deckId="d1"
        spaceId={null}
        source="steps: ["
        onSourceChange={() => undefined}
        validation={parseOutline('steps: [', 'yaml')}
        onPresentFrom={() => undefined}
      />,
    );
    expect(container.textContent).toContain('This outline cannot be read yet.');
    expect(container.textContent).not.toContain('History');
  });

  it('mounts the presenter without slots', async () => {
    await mount(
      <Presenter
        outline={outline}
        onStart={() => Promise.reject(new Error('No live sessions in memory.'))}
        onClose={() => undefined}
      />,
    );
    // The presenter portals into the document body, outside its container.
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
