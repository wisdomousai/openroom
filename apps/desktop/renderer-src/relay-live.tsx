/**
 * The live services for a session that runs on the desktop's relay (signed
 * out, live server set).
 *
 * The session's own API calls (state, commands, assets, export, stage token)
 * need no change: the desktop shell routes `/api/sessions/<code>/…` of a relay
 * session to the relay. What changes is everything the relay does not hold:
 * there is no saved session record or Library place, no saved results, and no
 * remote or Q&A desk page on another device. Join and stage links are the
 * relay's own pages.
 */
import { useMemo, type ReactNode } from 'react';
import { EditorServicesProvider, useEditorServices, type EditorServices } from '@openroom/editor';

export function relayEditorServices(base: EditorServices, origin: string): EditorServices {
  const relay = `${origin.replace(/\/$/, '')}/`;
  const { SavedResults: _savedResults, ...slots } = base.slots;
  return {
    ...base,
    live: {
      ...base.live,
      fetchSessionContext: () => Promise.resolve({ context: null, session: null }),
      getSessionItem: () => Promise.reject(new Error('This session has no saved record.')),
      stageUrl: (sessionCode, stageToken) =>
        new URL(`stage/?session=${encodeURIComponent(sessionCode)}&token=${encodeURIComponent(stageToken)}`, relay).toString(),
      joinUrl: (code, serverJoinUrl) => {
        const fallback = `join/?code=${encodeURIComponent(code)}`;
        try {
          const url = new URL(serverJoinUrl ?? fallback, relay);
          return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : new URL(fallback, relay).toString();
        } catch {
          return new URL(fallback, relay).toString();
        }
      },
    },
    navigation: { ...base.navigation, shareUrl: () => null },
    slots,
  };
}

/** Pass-through without a relay origin; the relay adapter with one. */
export function RelayLiveServices({ origin, children }: { origin: string | null; children: ReactNode }) {
  const base = useEditorServices();
  const services = useMemo(() => (origin === null ? base : relayEditorServices(base, origin)), [base, origin]);
  return <EditorServicesProvider services={services}>{children}</EditorServicesProvider>;
}
