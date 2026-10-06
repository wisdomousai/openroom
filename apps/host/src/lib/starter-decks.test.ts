import { describe, expect, it } from 'vitest';
import { validateOutline, WORKSPACE_EXPERIENCES } from '@openroom/schema';
import { starterDeck } from './starter-decks';

describe('workspace sample decks', () => {
  it.each(WORKSPACE_EXPERIENCES)('%s can be saved and each copy can be edited independently', (experience) => {
    const first = starterDeck(experience);
    expect(validateOutline(first)).toMatchObject({ ok: true });
    first.meta.title = 'My copy';
    first.interactions[0]!.prompt = 'My question';
    const next = starterDeck(experience);
    expect(next.meta.title).not.toBe('My copy');
    expect(next.interactions[0]!.prompt).not.toBe('My question');
  });
});
