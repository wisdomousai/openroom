import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveRevealOrder, resolveSlideDesign, type Interaction, type Outline, type OutlineMedia, type OutlineStep, type ResolvedSlideDesign } from '@openroom/schema';
import { StepLayout, isPixabayUrl, isYoutubeUrl, type SlideOption, type SlideStep } from '@openroom/slides';
import { applyTheme } from '@openroom/ui';

import outlineCss from '@openroom/slides/outline-step.css';
import deckCss from '@openroom/slides/deck-slide.css';
import stageCss from '../../../apps/stage/src/stage-ui.css';
import previewCss from './preview.css';

type PreviewResult = {
  ok: boolean;
  previewVersion?: number;
  source?: { kind?: 'draft' | 'deck'; deckId?: string; version?: number; currentVersion?: number };
  outline?: Outline;
  links?: { assetOrigin?: string; browserEditorUrl?: string; desktopHandoffUrl?: string };
  errors?: Array<{ path?: string; message?: string }>;
};

type OpenAiBridge = {
  toolOutput?: unknown;
  theme?: 'light' | 'dark';
  requestDisplayMode?: (input: { mode: 'inline' | 'fullscreen' }) => Promise<unknown>;
  openExternal?: (input: { href: string; redirectUrl?: boolean }) => Promise<unknown>;
  setOpenInAppUrl?: (input: { href: string }) => void;
};

declare global {
  interface Window { openai?: OpenAiBridge }
}

const styles = document.createElement('style');
styles.textContent = `${outlineCss.replace(/^@import[^;]+;/gm, '')}\n${stageCss}\n${deckCss}\n${previewCss}`;
document.head.append(styles);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asPreviewResult(value: unknown): PreviewResult | null {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') return null;
  return value as PreviewResult;
}

function initialResult(): PreviewResult | null {
  const direct = asPreviewResult(window.openai?.toolOutput);
  if (direct !== null) return direct;
  const nested = isRecord(window.openai?.toolOutput)
    ? asPreviewResult(window.openai?.toolOutput['structuredContent'])
    : null;
  return nested;
}

function useToolResult(): PreviewResult | null {
  const [value, setValue] = useState<PreviewResult | null>(initialResult);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || !isRecord(event.data)) return;
      if (event.data['jsonrpc'] !== '2.0' || event.data['method'] !== 'ui/notifications/tool-result') return;
      const params = isRecord(event.data['params']) ? event.data['params'] : null;
      const next = params === null ? null : asPreviewResult(params['structuredContent']);
      if (next !== null) setValue(next);
    };
    window.addEventListener('message', receive, { passive: true });
    return () => window.removeEventListener('message', receive);
  }, []);
  return value;
}

type Cursor = { step: number; shown: number };

function entered(counts: readonly number[], step: number): Cursor {
  const at = Math.min(Math.max(step, 0), Math.max(0, counts.length - 1));
  return { step: at, shown: Math.min(1, counts[at] ?? 0) };
}

function advance(counts: readonly number[], cursor: Cursor): Cursor {
  const whole = counts[cursor.step] ?? 0;
  if (cursor.shown < whole) return { ...cursor, shown: cursor.shown + 1 };
  if (cursor.step + 1 >= counts.length) return { ...cursor, shown: whole };
  return entered(counts, cursor.step + 1);
}

function retreat(counts: readonly number[], cursor: Cursor): Cursor {
  const step = cursor.step === 0 ? 0 : cursor.step - 1;
  return { step, shown: counts[step] ?? 0 };
}

function interactionFor(outline: Outline, step: OutlineStep): Interaction | undefined {
  if (step.kind !== 'interaction') return undefined;
  return outline.interactions.find((interaction) => interaction.id === step.interactionId);
}

function optionsFor(interaction: Interaction | undefined): SlideOption[] | undefined {
  if (interaction?.type !== 'choice' && interaction?.type !== 'ranking') return undefined;
  return interaction.options.map(({ id, label, labelSpans }) => ({
    id,
    label,
    ...(labelSpans === undefined ? {} : { labelSpans }),
  }));
}

function stepTitle(outline: Outline, step: OutlineStep): string {
  if ('title' in step && typeof step.title === 'string' && step.title !== '') return step.title;
  if (step.kind === 'term') return step.term;
  if (step.kind === 'statement') return step.stat ?? step.body;
  if (step.kind === 'interaction') return interactionFor(outline, step)?.prompt ?? 'Question';
  if (step.kind === 'join') return 'Join the session';
  if (step.kind === 'timer') return step.title ?? 'Timer';
  return step.kind.charAt(0).toUpperCase() + step.kind.slice(1);
}

