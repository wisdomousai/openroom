/**
 * Named media frame shapes — closed enum, same vocabulary as
 * `OutlineMediaAspect` in `@openroom/schema`.
 *
 * Orientation is derived from the ratio rather than authored separately:
 * 16:9 and 4:3 are landscape, 9:16 portrait, 1:1 square.
 */

export type MediaAspect = '16:9' | '9:16' | '4:3' | '1:1';

export const MEDIA_ASPECTS = ['16:9', '9:16', '4:3', '1:1'] as const satisfies readonly MediaAspect[];

export type MediaOrientation = 'landscape' | 'portrait' | 'square';

/** Plain words for the picker: orientation first, then the ratio. */
export const ASPECT_WORDS: Record<MediaAspect, string> = {
  '16:9': 'Landscape · 16:9',
  '9:16': 'Portrait · 9:16',
  '4:3': 'Classic · 4:3',
  '1:1': 'Square · 1:1',
};

export function orientationOf(aspect: MediaAspect): MediaOrientation {
  if (aspect === '9:16') return 'portrait';
  if (aspect === '1:1') return 'square';
  return 'landscape';
}

/** Class-name token: `16:9` → `16-9`. */
export function aspectClassToken(aspect: MediaAspect): string {
  return aspect.replace(':', '-');
}

/** CSS `aspect-ratio` value: `16:9` → `16 / 9`. */
export function aspectCssRatio(aspect: MediaAspect): string {
  return aspect.replace(':', ' / ');
}

function isMediaAspect(value: string | undefined): value is MediaAspect {
  return value === '16:9' || value === '9:16' || value === '4:3' || value === '1:1';
}

/**
 * The frame shape a media block is drawn in.
 *
 * Authored `aspect` wins. Otherwise a video gets 16:9, or 9:16 when the URL is
 * a YouTube Short. Images without an authored aspect return `undefined` so the
 * skin can fill the region with object-fit (focal crop) as before.
 */
export function resolveMediaAspect(media: {
  type: string;
  url?: string;
  aspect?: string;
}): MediaAspect | undefined {
  if (isMediaAspect(media.aspect)) return media.aspect;
  if (media.type !== 'video') return undefined;
  if (media.url) {
    try {
      const path = new URL(media.url).pathname.toLowerCase();
      if (path.includes('/shorts/')) return '9:16';
    } catch {
      // Not a parseable URL — fall through to the video default.
    }
  }
  return '16:9';
}
