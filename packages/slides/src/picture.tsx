import { ListeningBlock } from './Listening';
import type { CSSProperties, ReactNode } from 'react';

import {
  aspectClassToken,
  aspectCssRatio,
  orientationOf,
  resolveMediaAspect,
  type MediaAspect,
} from './aspect';
import { focalStyle } from './focal';
import type { SlideLayout } from './layout';
import { makeParts, type PartAttrs } from './parts';
import { HtmlHost } from './HtmlHost';
import { pixabayCredit } from './pixabay';
import { youtubeEmbedUrl } from './youtube';
import { SpanText } from './span-text';
import type { SlideMedia, SlideStep } from './slide-types';

/**
 * Pictures, players and freeform elements: how a step's media and boxed
 * elements become nodes on the slide.
 */

export function stepPictureOf(step: SlideStep): SlideMedia | undefined {
  return 'media' in step ? step.media : undefined;
}

const MEDIA_PLACES = new Set(['left', 'right', 'top', 'bottom', 'fill']);

function picturePlaceOf(media: SlideMedia, layout: SlideLayout): string {
  if (media.place !== undefined && MEDIA_PLACES.has(media.place)) return media.place;
  if (layout === 'split') return 'right';
  if (layout === 'media') return 'fill';
  return 'bottom';
}

function pictureSizeOf(media: SlideMedia, place: string): number {
  if (place === 'fill') return 100;
  if (typeof media.size === 'number' && Number.isFinite(media.size)) {
    return Math.min(100, Math.max(20, Math.round(media.size)));
  }
  return 42;
}

export function elementsLayer(
  step: SlideStep,
  show: (key: string) => boolean,
  part: ReturnType<typeof makeParts>,
  decorate: (key: string) => ReactNode,
): ReactNode {
  if (!('elements' in step) || step.elements === undefined || step.elements.length === 0) return null;
  return (
    <div className="outline-step__elements">
      {step.elements.map((element) => {
        const key = `el-${element.id}`;
        if (!show(key)) return null;
        const box = element.box;
        const style = {
          left: `${String(box.x)}%`,
          top: `${String(box.y)}%`,
          width: `${String(box.w)}%`,
          height: `${String(box.h)}%`,
        };
        if (element.type === 'text') {
          const Tag = element.role === 'heading' ? 'h2' : 'p';
          const align = element.align === undefined || element.align === 'left' ? undefined : element.align;
          return (
            <Tag
              key={element.id}
              className={
                element.role === 'heading' ? 'outline-step__element outline-step__element--heading' : 'outline-step__element'
              }
              style={align === undefined ? style : { ...style, textAlign: align }}
              {...part.attrs(key)}
            >
              {decorate(key)}
              {element.spans === undefined ? element.text : <SpanText spans={element.spans} />}
            </Tag>
          );
        }
        if (element.type === 'image') {
          return (
            <div key={element.id} className="outline-step__element outline-step__element--image" style={style} {...part.hostAttrs(key)}>
              {decorate(key)}
              {element.url ? (
                <img src={element.url} alt={element.alt} style={focalStyle(element.focal)} />
              ) : (
                <div className="outline-step__media-placeholder">{element.alt}</div>
              )}
            </div>
          );
        }
        if (element.type === 'iframe') {
          return (
            <div key={element.id} className="outline-step__element outline-step__element--iframe" style={style} {...part.hostAttrs(key)}>
              {decorate(key)}
              <iframe
                src={element.url}
                title={element.title}
                sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-scripts"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
                referrerPolicy="no-referrer"
              />
            </div>
          );
        }
        if (element.type === 'pdf') {
          return (
            <div key={element.id} className="outline-step__element outline-step__element--pdf" style={style} {...part.hostAttrs(key)}>
              {decorate(key)}
              <iframe
                src={element.url}
                title={element.title}
                sandbox="allow-downloads allow-same-origin"
                referrerPolicy="no-referrer"
                scrolling="yes"
              />
            </div>
          );
        }
        // Markdown-backed html is reading material: prose that is longer than
        // its box on purpose, so it scrolls and takes the reading typography.
        const reading = element.markdown !== undefined;
        return (
          <div
            key={element.id}
            className={`outline-step__element outline-step__element--html${reading ? ' outline-step__element--reading' : ''}`}
            style={style}
            {...part.hostAttrs(key)}
          >
            {decorate(key)}
            <HtmlHost html={element.html} css={element.css} scroll={reading} />
          </div>
        );
      })}
    </div>
  );
}

