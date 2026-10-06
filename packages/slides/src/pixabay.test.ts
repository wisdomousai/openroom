import { describe, expect, it } from 'vitest';

import { isPixabayUrl, pixabayCredit } from './pixabay';

describe('pixabayCredit', () => {
  it('is only for hosted Pixabay pictures', () => {
    expect(isPixabayUrl('https://cdn.pixabay.com/photo/a.jpg')).toBe(true);
    expect(isPixabayUrl('https://pixabay.com/get/a.jpg')).toBe(true);
    expect(isPixabayUrl('https://example.org/a.jpg')).toBe(false);
    expect(pixabayCredit({ url: 'https://example.test/a.jpg', caption: 'Paris' })).toBeNull();
  });

  it('uses the stored credit line', () => {
    expect(
      pixabayCredit({
        url: 'https://cdn.pixabay.com/photo/a.jpg',
        caption: 'Photo by ralf82 on Pixabay',
      }),
    ).toBe('Photo by ralf82 on Pixabay');
    expect(pixabayCredit({ url: 'https://cdn.pixabay.com/photo/a.jpg' })).toBe('Pixabay');
  });
});
