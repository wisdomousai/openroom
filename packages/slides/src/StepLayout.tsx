/** One slide structure and saved design for editor, projector, Desktop and previews. */

import { fillTheGapsPromptText, seededShuffle, type ResolvedSlideDesign } from '@openroom/schema';
import type { ReactNode } from 'react';
import { SlideSurface } from './SlideSurface';

import { orientationOf, resolveMediaAspect } from './aspect';
import { effectiveLayout, type SlideLayout } from './layout';
import { SpanText, TokenSpanWords } from './span-text';
import { makeParts, type PartOptions } from './parts';
import { expandTimerText } from './timer-text';
import { resolveTimerStyle, LiveTimer, type TimerStyle } from './timer';
import { elementsLayer, pictureNode, pictureRootProps, stepPictureOf } from './picture';
import { pixabayCredit } from './pixabay';
import { QrCode } from './qr';
import type { SlideClock } from './timer-clock';
import type {
  SlideJoin,
  SlideOption,
  SlideSpanStyle,
  SlideStep,
} from './slide-types';

// Public slide-shape types and timer visuals moved to their own modules; the
// package entry (`index.ts`) keeps importing them from here.
export type {
  SlideCard,
  SlideSpanStyle,
  SlideElement,
  SlideElementBox,
  SlideJoin,
  SlideMedia,
  SlideOption,
  SlideStep,
  SlideStepContent,
} from './slide-types';
export { ClockPill, resolveTimerStyle, type TimerStyle } from './timer';
/** Placeholder so the author sees the finished slide before a session exists. */
const SAMPLE_JOIN: SlideJoin = { url: 'https://join.openroom.app/', code: 'ABCD1234' };
export interface StepLayoutProps extends PartOptions {
  step: SlideStep;
  design?: ResolvedSlideDesign;
  fit?: boolean;
  /** Live annotations belong to the slide's frame on every display. */
  overlay?: ReactNode;
  /**
   * Options of the step's interaction, in authored order. Needed only when the
   * surface draws interaction steps itself.
   */
  options?: readonly SlideOption[];
  /** The interaction's own prompt, used as the heading when the step overrides none. */
  prompt?: string;
  /**
   * Styled spans over `prompt`. Ignored for a fill-the-gaps interaction, whose
   * drawn prompt is expanded from `{{id}}` placeholders and so is not the
   * string the spans describe.
   */
  promptSpans?: readonly SlideSpanStyle[];
  /**
   * A fill-the-gaps prompt's one style: the family its whole drawn prompt (and
   * word bank) renders in. Per-character spans cannot describe an expanded
   * prompt, so the font travels as a single token instead.
   */
  promptFont?: 'default' | 'display' | 'serif' | 'mono';
  /**
   * A fill-the-gaps interaction's gaps, in authored order. Only the answers matter here:
   * a gap that carries them is drawn filled (the interaction is revealed), one
   * that does not is drawn as a blank.
   */
  gaps?: readonly { id: string; answers?: readonly string[] }[];
  /** Shared word-bank strip under a fill-the-gaps prompt (`display: bank`). */
  bankWords?: readonly string[];
  bankSeed?: string;
  /**
   * Draw `interaction` steps as prompt + options. The projector leaves this off:
   * a live question is drawn by the aggregate surface, not by this skeleton, and
   * returning `null` there is what routes it. The deck editor canvas turns it on,
   * because an author needs to see the question as a slide.
   */
  renderInteraction?: boolean;
  /** Rendered inside a part — a reveal-group number. Never supplied by the stage. */
  partDecoration?: (key: string) => ReactNode;
  /**
   * deck-editor-only chrome after the last option (an "Add option" row). The projector
   * and Present never pass this — a live question is not authored on the wall.
   */
  optionsFooter?: ReactNode;
  /**
   * @deprecated The classroom clock never auto-starts. Pass `clock` from
   * session state instead. Kept so existing call sites compile; it is ignored.
   */
  runTimer?: boolean;
  /**
   * Live classroom clock. When omitted, a timer step shows the authored
   * duration, stopped. Never starts itself.
   */
  clock?: SlideClock;
  /**
   * Wrap each word of the step's own text in a `data-token` span, numbered from
   * zero within its part. That is what the live console's circle tool clicks
   * and what tutor ink is then drawn around. Off everywhere else: the deck editor edits
   * these elements in place, and a caret does not want spans under it.
   */
  tokens?: boolean;
  /**
   * Live session join URL + code. A `join` step encodes this QR. The deck editor and Present
   * omit it and get a sample so the slide still looks like itself.
   */
  join?: SlideJoin;
}