function allowedUrl(url: string, assetOrigin: string | undefined): string | undefined {
  try {
    const parsed = new URL(url, assetOrigin ?? 'https://openroom.invalid');
    if (isPixabayUrl(parsed.href) || isYoutubeUrl(parsed.href)) return parsed.href;
    if (assetOrigin !== undefined && parsed.origin === new URL(assetOrigin).origin && parsed.pathname.startsWith('/api/assets/')) {
      return parsed.href;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function safeMedia(media: OutlineMedia, assetOrigin: string | undefined): OutlineMedia {
  const url = media.assetId !== undefined && assetOrigin !== undefined
    ? `${assetOrigin}/api/assets/${encodeURIComponent(media.assetId)}`
    : media.url === undefined ? undefined : allowedUrl(media.url, assetOrigin);
  const { url: _url, ...rest } = media;
  return { ...rest, ...(url === undefined ? {} : { url }) } as OutlineMedia;
}

function safeStep(step: OutlineStep, assetOrigin: string | undefined): OutlineStep {
  const next = structuredClone(step) as OutlineStep;
  if ('media' in next && next.media !== undefined) next.media = safeMedia(next.media, assetOrigin);
  if ('elements' in next && next.elements !== undefined) {
    next.elements = next.elements.map((element) => {
      if (element.type !== 'image') return element;
      const url = element.assetId !== undefined && assetOrigin !== undefined
        ? `${assetOrigin}/api/assets/${encodeURIComponent(element.assetId)}`
        : element.url === undefined ? undefined : allowedUrl(element.url, assetOrigin);
      const { url: _url, ...rest } = element;
      return { ...rest, ...(url === undefined ? {} : { url }) };
    });
  }
  return next;
}

function safeDesign(design: ResolvedSlideDesign, assetOrigin: string | undefined): ResolvedSlideDesign {
  const result = structuredClone(design);
  if (result.background.kind === 'image') {
    const url = allowedUrl(result.background.url, assetOrigin);
    result.background = url ? { ...result.background, url } : { kind: 'solid', color: result.theme.colors.background };
  }
  if (result.logo) {
    const url = allowedUrl(result.logo.url, assetOrigin);
    result.logo = url ? { ...result.logo, url } : undefined;
  }
  return result;
}

function openLink(href: string) {
  if (window.openai?.openExternal !== undefined) {
    void window.openai.openExternal({ href });
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}

function Preview({ result }: { result: PreviewResult }) {
  const outline = result.outline;
  const mode = window.openai?.theme === 'dark' ? 'dark' : 'light';
  useEffect(() => {
    applyTheme(document.documentElement, outline?.defaults?.theme, mode);
  }, [outline?.defaults?.theme, mode]);
  useEffect(() => {
    const target = result.links?.desktopHandoffUrl ?? result.links?.browserEditorUrl;
    if (target !== undefined) window.openai?.setOpenInAppUrl?.({ href: target });
  }, [result.links?.desktopHandoffUrl, result.links?.browserEditorUrl]);

  const mainSteps = useMemo(() => outline?.steps.filter((step) => step.breakoutOf === undefined) ?? [], [outline]);
  const groups = useMemo(
    () => outline === undefined ? [] : mainSteps.map((step) => resolveRevealOrder(step, outline.interactions)),
    [mainSteps, outline],
  );
  const counts = useMemo(() => groups.map((group) => group.length), [groups]);
  const [cursor, setCursor] = useState<Cursor>(() => entered(counts, 0));
  const [selectedId, setSelectedId] = useState<string | null>(mainSteps[0]?.id ?? null);

  useEffect(() => {
    setCursor(entered(counts, 0));
    setSelectedId(mainSteps[0]?.id ?? null);
  }, [outline]);

  if (outline === undefined) return <Empty result={result} />;
  const selected = outline.steps.find((step) => step.id === selectedId) ?? mainSteps[cursor.step];
  if (selected === undefined) return <Empty result={result} />;
  const isBreakout = selected.breakoutOf !== undefined;
  const mainIndex = mainSteps.findIndex((step) => step.id === selected.id);
  const selectedGroups = isBreakout
    ? resolveRevealOrder(selected, outline.interactions)
    : groups[mainIndex] ?? [];
  const shown = isBreakout ? selectedGroups.length : cursor.shown;
  const hidden = new Set(selectedGroups.slice(shown).flat());
  const interaction = interactionFor(outline, selected);
  const displayStep = safeStep(selected, result.links?.assetOrigin);

  const showMain = (next: Cursor) => {
    setCursor(next);
    setSelectedId(mainSteps[next.step]?.id ?? null);
  };

  return (
    <main className="preview-shell">
      <header className="preview-header">
        <div>
          <p className="preview-kicker">Deck preview</p>
          <h1>{outline.meta.title}</h1>
        </div>
        <div className="preview-actions">
          {window.openai?.requestDisplayMode !== undefined ? (
            <button type="button" onClick={() => void window.openai?.requestDisplayMode?.({ mode: 'fullscreen' })}>Fullscreen</button>
          ) : null}
          {result.links?.desktopHandoffUrl !== undefined ? (
            <button type="button" className="primary" onClick={() => openLink(result.links!.desktopHandoffUrl!)}>Open in Desktop</button>
          ) : null}
          {result.links?.browserEditorUrl !== undefined ? (
            <button type="button" onClick={() => openLink(result.links!.browserEditorUrl!)}>Open deck</button>
          ) : null}
        </div>
      </header>
      <div className="preview-workspace">
        <nav className="thumbnail-rail" aria-label="Deck slides">
          {outline.steps.map((step) => {
            const active = step.id === selected.id;
            return (
              <button
                type="button"
                key={step.id}
                className={active ? 'thumbnail active' : 'thumbnail'}
                data-breakout={step.breakoutOf === undefined ? undefined : 'true'}
                aria-current={active ? 'true' : undefined}
                onClick={() => {
                  setSelectedId(step.id);
                  const index = mainSteps.findIndex((candidate) => candidate.id === step.id);
                  if (index >= 0) setCursor(entered(counts, index));
                }}
              >
                <span className="thumbnail-number">{step.breakoutOf === undefined ? String(mainSteps.findIndex((candidate) => candidate.id === step.id) + 1) : '↳'}</span>
                <span>{stepTitle(outline, step)}</span>
              </button>
            );
          })}
        </nav>
        <section className="preview-stage-wrap" aria-label={stepTitle(outline, selected)}>
          <div className="preview-stage-ratio">
            <div className="stage stage--embedded stage--no-rail" data-idle="false" data-rail="false">
              <div className="stage__grid"><div className="stage__main">
                <StepLayout
                  design={safeDesign(resolveSlideDesign(outline.design, selected.design), result.links?.assetOrigin)}
                  fit
                  step={displayStep as SlideStep}
                  options={optionsFor(interaction)}
                  prompt={interaction?.prompt}
                  promptSpans={interaction?.type === 'fill-the-gaps' ? undefined : interaction?.promptSpans}
                  promptFont={interaction?.type === 'fill-the-gaps' ? interaction.promptFont : undefined}
                  gaps={interaction?.type === 'fill-the-gaps' ? interaction.gaps : undefined}
                  renderInteraction
                  hiddenParts={hidden}
                />
              </div></div>
            </div>
          </div>
          <footer className="preview-footer">
            <div>
              <strong>{isBreakout ? 'Breakout' : `Slide ${String(cursor.step + 1)} of ${String(mainSteps.length)}`}</strong>
              <span>{stepTitle(outline, selected)}</span>
              {!isBreakout && selectedGroups.length > 1 ? <span>Reveal {String(shown)}/{String(selectedGroups.length)}</span> : null}
            </div>
            <div className="preview-controls">
              <button type="button" aria-label="Previous slide" onClick={() => showMain(retreat(counts, cursor))}>←</button>
              <button type="button" aria-label="Next reveal or slide" onClick={() => showMain(advance(counts, cursor))}>→</button>
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}

function Empty({ result }: { result: PreviewResult }) {
  const message = result.ok ? 'This deck has no slides to preview.' : 'The deck preview could not be prepared.';
  return <main className="preview-empty"><p className="preview-kicker">Deck preview</p><h1>{message}</h1>{result.errors?.map((error, index) => <p key={index}>{error.path ?? '/'}: {error.message ?? 'Invalid outline'}</p>)}</main>;
}

function App() {
  const result = useToolResult();
  if (result === null) return <main className="preview-empty"><p>Deck preview — loading…</p></main>;
  return <Preview result={result} />;
}

createRoot(document.getElementById('app')!).render(<App />);
