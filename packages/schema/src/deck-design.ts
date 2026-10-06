export const DECK_ASPECT_RATIOS = ['16:9', '16:10', '4:3'] as const;
export type DeckAspectRatio = (typeof DECK_ASPECT_RATIOS)[number];
export const SLIDE_THEME_FAMILIES = ['clean', 'paper', 'board', 'contrast', 'color', 'business'] as const;
export type SlideThemeFamily = (typeof SLIDE_THEME_FAMILIES)[number];
export type SlideFont = 'sans' | 'serif' | 'mono';

export interface SlidePalette {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  surface: string;
  border: string;
  charts: string[];
}

/** Saved values, not a reference to mutable application appearance or a brand kit. */
export interface SlideTheme {
  family: SlideThemeFamily;
  colors: SlidePalette;
  fonts: { heading: SlideFont; body: SlideFont };
}

export type SlideBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | ({ kind: 'image'; focal: { x: number; y: number }; overlay: { color: string; opacity: number } } & SlideImageSource);

/** An image can live in a space, in the deck file, or at an explicit address. */
export interface SlideImageSource { url?: string; assetId?: string; resourceId?: string }

export interface SlideMaster {
  id: string;
  name: string;
  /** Preserve a source deck's palette and fonts when combining slides. */
  theme?: SlideTheme;
  /** Omitted uses the saved theme background. */
  background?: SlideBackground;
  /** Margin as percent of slide width; 3–12. */
  safeArea: number;
  decoration: 'none' | 'rule' | 'corner';
  logo?: SlideImageSource & { alt: string };
  footer?: string;
}

export interface DeckDesign {
  aspectRatio: DeckAspectRatio;
  theme: SlideTheme;
  masters: SlideMaster[];
  defaultMasterId: string;
}

export interface SlideDesign {
  masterId?: string;
  background?: SlideBackground;
  hideMasterDecorations?: boolean;
  /** Records which starter composition was used; changing content never rewrites it. */
  templateId?: string;
}

export interface ResolvedSlideDesign {
  aspectRatio: DeckAspectRatio;
  theme: SlideTheme;
  background: SlideBackground;
  safeArea: number;
  decoration: SlideMaster['decoration'];
  logo?: SlideMaster['logo'];
  footer?: string;
}

const PALETTES: Record<SlideThemeFamily, SlidePalette> = {
  clean: { background: '#FFFFFF', foreground: '#172B3A', muted: '#526473', accent: '#1765B0', surface: '#F0F5FA', border: '#CAD8E4', charts: ['#1765B0', '#14786F', '#8B4BA1', '#A65014', '#B13A55', '#506A28'] },
  paper: { background: '#F8F3E9', foreground: '#302C28', muted: '#655D52', accent: '#9D3E28', surface: '#EEE5D5', border: '#CFC2AD', charts: ['#9D3E28', '#47624C', '#4B6385', '#86552C', '#795173', '#64602A'] },
  board: { background: '#183C35', foreground: '#FAF8ED', muted: '#C3D7CE', accent: '#F4CF76', surface: '#285348', border: '#5C8374', charts: ['#F4CF76', '#8ED3CC', '#B7C9FC', '#FFA992', '#D4B9ED', '#B8D797'] },
  contrast: { background: '#101418', foreground: '#FFFFFF', muted: '#C3CED8', accent: '#8CDCFB', surface: '#252D35', border: '#657684', charts: ['#8CDCFB', '#FCD870', '#CEB5FF', '#FFA69C', '#8BDFC3', '#F4B3DF'] },
  color: { background: '#F4F1FE', foreground: '#2B2150', muted: '#65577C', accent: '#6941BB', surface: '#E8E0FA', border: '#C6B6E6', charts: ['#6941BB', '#AA3E69', '#087979', '#A65014', '#3D5FA8', '#5E6B23'] },
  business: { background: '#F8FAFC', foreground: '#14283F', muted: '#52647A', accent: '#205E96', surface: '#E8EFF6', border: '#BACDDF', charts: ['#205E96', '#007C80', '#744BA4', '#9D5128', '#AA4059', '#566C27'] },
};

export function slideTheme(family: SlideThemeFamily): SlideTheme {
  return { family, colors: structuredClone(PALETTES[family]), fonts: { heading: family === 'paper' ? 'serif' : 'sans', body: 'sans' } };
}

export function defaultDeckDesign(family: SlideThemeFamily = 'clean'): DeckDesign {
  return {
    aspectRatio: '16:9', theme: slideTheme(family), defaultMasterId: 'standard',
    masters: [{ id: 'standard', name: 'Standard', safeArea: 8, decoration: 'none' }],
  };
}

/** Resolve one slide only, so live clients receive no other masters or document content. */
export function resolveSlideDesign(design?: DeckDesign, slide?: SlideDesign): ResolvedSlideDesign {
  const deck = design ?? defaultDeckDesign();
  const master = deck.masters.find((item) => item.id === (slide?.masterId ?? deck.defaultMasterId)) ?? deck.masters[0]!;
  const theme = master.theme ?? deck.theme;
  return {
    aspectRatio: deck.aspectRatio,
    theme: structuredClone(theme),
    background: structuredClone(slide?.background ?? master.background ?? { kind: 'solid', color: theme.colors.background }),
    safeArea: master.safeArea,
    decoration: slide?.hideMasterDecorations ? 'none' : master.decoration,
    ...(!slide?.hideMasterDecorations && master.logo ? { logo: { ...master.logo } } : {}),
    ...(!slide?.hideMasterDecorations && master.footer ? { footer: master.footer } : {}),
  };
}

export function deckAspectRatio(value: DeckAspectRatio): number {
  return value === '4:3' ? 4 / 3 : value === '16:10' ? 1.6 : 16 / 9;
}
