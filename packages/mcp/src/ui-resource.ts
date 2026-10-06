import { DECK_PREVIEW_SCRIPT } from './generated/deck-preview-script.js';
import {
  DECK_PREVIEW_INVOKED,
  DECK_PREVIEW_INVOKING,
  DECK_PREVIEW_RESOURCE_URI,
} from './tools.js';

/** ChatGPT Apps SDK widget MIME (Pizzaz / kitchen-sink). `_meta.ui` still describes MCP Apps. */
export const MCP_APP_MIME_TYPE = 'text/html+skybridge';

const DEFAULT_APP_ORIGIN = 'https://openroom.app';

function originOf(value: string | undefined): string {
  if (value === undefined) return DEFAULT_APP_ORIGIN;
  try {
    return new URL(value).origin;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

function resourceMeta(appOrigin: string): Record<string, unknown> {
  const resourceDomains = [appOrigin, 'https://cdn.pixabay.com', 'https://pixabay.com'];
  const frameDomains = ['https://www.youtube-nocookie.com'];
  return {
    ui: {
      prefersBorder: true,
      domain: appOrigin,
      csp: {
        connectDomains: [],
        resourceDomains,
        frameDomains,
      },
    },
    'openai/outputTemplate': DECK_PREVIEW_RESOURCE_URI,
    'openai/toolInvocation/invoking': DECK_PREVIEW_INVOKING,
    'openai/toolInvocation/invoked': DECK_PREVIEW_INVOKED,
    'openai/widgetAccessible': true,
    'openai/widgetDescription':
      'Read-only deck preview with a slide rail, projector-accurate slide rendering, reveal playback, and OpenRoom handoff.',
    'openai/widgetPrefersBorder': true,
    'openai/widgetDomain': appOrigin,
    'openai/widgetCSP': {
      connect_domains: [],
      resource_domains: resourceDomains,
      frame_domains: frameDomains,
      redirect_domains: [appOrigin],
    },
  };
}

export function deckPreviewResource(appOrigin?: string): {
  descriptor: Record<string, unknown>;
  content: Record<string, unknown>;
} {
  const origin = originOf(appOrigin);
  const meta = resourceMeta(origin);
  const script = DECK_PREVIEW_SCRIPT.replace(/<\/script/gi, '<\\/script');
  return {
    descriptor: {
      uri: DECK_PREVIEW_RESOURCE_URI,
      name: 'OpenRoom deck preview',
      title: 'Deck preview',
      description: 'Optional read-only UI for the deck_preview tool.',
      mimeType: MCP_APP_MIME_TYPE,
      _meta: meta,
    },
    content: {
      uri: DECK_PREVIEW_RESOURCE_URI,
      mimeType: MCP_APP_MIME_TYPE,
      text:
        '<!doctype html><html><head><meta charset="utf-8" />' +
        '<meta name="viewport" content="width=device-width,initial-scale=1" />' +
        '<title>OpenRoom deck preview</title></head><body>' +
        '<div id="app" aria-live="polite"></div>' +
        `<script>${script}</script></body></html>`,
      _meta: meta,
    },
  };
}