// formatStepSeconds lives in timer-text.ts (shared with token expansion).
export { formatStepSeconds } from './timer-text';
/**
 * The root class of a step: the shared `outline-step`, the kind modifier the
 * projector already had, and the resolved layout.
 *
 * The layout modifier is on *every* step, authored or not — `effectiveLayout`
 * always resolves to something — which is what lets each skin state a
 * composition per layout instead of per kind.
 */
function rootClass(modifier: string | null, layout: SlideLayout, hasPicture = false): string {
  const names = ['outline-step'];
  if (modifier !== null) names.push(`outline-step--${modifier}`);
  names.push(`outline-step--layout-${layout}`);
  if (hasPicture) names.push('outline-step--has-picture');
  return names.join(' ');
}
/**
 * A region wrapper, or nothing at all.
 *
 * Two-column and overlay layouts need the step's blocks grouped into a
 * heading side and a supporting side — a grid needs grid children. Layouts
 * that stack (title, text, grid, poll, timer) need no such grouping, and adding
 * a `<div>` there would change the DOM the projector has always drawn. So the
 * wrapper appears only when the layout composes with it: `when === false`
 * returns the children untouched, byte for byte the previous markup.
 *
 * Regions never carry `data-part`. They group parts; they are not parts, so
 * `partKeysForStep` still matches the rendered parts exactly.
 */
function region(name: 'lede' | 'support', when: boolean, children: ReactNode): ReactNode {
  if (!when) return children;
  return <div className={`outline-step__region outline-step__region--${name}`}>{children}</div>;
}
export function StepLayout(props: StepLayoutProps): ReactNode {
  const content = StepContent(props);
  return content === null ? null : <SlideSurface design={props.design} fit={props.fit} overlay={props.overlay}>{content}</SlideSurface>;
}

