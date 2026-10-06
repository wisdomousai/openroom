import { expect, it } from 'vitest';
import { parseSlideEmbedCode, slideEmbedCode } from '../src/index.js';

it('round trips a deck and stable slide reference without carrying authority', () => {
  const reference = { deckId: 'b450a63e-d2cb-4154-a49a-9b3f928f5645', stepId: 'slide_detail-2' };
  expect(parseSlideEmbedCode(`  ${slideEmbedCode(reference)}\n`)).toEqual(reference);
  expect(slideEmbedCode({ ...reference, stepId: 'different-slide' })).not.toBe(slideEmbedCode(reference));
  for (const code of ['', 'openroom-slide:2:deck:slide', 'openroom-slide:1:deck:slide:secret', 'openroom-slide:1:../deck:slide', 'https://example.com/slide', 'openroom-slide:1:deck:', `openroom-slide:1:${'x'.repeat(161)}:slide`]) expect(parseSlideEmbedCode(code)).toBeNull();
});
