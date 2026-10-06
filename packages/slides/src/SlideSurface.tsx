import type { CSSProperties, ReactNode } from 'react';
import { deckAspectRatio, resolveSlideDesign, type ResolvedSlideDesign } from '@openroom/schema';

const FONTS = {
  sans: 'Inter, Arial, sans-serif',
  serif: 'Georgia, Cambria, serif',
  mono: '"Courier New", monospace',
};

/** Deck styling is scoped to the slide; app/participant controls keep their own appearance. */
export function slideDesignStyle(design: ResolvedSlideDesign): CSSProperties {
  const { colors, fonts } = design.theme;
  return {
    '--slide-aspect': deckAspectRatio(design.aspectRatio),
    '--slide-safe-area': `${design.safeArea}cqw`,
    '--background': colors.background, '--foreground': colors.foreground,
    '--card': colors.surface, '--card-foreground': colors.foreground,
    '--panel': colors.surface, '--muted': colors.surface, '--muted-foreground': colors.muted,
    '--border': colors.border, '--rule': colors.border,
    '--brand-accent': colors.accent, '--slide-accent': colors.accent,
    '--primary': colors.accent, '--live': colors.accent,
    '--ok': colors.charts[1] ?? colors.accent,
    '--ok-fill': `color-mix(in srgb, ${colors.charts[1] ?? colors.accent} 14%, ${colors.background})`,
    '--font-display': FONTS[fonts.heading], '--font-sans': FONTS[fonts.body],
    ...Object.fromEntries(colors.charts.map((color, index) => [`--chart-${index + 1}`, color])),
    color: colors.foreground,
    fontFamily: FONTS[fonts.body],
    backgroundColor: colors.background,
  } as CSSProperties;
}

export function SlideSurface({ design = resolveSlideDesign(), children, overlay, fit = false }: {
  design?: ResolvedSlideDesign;
  children: ReactNode;
  /** Slide-relative layers share the actual slide's frame, excluding letterboxing. */
  overlay?: ReactNode;
  fit?: boolean;
}) {
  const background = design.background;
  const slide = <div className="slide-surface" data-slide-theme={design.theme.family} data-slide-aspect={design.aspectRatio}
    data-slide-decoration={design.decoration} style={slideDesignStyle(design)}>
    <div className="slide-surface__background" aria-hidden="true" style={background.kind === 'solid'
      ? { background: background.color }
      : background.kind === 'gradient' ? { background: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})` } : undefined}>
      {background.kind === 'image' ? <>
        <img src={background.url ?? (background.assetId ? `/api/assets/${encodeURIComponent(background.assetId)}` : undefined)} alt="" draggable={false} style={{ objectPosition: `${background.focal.x}% ${background.focal.y}%` }} />
        <span style={{ backgroundColor: background.overlay.color, opacity: background.overlay.opacity }} />
      </> : null}
    </div>
    {children}
    {design.logo ? <img className="slide-surface__logo" src={design.logo.url ?? (design.logo.assetId ? `/api/assets/${encodeURIComponent(design.logo.assetId)}` : undefined)} alt={design.logo.alt} draggable={false} /> : null}
    {design.footer ? <span className="slide-surface__footer">{design.footer}</span> : null}
    {overlay}
  </div>;
  return fit ? <div className="slide-viewport">{slide}</div> : slide;
}
