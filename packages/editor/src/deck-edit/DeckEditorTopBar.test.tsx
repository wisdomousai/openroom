/**
 * The top bar's remaining contract: it names the folder and the deck, and it
 * repeats the draft hook’s own sentence rather than paraphrasing it.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorServicesProvider } from '../services';
import { memoryEditorServices } from '../testing';
import { DeckEditorTopBar } from './DeckEditorTopBar';
import { IDLE_STATUS, type DraftStatus } from './useDraftSave';

/*
 * The bar's links are destinations the host resolves; the in-memory services
 * render each one as a readable href. The host's own routes are checked in
 * apps/host (editor-services.test.tsx).
 */
const services = memoryEditorServices();

function render(overrides: Partial<Parameters<typeof DeckEditorTopBar>[0]> = {}): string {
  return renderToStaticMarkup(
    <EditorServicesProvider services={services}>
      <DeckEditorTopBar
        title="Summer camp — day 1"
        folderName="Workshops"
        libraryTo={{ kind: 'library', place: { spaceId: 's1', folderId: 'f1', itemId: 'd1' } }}
        shareTo={{ kind: 'spaceMembers', spaceId: 's1' }}
        status={IDLE_STATUS}
        onPresent={() => undefined}
        canPresent
        onStart={() => undefined}
        starting={false}
        canStart
        error={null}
        {...overrides}
      />
    </EditorServicesProvider>,
  );
}

describe('DeckEditorTopBar', () => {
  it('names the folder and the deck', () => {
    const html = render();
    expect(html).toContain('Workshops');
    expect(html).toContain('Summer camp — day 1');
  });

  it('takes the back arrow to the deck’s own row in the Library', () => {
    expect(render()).toContain('href="memory:library?place.spaceId=s1&amp;place.folderId=f1&amp;place.itemId=d1"');
  });

  it('offers Share only when the deck has a space', () => {
    expect(render()).toContain('href="memory:spaceMembers?spaceId=s1"');
    expect(render({ shareTo: null })).not.toContain('>Share<');
  });

  it('drops the breadcrumb for a deck at the root of its space', () => {
    expect(render({ folderName: null })).not.toContain(' /');
  });

  it('says Saved to the folder after a successful draft write', () => {
    const status: DraftStatus = {
      state: 'saved',
      savedAt: 1,
      retrying: false,
      label: 'Saved',
    };
    expect(render({ status })).toContain('Saved to Workshops');
  });

  it('repeats the draft hook’s own sentence rather than paraphrasing it', () => {
    const status: DraftStatus = {
      state: 'error',
      savedAt: null,
      retrying: true,
      label: 'Couldn’t save — retrying',
    };
    const html = render({ status });
    expect(html).toContain('Couldn’t save — retrying');
    expect(html).toContain('data-or-draft-status="error"');
  });

  it('says nothing when the draft hook has nothing to say', () => {
    expect(render()).not.toContain('data-or-draft-status');
  });

  it('shows a failed start in place', () => {
    const html = render({ error: 'Could not start this session' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not start this session');
  });

  it('disables Start while starting', () => {
    const html = render({ starting: true });
    expect(html).toContain('Starting…');
  });

  it('names the live verb Start session', () => {
    expect(render()).toContain('Start session');
  });

  it('offers Present while the plan file reads as an outline', () => {
    const html = render();
    expect(html).toContain('data-deck-present');
    expect(html).not.toContain('data-deck-present="true" disabled');
  });

  it('refuses to present an outline that cannot be read', () => {
    expect(render({ canPresent: false })).toContain('data-deck-present="true" disabled');
  });
});
