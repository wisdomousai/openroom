/**
 * The desktop's relay live adapter and the start-route decision: signed in →
 * workspace, signed out with a live server → relay, otherwise offline.
 */
import { describe, expect, it } from 'vitest';
import type { DesktopRelayStatus, EditorServices, OpenRoomDesktopBridge } from '@openroom/editor';

import { relayEditorServices } from './editor-services';
import { OFFLINE_LIVE_MESSAGE, desktopLiveRoute } from './lib/desktop-live';

const fail = () => Promise.reject(new Error('base service called'));

function baseServices(): EditorServices {
  const SavedResults = () => null;
  return {
    assets: { upload: fail, list: fail, url: (id: string) => `base:asset/${id}` },
    tools: {} as EditorServices['tools'],
    live: {
      fetchHostSnapshot: fail,
      fetchStageToken: fail,
      fetchSessionContext: fail,
      getSessionItem: fail,
      downloadExport: fail,
      stageUrl: (code: string) => `base:stage/${code}`,
      joinUrl: (code: string) => `base:join/${code}`,
      startFailureMessage: (_cause: unknown, fallback: string) => fallback,
      sessions: { save: () => undefined, clear: () => undefined },
      StageView: (() => null) as unknown as EditorServices['live']['StageView'],
    },
    navigation: {
      navigate: () => undefined,
      Link: (() => null) as unknown as EditorServices['navigation']['Link'],
      shareUrl: (surface: string, code: string) => `base:${surface}/${code}`,
    },
    desktop: null,
    slots: { SavedResults, scratchpad: { read: () => '', write: () => undefined, handOff: () => undefined } },
  };
}

describe('relayEditorServices', () => {
  const relay = relayEditorServices(baseServices(), 'https://live.example.org/');

  it('points the join and stage links at the relay', () => {
    expect(relay.live.joinUrl('AB12CD', '/join/?code=AB12CD')).toBe('https://live.example.org/join/?code=AB12CD');
    expect(relay.live.joinUrl('AB12CD')).toBe('https://live.example.org/join/?code=AB12CD');
    // A relay with its own JOIN_ORIGIN returns an absolute link; it is kept.
    expect(relay.live.joinUrl('AB12CD', 'https://join.example.org/?code=AB12CD')).toBe('https://join.example.org/?code=AB12CD');
    expect(relay.live.joinUrl('AB12CD', 'javascript:alert(1)')).toBe('https://live.example.org/join/?code=AB12CD');
    expect(relay.live.stageUrl('AB12CD', 'st k')).toBe('https://live.example.org/stage/?session=AB12CD&token=st%20k');
  });

  it('reads no workspace record for the session', async () => {
    await expect(relay.live.fetchSessionContext('AB12CD', 'host')).resolves.toEqual({ context: null, session: null });
    await expect(relay.live.getSessionItem('s1')).rejects.toThrow(/no saved record/);
    expect(relay.slots.SavedResults).toBeUndefined();
    expect(relay.slots.scratchpad).toBeDefined();
  });

  it('offers no remote or Q&A desk link for another device', () => {
    expect(relay.navigation.shareUrl('remote', 'AB12CD', 'host')).toBeNull();
    expect(relay.navigation.shareUrl('qna', 'AB12CD', 'host')).toBeNull();
  });

  it('leaves the session API calls to the base adapter', () => {
    const base = baseServices();
    const wrapped = relayEditorServices(base, 'https://live.example.org');
    expect(wrapped.live.fetchHostSnapshot).toBe(base.live.fetchHostSnapshot);
    expect(wrapped.live.downloadExport).toBe(base.live.downloadExport);
    expect(wrapped.live.sessions).toBe(base.live.sessions);
  });
});

function bridgeWith(status: DesktopRelayStatus | Error): OpenRoomDesktopBridge {
  return {
    relayStatus: () => (status instanceof Error ? Promise.reject(status) : Promise.resolve(status)),
  } as unknown as OpenRoomDesktopBridge;
}

const SET: DesktopRelayStatus = { origin: 'https://live.example.org', hasKey: true, fromEnv: false, keychain: true };

describe('desktopLiveRoute', () => {
  it('uses the workspace when signed in, whatever the relay setting', async () => {
    expect(await desktopLiveRoute(() => Promise.resolve(true), bridgeWith(SET))).toEqual({ kind: 'workspace' });
  });

  it('uses the relay when signed out with an address and a key', async () => {
    expect(await desktopLiveRoute(() => Promise.resolve(false), bridgeWith(SET))).toEqual({ kind: 'relay', origin: 'https://live.example.org' });
  });

  it('is offline when signed out without a complete live server', async () => {
    const signedOut = () => Promise.resolve(false);
    expect(await desktopLiveRoute(signedOut, bridgeWith({ ...SET, hasKey: false }))).toEqual({ kind: 'offline' });
    expect(await desktopLiveRoute(signedOut, bridgeWith({ ...SET, origin: null }))).toEqual({ kind: 'offline' });
    expect(await desktopLiveRoute(signedOut, bridgeWith(new Error('ipc')))).toEqual({ kind: 'offline' });
    expect(await desktopLiveRoute(signedOut, null)).toEqual({ kind: 'offline' });
    // A desktop build without the live server methods.
    expect(await desktopLiveRoute(signedOut, {} as OpenRoomDesktopBridge)).toEqual({ kind: 'offline' });
  });

  it('treats a failed sign-in check as signed out', async () => {
    expect(await desktopLiveRoute(() => Promise.reject(new Error('offline')), bridgeWith(SET))).toEqual({ kind: 'relay', origin: 'https://live.example.org' });
  });

  it('states what a live session needs', () => {
    expect(OFFLINE_LIVE_MESSAGE).toBe('Live sessions need a sign-in or a live server. Present works offline.');
  });
});
