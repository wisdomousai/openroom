import { useEffect } from 'react';
import type { Outline, OutlineStep } from '@openroom/schema';
import type { StageSnapshot } from '@openroom/sdk';
import { request, type DeckDetail } from './api';
import type { Connection } from './auth';
import { bindingMatches, parseBinding, readSelection, type ActivityBinding, type SlideSelection } from './bindings';
import { displayChannelName } from './display-channel';
import { rehearse, rehearsalSnapshot } from './rehearsal';

export function slideTitle(outline: Outline, step: OutlineStep): string {
  if ('title' in step && step.title?.trim()) return step.title;
  if (step.kind === 'interaction') return outline.interactions.find((item) => item.id === step.interactionId)?.prompt || 'Untitled question';
  if ('body' in step && step.body?.trim()) return step.body.slice(0, 160);
  if (step.kind === 'term' && step.term.trim()) return step.term;
  return `${step.kind[0]!.toUpperCase()}${step.kind.slice(1)} slide`;
}

export interface SlidePreview {
  type: 'openroom.slide.preview';
  binding: ActivityBinding;
  snapshot: StageSnapshot;
}

export function slidePreview(outline: Outline, binding: ActivityBinding): SlidePreview {
  // Use the same audience allowlist as live teaching, never a host outline.
  return { type: 'openroom.slide.preview', binding, snapshot: rehearsalSnapshot(rehearse(outline, binding.stepId)) };
}

/** The signed-in pane can preview a slide before a session exists. */
export function useSlidePreview(connection: Connection | null, selection: SlideSelection | null) {
  useEffect(() => {
    const binding = parseBinding(selection?.rawBinding ?? null);
    if (!connection || !selection || !binding || !bindingMatches(selection, binding) || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(displayChannelName(binding.presentationId));
    const controller = new AbortController();
    let current: SlidePreview | null = null;
    const send = async () => {
      if (!current || controller.signal.aborted) return;
      const selected = await readSelection();
      if (!controller.signal.aborted && bindingMatches(selected, binding) && selected.rawBinding === selection.rawBinding) channel.postMessage(current);
    };
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'openroom.slide.request' && JSON.stringify(event.data.binding) === JSON.stringify(binding)) void send().catch(() => {});
    };
    void request<DeckDetail>(connection, `/api/decks/${encodeURIComponent(binding.deckId)}`, controller.signal).then((detail) => {
      if (controller.signal.aborted || detail.deck.spaceId !== binding.spaceId || !detail.content) return;
      current = slidePreview(detail.content, binding);
      return send();
    }).catch(() => { /* The pane's content and session controls report access failures. */ });
    return () => {
      controller.abort();
      channel.postMessage({ type: 'openroom.slide.closed', binding });
      channel.close();
    };
  }, [connection, selection?.slideId, selection?.presentationId, selection?.rawBinding]);
}
