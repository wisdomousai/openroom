import { describe, expect, it } from 'vitest';
import {
  MEDIA_ASPECTS,
  aspectClassToken,
  aspectCssRatio,
  orientationOf,
  resolveMediaAspect,
} from './aspect';

describe('resolveMediaAspect', () => {
  it('honours an authored aspect', () => {
    expect(resolveMediaAspect({ type: 'video', aspect: '4:3' })).toBe('4:3');
    expect(resolveMediaAspect({ type: 'image', aspect: '1:1' })).toBe('1:1');
  });

  it('defaults video to 16:9 and images to none', () => {
    expect(resolveMediaAspect({ type: 'video' })).toBe('16:9');
    expect(resolveMediaAspect({ type: 'image' })).toBeUndefined();
  });

  it('infers portrait from a YouTube Shorts URL', () => {
    expect(
      resolveMediaAspect({
        type: 'video',
        url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      }),
    ).toBe('9:16');
  });

  it('does not override an authored aspect with Shorts inference', () => {
    expect(
      resolveMediaAspect({
        type: 'video',
        url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
        aspect: '16:9',
      }),
    ).toBe('16:9');
  });
});

describe('orientation and tokens', () => {
  it('maps each aspect to an orientation', () => {
    expect(orientationOf('16:9')).toBe('landscape');
    expect(orientationOf('4:3')).toBe('landscape');
    expect(orientationOf('9:16')).toBe('portrait');
    expect(orientationOf('1:1')).toBe('square');
  });

  it('emits stable class and CSS tokens for every aspect', () => {
    for (const aspect of MEDIA_ASPECTS) {
      expect(aspectClassToken(aspect)).toMatch(/^\d+-\d+$/);
      expect(aspectCssRatio(aspect)).toMatch(/^\d+ \/ \d+$/);
    }
  });
});
