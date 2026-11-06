// @vitest-environment happy-dom
/**
 * The canvas placeholder on a material line ("Material 1") shows only while
 * that line is empty. A filled line read as empty prints the placeholder in
 * front of its text, widens it, and makes the editor wrap differently from
 * the wall.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseOutline, type Outline } from '@openroom/schema';
import { stringify } from 'yaml';

import { DeckEditor } from './DeckEditor';
import { EditorServicesProvider } from '../services';
import { memoryEditorServices } from '../testing';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

describe('slide canvas material lines', () => {
  it('marks only the empty material line as empty', async () => {
    const outline: Outline = {
      version: 1,
      meta: { title: 'Materials' },
      steps: [
        {
          id: 'tower',
          kind: 'activity',
          title: 'Build the tallest tower',
          instructions: ['Form groups of four'],
          materials: ['Worksheet A', ''],
        },
      ],
      interactions: [],
    };
    const source = stringify(outline, { lineWidth: 100 });
    const validation = parseOutline(source, 'yaml');
    expect(validation.ok).toBe(true);
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <EditorServicesProvider services={memoryEditorServices()}>
          <DeckEditor
            deckId="d1"
            spaceId={null}
            source={source}
            onSourceChange={() => undefined}
            validation={validation}
            onPresentFrom={() => undefined}
          />
        </EditorServicesProvider>,
      );
    });
    // A material line is an edit target inside the `materials` part, so it is
    // found by its placeholder, not by a data-part of its own.
    const canvas = container.querySelector('.slide-canvas__frame');
    const filled = canvas?.querySelector('[data-placeholder="Material 1"]');
    const empty = canvas?.querySelector('[data-placeholder="Material 2"]');
    expect(filled?.textContent).toContain('Worksheet A');
    expect(filled?.hasAttribute('data-empty')).toBe(false);
    expect(empty?.getAttribute('data-empty')).toBe('true');
  });
});
