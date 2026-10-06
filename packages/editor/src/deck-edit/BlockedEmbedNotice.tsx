import { useEffect, useState } from 'react';
import type { OutlineElement } from '@openroom/schema';

import { checkEmbeddable, type EmbedCheck } from '../../../../apps/host/src/api';
import { embedRefusalText } from './IframeElementDialog';

/**
 * Probe results for this session, keyed by address.
 *
 * Module-level on purpose: paging through the thumbnail rail re-mounts the
 * canvas constantly, and a publisher's framing headers do not change between
 * two clicks. A refusal is worth one request, not one per glance.
 */
const cache = new Map<string, EmbedCheck>();
const inFlight = new Map<string, Promise<void>>();

function useEmbedCheck(url: string, deckId: string | null | undefined): EmbedCheck | null {
  const [result, setResult] = useState<EmbedCheck | null>(cache.get(url) ?? null);

  useEffect(() => {
    const known = cache.get(url);
    if (known !== undefined) {
      setResult(known);
      return;
    }
    if (deckId === null || deckId === undefined) return;
    let cancelled = false;
    const pending =
      inFlight.get(url) ??
      checkEmbeddable({ url, deckId })
        .then((answer) => {
          cache.set(url, answer);
        })
        // A probe that cannot run is not a verdict, and is not cached either.
        .catch(() => undefined)
        .finally(() => {
          inFlight.delete(url);
        });
    inFlight.set(url, pending);
    void pending.then(() => {
      if (!cancelled) setResult(cache.get(url) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [deckId, url]);

  return result;
}

/**
 * Say so, in the editor, when a page on this slide will not draw.
 *
 * The browser cannot raise this itself — a frame blocked by `X-Frame-Options`
 * fires `load`, not `error` — so the verdict comes from the probe. It is drawn
 * here rather than in `StepLayout` for two reasons: `elementsLayer` is a pure
 * function called rather than mounted (see `StageView`), so it can hold no
 * state; and a diagnostic belongs to the person preparing the deck, never over
 * a slide in front of a class.
 */
function ElementNotice({
  element,
  deckId,
}: {
  element: Extract<OutlineElement, { type: 'iframe' }>;
  deckId: string | null | undefined;
}) {
  const check = useEmbedCheck(element.url, deckId);
  if (check === null || check.embeddable) return null;
  const { box } = element;
  return (
    <div
      className="slide-canvas__embed-notice"
      style={{
        left: `${String(box.x)}%`,
        top: `${String(box.y)}%`,
        width: `${String(box.w)}%`,
        height: `${String(box.h)}%`,
      }}
    >
      <p>{embedRefusalText(check.reason)}</p>
    </div>
  );
}

export function BlockedEmbedNotices({
  elements,
  deckId,
}: {
  elements: readonly OutlineElement[];
  deckId: string | null | undefined;
}) {
  const frames = elements.filter(
    (item): item is Extract<OutlineElement, { type: 'iframe' }> => item.type === 'iframe',
  );
  if (frames.length === 0) return null;
  return (
    <div className="slide-canvas__embed-notices" data-slide-decoration="">
      {frames.map((element) => (
        <ElementNotice key={element.id} element={element} deckId={deckId} />
      ))}
    </div>
  );
}
