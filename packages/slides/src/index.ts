/**
 * `@openroom/slides` — the one step-rendering skeleton.
 *
 * Source-shipped React, like `@openroom/charts`: consumers compile it. It holds
 * structure only (elements, order, class names). Surfaces style those class
 * names: the deck editor uses `slide-canvas.css` (desk scale); stage and the participant
 * tutoring surface share `outline-step.css` (projector composition) so the
 * learner and the wall show the same slide.
 */
export { HtmlHost } from './HtmlHost';
export { InkMarks, useTokenBoxes } from './InkMarks';
export { lineBoxes, markTokens, measureTokens, spanBoxes, tokenKey, unionBox, type TokenBox, type TokenBoxes } from './ink-geometry';
export { TOKEN_SPLIT, tokenIndexAt, wordAt } from './tokens';
export { SpanText, TokenSpanWords, spanStyleOf, sliceSpans } from './span-text';
export {
  DictionaryHead,
  DictionarySection,
  DictionaryTable,
  type DictionaryTableProps,
} from './DictionaryTable';
export { MeaningCard, type MeaningCardProps } from './MeaningCard';
export {
  ClockPill,
  StepLayout,
  resolveTimerStyle,
  type SlideCard,
  type SlideMedia,
  type SlideOption,
  type SlideJoin,
  type SlideSpanStyle,
  type SlideStep,
  type SlideStepContent,
  type StepLayoutProps,
  type TimerStyle,
} from './StepLayout';
export {
  clockPhase,
  clockProgress,
  clockRemaining,
  clockWholeSeconds,
  formatClock,
  type ClockPhase,
  type SlideClock,
} from './timer-clock';
export {
  TIMER_TEXT_TOKENS,
  commitTimerText,
  expandTimerText,
  formatStepSeconds,
  hasTimerTextToken,
  type TimerTextToken,
} from './timer-text';
export {
  LAYOUTS_FOR_KIND,
  SLIDE_LAYOUTS,
  defaultLayoutForKind,
  effectiveLayout,
  layoutAllowedForKind,
  type SlideLayout,
  type SlideStepKind,
} from './layout';
export { FOCAL_POINTS, FOCAL_WORDS, focalStyle, type FocalPoint } from './focal';
export {
  ASPECT_WORDS,
  MEDIA_ASPECTS,
  aspectClassToken,
  aspectCssRatio,
  orientationOf,
  resolveMediaAspect,
  type MediaAspect,
  type MediaOrientation,
} from './aspect';
export type { PartAttrs, PartOptions } from './parts';
export { QrCode } from './qr';
export {
  isYoutubeUrl,
  youtubeEmbedUrl,
  youtubeVideoId,
} from './youtube';
export { isPixabayUrl, pixabayCredit } from './pixabay';
export { SlideSurface, slideDesignStyle } from './SlideSurface';
export { AudioPlayer, ListeningAudience, ListeningBlock } from './Listening';