function StepContent(props: StepLayoutProps): ReactNode {
  const {
    step,
    options,
    prompt,
    gaps,
    bankWords,
    bankSeed,
    promptSpans,
    promptFont,
    renderInteraction = false,
    partDecoration,
    optionsFooter,
    clock,
    tokens = false,
    join,
  } = props;
  const part = makeParts(props);
  const decorate = (key: string): ReactNode => partDecoration?.(key) ?? null;
  /**
   * The step's text: per word when the surface asks for circle-able tokens,
   * styled when the slot carries spans. Both at once nests spans inside tokens.
   */
  const words = (text: string, spans?: readonly SlideSpanStyle[] | null): ReactNode => {
    if (tokens) return <TokenSpanWords text={text} spans={spans ?? undefined} />;
    return spans === undefined || spans === null ? text : <SpanText spans={spans} />;
  };

  /** `null` when the play-through has not reached this part yet. */
  const show = (key: string): boolean => !part.hidden(key);
  const hasText = (text: string | undefined): text is string => text !== undefined && (text !== '' || !!props.editable);

  const layout = effectiveLayout(step);
  /** Layouts drawn as two columns: the blocks have to be grouped to be placed. */
  const split = layout === 'split';
  const picture = stepPictureOf(step);
  const hasPicture = picture !== undefined;
  const pictureProps = pictureRootProps(picture, layout);
  const extras = elementsLayer(step, show, part, decorate);
  const picturePart = (): ReactNode => {
    if (picture === undefined || !show('image')) return null;
    return (
      <>
        {decorate('image')}
        {pictureNode(picture, part.hostAttrs('image'))}
        {picture.caption && pixabayCredit(picture) === null ? (
          <p className="outline-step__caption" data-overflow-target="caption" data-overflow-part="image">{picture.caption}</p>
        ) : null}
      </>
    );
  };

  switch (step.kind) {
    case 'title':
      return (
        <section className={rootClass('title', layout, hasPicture)} {...pictureProps}>
          {region(
            'lede',
            split,
            <>
              {show('header') ? (
                <h1 {...part.attrs('header')}>
                  {decorate('header')}
                  {words(step.title, step.titleSpans)}
                </h1>
              ) : null}
              {hasText(step.body) && show('body') && (hasPicture || !split) ? (
                <p className="outline-step__lead" {...part.attrs('body')}>
                  {decorate('body')}
                  {words(step.body, step.bodySpans)}
                </p>
              ) : null}
              {split ? null : picturePart()}
            </>,
          )}
          {region(
            'support',
            split,
            !split
              ? null
              : hasPicture
                ? picturePart()
                : hasText(step.body) && show('body') ? (
                    <p className="outline-step__lead" {...part.attrs('body')}>
                      {decorate('body')}
                      {words(step.body, step.bodySpans)}
                    </p>
                  ) : null,
          )}
          {extras}
        </section>
      );

    case 'statement':
      return (
        <section className={rootClass('statement', layout, hasPicture)} {...pictureProps}>
          {region(
            'lede',
            split,
            <>
              {hasText(step.stat) && show('stat') ? (
                <p className="outline-step__stat" {...part.attrs('stat')}>
                  {decorate('stat')}
                  {words(step.stat, step.statSpans)}
                </p>
              ) : null}
              {hasText(step.title) && show('header') ? (
                <h1 {...part.attrs('header')}>
                  {decorate('header')}
                  {words(step.title, step.titleSpans)}
                </h1>
              ) : null}
              {show('body') && (hasPicture || !split) ? (
                <p className="outline-step__lead" {...part.attrs('body')}>
                  {decorate('body')}
                  {words(step.body, step.bodySpans)}
                </p>
              ) : null}
              {split ? null : picturePart()}
            </>,
          )}
          {region(
            'support',
            split,
            !split
              ? null
              : hasPicture
                ? picturePart()
                : show('body') ? (
                    <p className="outline-step__lead" {...part.attrs('body')}>
                      {decorate('body')}
                      {words(step.body, step.bodySpans)}
                    </p>
                  ) : null,
          )}
          {extras}
        </section>
      );

    case 'cards':
      return (
        <section className={rootClass(null, layout, hasPicture)} {...pictureProps}>
          {region(
            'lede',
            split,
            <>
              {show('header') ? (
                <h1 {...part.attrs('header')}>
                  {decorate('header')}
                  {words(step.title, step.titleSpans)}
                </h1>
              ) : null}
              {picturePart()}
            </>,
          )}
          {region('support', split, <div className="outline-step__cards">
            {step.items.map((item, index) =>
              show(`cell-${String(index)}`) ? (
                <article
                  key={`${item.label ?? 'card'}-${String(index)}`}
                  {...part.hostAttrs(`cell-${String(index)}`)}
                >
                  {decorate(`cell-${String(index)}`)}
                  {item.label ? <h2>{item.label}</h2> : null}
                  {/* The card's text is the part's value; its label is not, so
                      the caret goes on the paragraph rather than the card. */}
                  <p {...part.editAttrs(`cell-${String(index)}`)}>{words(item.text, item.textSpans)}</p>
                </article>
              ) : null,
            )}
          </div>)}
        </section>
      );

    case 'steps':
      return (
        <section className={rootClass(null, layout, hasPicture)} {...pictureProps}>
          {region(
            'lede',
            split,
            <>
              {show('header') ? (
                <h1 {...part.attrs('header')}>
                  {decorate('header')}
                  {words(step.title, step.titleSpans)}
                </h1>
              ) : null}
              {picturePart()}
            </>,
          )}
          {region('support', split, <ol className="outline-step__sequence">
            {step.items.map((item, index) =>
              show(`cell-${String(index)}`) ? (
                <li key={`${String(index)}-${item}`} {...part.hostAttrs(`cell-${String(index)}`)}>
                  {decorate(`cell-${String(index)}`)}
                  <span>{index + 1}</span>
                  {/* The step number is drawn, not authored — keep it out of the caret. */}
                  <p {...part.editAttrs(`cell-${String(index)}`)}>{words(item, step.itemsSpans?.[index])}</p>
                </li>
              ) : null,
            )}
          </ol>)}
        </section>
      );

    case 'term':
      return (
        <section className={rootClass('term', layout, hasPicture)} {...pictureProps}>
          {region(
            'lede',
            split,
            <>
              {show('header') ? (
                <p className="outline-step__term" {...part.attrs('header')}>
                  {decorate('header')}
                  {words(step.term, step.termSpans)}
                </p>
              ) : null}
              {show('body') ? (
                <p className="outline-step__meaning" {...part.attrs('body')}>
                  {decorate('body')}
                  {words(step.meaning, step.meaningSpans)}
                </p>
              ) : null}
              {hasText(step.example) && show('cell-0') && (hasPicture || !split) ? (
                <blockquote {...part.attrs('cell-0')}>
                  {decorate('cell-0')}
                  {words(step.example, step.exampleSpans)}
                </blockquote>
              ) : null}
              {split ? null : picturePart()}
            </>,
          )}
          {region(
            'support',
            split,
            !split
              ? null
              : hasPicture
                ? picturePart()
                : hasText(step.example) && show('cell-0') ? (
                    <blockquote {...part.attrs('cell-0')}>
                      {decorate('cell-0')}
                      {words(step.example, step.exampleSpans)}
                    </blockquote>
                  ) : null,
          )}
        </section>
      );

    case 'activity': {
      // `activity` is the kind's own two-column arrangement — what the learners
      // do on the left, what has to be on the table on the right — so it groups
      // exactly like `split` does.
      const columns = split || layout === 'activity';
      const picture = step.media;
      // Materials are things the learners need in front of them, not steps they
      // perform — a separate block, and one reveal part. It normally has the
      // second region to itself; when the activity carries a picture, the
      // picture takes that region and the list sits under the instructions.
      const materials =
        step.materials !== undefined && step.materials.length > 0 && show('materials') ? (
          <div className="outline-step__materials" {...part.hostAttrs('materials')}>
            {decorate('materials')}
            <p className="outline-step__meta">Materials</p>
            <ul className="outline-step__bullets">
              {/* One caret per line. `material-N` is an *edit target*, not a
                  part: it carries no `data-part`, so the rendered parts still
                  match `partKeysForStep` exactly, and clicking a line still
                  selects the one `materials` part it belongs to. */}
              {step.materials.map((item, index) => (
                <li key={`${String(index)}-${item}`} {...part.editAttrs(`material-${String(index)}`)}>
                  {words(item, step.materialsSpans?.[index])}
                </li>
              ))}
            </ul>
          </div>
        ) : null;
      return (
        <section className={rootClass(null, layout, picture !== undefined)} {...pictureProps}>
          {region(
            'lede',
            columns,
            <>
              {show('header') ? (
                <h1 {...part.attrs('header')}>
                  {decorate('header')}
                  {words(step.title, step.titleSpans)}
                </h1>
              ) : null}
              {step.durationSec ? (
                <p className="outline-step__meta">About {Math.ceil(step.durationSec / 60)} min</p>
              ) : null}
              <ul className="outline-step__bullets">
                {step.instructions.map((item, index) =>
                  show(`cell-${String(index)}`) ? (
                    <li key={`${String(index)}-${item}`} {...part.attrs(`cell-${String(index)}`)}>
                      {decorate(`cell-${String(index)}`)}
                      {words(item, step.instructionsSpans?.[index])}
                    </li>
                  ) : null,
                )}
              </ul>
              {picture === undefined ? null : materials}
            </>,
          )}
          {region(
            'support',
            columns,
            picture === undefined ? (
              materials
            ) : show('image') ? (
              <>
                {decorate('image')}
                {pictureNode(picture, part.hostAttrs('image'))}
                {picture.caption && pixabayCredit(picture) === null ? (
                  <p className="outline-step__caption">{picture.caption}</p>
                ) : null}
              </>
            ) : null,
          )}
        </section>
      );
    }

    case 'timer': {
      // Title/body may carry {timer-seconds} / {timer-minutes} / {timer}; expand
      // from the configured duration so the slide never hard-codes a length that
      // drifts from the clock. The plan file keeps the tokens.
      const titleText =
        step.title === undefined ? undefined : expandTimerText(step.title, step.seconds);
      const bodyText =
        step.body === undefined ? undefined : expandTimerText(step.body, step.seconds);
      return (
        <section className={rootClass('timer', layout, false)} data-timer-style={resolveTimerStyle(step.style)}>
          {clock?.placement === 'corner' ? null : (
            <LiveTimer key={step.id} seconds={step.seconds} clock={clock} style={step.style} />
          )}
          {hasText(titleText) && show('header') ? (
            <h1 {...part.attrs('header')}>
              {decorate('header')}
              {words(titleText)}
            </h1>
          ) : null}
          {hasText(bodyText) && show('body') ? (
            <p className="outline-step__lead" {...part.attrs('body')}>
              {decorate('body')}
              {words(bodyText)}
            </p>
          ) : null}
        </section>
      );
    }

    case 'media': {
      // `media` is full-bleed with the heading as a caption bar; `split` is
      // picture beside heading; `text` stacks title above the picture (best for
      // portrait video). Column regions only when the layout places two sides.
      const columns = split || layout === 'media';
      const mediaAspect = resolveMediaAspect(step.media);
      const orientation = mediaAspect === undefined ? undefined : orientationOf(mediaAspect);
      return (
        <section
          className={rootClass('media', layout, true)}
          data-media-orientation={orientation}
          data-media-aspect={mediaAspect}
          {...pictureProps}
        >
          {region(
            'lede',
            columns,
            hasText(step.title) && show('header') ? (
              <h1 {...part.attrs('header')}>
                {decorate('header')}
                {words(step.title, step.titleSpans)}
              </h1>
            ) : null,
          )}
          {region(
            'support',
            columns,
            <>
              {show('image') ? decorate('image') : null}
              {show('image') ? pictureNode(step.media, part.hostAttrs('image')) : null}
              {step.media.caption && pixabayCredit(step.media) === null ? (
                <p className="outline-step__caption" data-overflow-target="caption" data-overflow-part="image">{step.media.caption}</p>
              ) : null}
            </>,
          )}
          {extras}
        </section>
      );
    }

    case 'debrief':
      return (
        <section className={rootClass(null, layout, hasPicture)} {...pictureProps}>
          {region(
            'lede',
            split,
            <>
              {show('header') ? (
                <h1 {...part.attrs('header')}>
                  {decorate('header')}
                  {words(step.title, step.titleSpans)}
                </h1>
              ) : null}
              {picturePart()}
            </>,
          )}
          {region(
            'support',
            split,
            <ul className="outline-step__bullets outline-step__bullets--questions">
              {step.prompts.map((item, index) =>
                show(`cell-${String(index)}`) ? (
                  <li key={`${String(index)}-${item}`} {...part.attrs(`cell-${String(index)}`)}>
                    {decorate(`cell-${String(index)}`)}
                    {words(item, step.promptsSpans?.[index])}
                  </li>
                ) : null,
              )}
            </ul>,
          )}
        </section>
      );

    case 'break':
      return (
        <section className={rootClass('break', layout, false)}>
          <p className="outline-step__meta">{step.minutes ? `${String(step.minutes)} minute break` : 'Pause'}</p>
          {show('header') ? (
            <h1 {...part.attrs('header')}>
              {decorate('header')}
              {words(step.title, step.titleSpans)}
            </h1>
          ) : null}
          {hasText(step.body) && show('body') ? (
            <p className="outline-step__lead" {...part.attrs('body')}>
              {decorate('body')}
              {words(step.body, step.bodySpans)}
            </p>
          ) : null}
        </section>
      );

    case 'join': {
      const live = join ?? SAMPLE_JOIN;
      const sample = join === undefined;
      return (
        <section className={rootClass('join', layout, false)} data-sample={sample ? 'true' : undefined}>
          <div className="outline-step__qr">
            <QrCode
              text={live.url}
              title={sample ? 'Sample QR code' : `QR code to join session ${live.code}`}
            />
          </div>
          <p className="outline-step__join-code">{live.code}</p>
        </section>
      );
    }

    case 'blank':
      // A freeform canvas: the optional heading is the only wired region, the
      // rest of the slide belongs to the author's boxed elements.
      return (
        <section className={rootClass('blank', layout)}>
          {hasText(step.title) && show('header') ? (
            <h1 {...part.attrs('header')}>
              {decorate('header')}
              {words(step.title, step.titleSpans)}
            </h1>
          ) : null}
          {extras}
        </section>
      );

    case 'interaction': {
      if (!renderInteraction) return null;
      // A fill-the-gaps prompt carries `{{id}}` placeholders. Nobody should ever read
      // those on a slide: the fallback heading is drawn with blanks, filled in
      // only once the interaction's gaps carry their answers (reveal).
      const heading = step.title ?? fillTheGapsPromptText(prompt ?? '', gaps);
      // The step's own override styles with the step's spans; the interaction's
      // prompt styles with the interaction's. A fill-the-gaps heading is
      // expanded from placeholders, so no span list describes what is drawn.
      const headingSpans =
        step.title !== undefined
          ? step.titleSpans
          : gaps === undefined || gaps.length === 0
            ? promptSpans
            : undefined;
      // A fill-the-gaps prompt styles as a whole: one family over the expanded
      // heading and its word bank. Never over a step's own title override.
      const promptFontStyle =
        promptFont !== undefined && promptFont !== 'default' && step.title === undefined
          ? { fontFamily: `var(--font-${promptFont})` }
          : undefined;
      return (
        <section className={rootClass('question', layout, hasPicture)} {...pictureProps}>
          {region(
            'lede',
            split,
            <>
              {show('header') ? (
                <h1 {...part.attrs('header')} style={promptFontStyle}>
                  {decorate('header')}
                  {words(heading, headingSpans)}
                </h1>
              ) : null}
              {bankWords !== undefined && bankWords.length > 0 ? (
                <ul className="outline-step__word-bank" data-overflow-target="word-bank" data-overflow-part="header" aria-label="Word bank" style={promptFontStyle}>
                  {seededShuffle(bankWords, bankSeed ?? prompt ?? '').map((word) => (
                    <li key={word}>{words(word)}</li>
                  ))}
                </ul>
              ) : null}
              {hasText(step.body) && show('body') ? (
                <p className="outline-step__lead" {...part.attrs('body')}>
                  {decorate('body')}
                  {words(step.body, step.bodySpans)}
                </p>
              ) : null}
              {picturePart()}
            </>,
          )}
          {region(
            'support',
            split,
            <ul className="outline-step__options">
              {(options ?? []).map((option, index) =>
                show(`option-${String(index)}`) ? (
                  <li key={option.id} {...part.attrs(`option-${String(index)}`)}>
                    {decorate(`option-${String(index)}`)}
                    {words(option.label, option.labelSpans)}
                  </li>
                ) : null,
              )}
              {optionsFooter ?? null}
            </ul>,
          )}
        </section>
      );
    }
  }
}
