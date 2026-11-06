import type { SlidePalette } from '@openroom/schema';

/**
 * The readability overlay a new background picture starts with.
 *
 * The colour is the palette background, so the palette's text colour keeps
 * the contrast it was chosen for: dark text gets a light wash, light text on
 * a dark family (board, contrast) gets a dark one. At this opacity the
 * foreground stays at 4.5:1 or better over any picture, black or white. An
 * author can still change both; stored decks keep the overlay they carry.
 */
export const DEFAULT_OVERLAY_OPACITY = 0.8;

export function defaultImageOverlay(palette: Pick<SlidePalette, 'background'>): { color: string; opacity: number } {
  return { color: palette.background, opacity: DEFAULT_OVERLAY_OPACITY };
}