export function pictureRootProps(
  media: SlideMedia | undefined,
  layout: SlideLayout,
): { 'data-picture-place'?: string; style?: CSSProperties } {
  if (media === undefined) return {};
  const place = picturePlaceOf(media, layout);
  const size = pictureSizeOf(media, place);
  return {
    'data-picture-place': place,
    style: { ['--picture-size' as string]: `${String(size)}%` } as CSSProperties,
  };
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

/**
 * Wrap a player / picture in a named aspect frame so every layout (full-bleed,
 * split, stacked) keeps the same orientation and ratio. Host attrs live on the
 * frame so the part is still selectable as one region.
 */
function mediaFrame(aspect: MediaAspect, attrs: PartAttrs, child: ReactNode): ReactNode {
  return (
    <div
      className={`outline-step__media-frame outline-step__media-frame--${aspectClassToken(aspect)}`}
      data-aspect={aspect}
      data-orientation={orientationOf(aspect)}
      style={{ aspectRatio: aspectCssRatio(aspect) }}
      {...attrs}
    >
      {child}
    </div>
  );
}

/**
 * The `image` part's element: picture, video file, or YouTube embed — or the
 * alt text when no address has been given yet. One function, because a media
 * step and an activity that carries media must draw the same thing.
 *
 * Video always sits in an aspect frame (authored, Shorts→9:16, else 16:9).
 * Images keep focal crop when no aspect is set; an authored aspect boxes them too.
 */
export function pictureNode(media: SlideMedia, attrs: PartAttrs): ReactNode {
  const style = focalStyle(media.focal);
  const aspect = resolveMediaAspect(media);

  if (!media.url) {
    if (aspect !== undefined) {
      return mediaFrame(
        aspect,
        attrs,
        <div className="outline-step__media-placeholder outline-step__media-placeholder--framed">
          {media.alt}
        </div>,
      );
    }
    return (
      <div className="outline-step__media-placeholder" {...attrs}>
        {media.alt}
      </div>
    );
  }

  if (media.type === 'image') {
    const credit = pixabayCredit(media);
    const image = <img src={media.url} alt={media.alt} style={style} />;
    if (credit === null) {
      if (aspect !== undefined) return mediaFrame(aspect, attrs, image);
      return <img src={media.url} alt={media.alt} style={style} {...attrs} />;
    }
    const credited = (
      <div className="outline-step__media-photo">
        {image}
        <span className="outline-step__media-credit">{credit}</span>
      </div>
    );
    if (aspect !== undefined) return mediaFrame(aspect, attrs, credited);
    return (
      <div className="outline-step__media-photo" {...attrs}>
        {image}
        <span className="outline-step__media-credit">{credit}</span>
      </div>
    );
  }

  // Pending starter / empty video: show the alt as a prompt, not a broken player.
  if (media.url.includes('openroom-pending') || media.url === '') {
    const placeholder = (
      <div className="outline-step__media-placeholder outline-step__media-placeholder--framed">
        {media.alt}
      </div>
    );
    return aspect !== undefined
      ? mediaFrame(aspect, attrs, placeholder)
      : (
          <div className="outline-step__media-placeholder" {...attrs}>
            {media.alt}
          </div>
        );
  }

  if (media.type === 'audio') return <div className="outline-step__audio" {...attrs}><ListeningBlock media={media} /></div>;

  const embed = youtubeEmbedUrl(media.url);
  if (embed !== null) {
    // YouTube: iframe with player controls. Focal crop does not apply to embeds;
    // the aspect frame owns the box.
    const iframe = (
      <iframe
        src={embed}
        title={media.alt === '' ? 'YouTube video' : media.alt}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="outline-step__media-embed"
      />
    );
    return mediaFrame(aspect ?? '16:9', attrs, iframe);
  }

  // Direct file (MP4, etc.) — same aspect box as embeds so orientation holds.
  const video = (
    <video src={media.url} aria-label={media.alt} controls playsInline style={style} />
  );
  return mediaFrame(aspect ?? '16:9', attrs, video);
}
