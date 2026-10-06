/**
 * An in-memory `EditorServices` for tests: no server, no router, no storage,
 * no slots. Network calls reject; navigation is recorded.
 */
import type { EditorDestination, EditorLinkProps, EditorServices } from './services';

function unavailable(what: string): () => Promise<never> {
  return () => Promise.reject(new Error(`${what} is not available in memory.`));
}

/** A stable text form of a destination, used as the fake link's href. */
export function destinationHref(destination: EditorDestination): string {
  const { kind, ...rest } = destination;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(rest)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      for (const [inner, part] of Object.entries(value as Record<string, unknown>)) {
        if (typeof part === 'string') params.set(`${key}.${inner}`, part);
      }
    } else params.set(key, String(value));
  }
  const query = params.toString();
  return `memory:${kind}${query === '' ? '' : `?${query}`}`;
}

function MemoryLink({ to, ...rest }: EditorLinkProps) {
  return <a href={destinationHref(to)} {...rest} />;
}

function MemoryStageView() {
  return <div data-memory-stage-view="" />;
}

export interface MemoryEditorServices extends EditorServices {
  /** Every navigation the editor asked for, in order. */
  navigations: Array<{ destination: EditorDestination; replace: boolean }>;
}

export function memoryEditorServices(overrides: Partial<EditorServices> = {}): MemoryEditorServices {
  const navigations: MemoryEditorServices['navigations'] = [];
  const services: EditorServices = {
    assets: {
      upload: unavailable('Upload'),
      list: () => Promise.resolve([]),
      url: (assetId) => `memory:asset/${assetId}`,
    },
    tools: {
      useDictionaryEntry: () => ({
        data: undefined,
        error: null,
        isPending: false,
        isError: false,
        isFetching: false,
        refetch: () => undefined,
      }),
      lookUpWord: unavailable('Dictionary lookup'),
      searchStock: unavailable('Stock search'),
      checkEmbeddable: unavailable('Embed check'),
      importReadingMaterial: unavailable('Reading import'),
    },
    live: {
      fetchHostSnapshot: unavailable('Session state'),
      fetchStageToken: unavailable('Stage token'),
      fetchSessionContext: unavailable('Session context'),
      getSessionItem: unavailable('Session item'),
      downloadExport: unavailable('Export'),
      stageUrl: (sessionCode) => `memory:stage/${sessionCode}`,
      joinUrl: (code) => `memory:join/${code}`,
      startFailureMessage: (cause, fallback) => (cause instanceof Error ? cause.message : fallback),
      sessions: { save: () => undefined, clear: () => undefined },
      StageView: MemoryStageView,
    },
    navigation: {
      navigate: (destination, options) => {
        navigations.push({ destination, replace: options?.replace === true });
      },
      Link: MemoryLink,
      shareUrl: (surface, sessionCode) => `memory:${surface}/${sessionCode}`,
    },
    desktop: null,
    slots: {},
    ...overrides,
  };
  return { ...services, navigations };
}
