import type {
  DesktopAgentConversationSnapshot,
  DesktopAgentEvent,
  DesktopAgentHostId,
  DesktopAgentRunResult,
} from '../desktop-bridge';

export type AgentChatPart = DesktopAgentEvent;

export type AgentChatMessage =
  | { role: 'tutor'; text: string; attachments: string[]; folders: string[] }
  | { role: 'agent'; parts: AgentChatPart[]; pending: boolean };

export interface AgentChatState {
  hostId: DesktopAgentHostId | null;
  /**
   * What is typed but not sent. It lives here rather than in the pane so a
   * surface elsewhere in the editor can hand the agent a prompt — the reading
   * dialog's "Refine with the agent" is the first — and so a half-written
   * message survives the pane unmounting.
   */
  draft: string;
  /** Vendor model id for the selected host; null runs the host's default. */
  modelId: string | null;
  conversationId: string | null;
  messages: AgentChatMessage[];
  running: boolean;
  error: string | null;
}

export const EMPTY_AGENT_CHAT: AgentChatState = {
  hostId: null,
  draft: '',
  modelId: null,
  conversationId: null,
  messages: [],
  running: false,
  error: null,
};

export function beginTurn(
  state: AgentChatState,
  input: { prompt: string; attachments: string[]; folders: string[] },
): AgentChatState {
  return {
    ...state,
    running: true,
    error: null,
    // Sending consumes the draft, so the box is empty for the next turn.
    draft: '',
    messages: [
      ...state.messages,
      { role: 'tutor', text: input.prompt, attachments: input.attachments, folders: input.folders },
      { role: 'agent', parts: [], pending: true },
    ],
  };
}

export function applyAgentEvent(state: AgentChatState, event: DesktopAgentEvent): AgentChatState {
  const last = state.messages.at(-1);
  if (last === undefined || last.role !== 'agent' || !last.pending) return state;
  return {
    ...state,
    messages: [...state.messages.slice(0, -1), { ...last, parts: nextAgentParts(last.parts, event) }],
  };
}

function nextAgentParts(parts: AgentChatPart[], event: DesktopAgentEvent): AgentChatPart[] {
  const next = [...parts];
  if (event.kind === 'question') {
    const existing = next.findIndex((part) => part.kind === 'question' && part.id === event.id);
    if (existing >= 0) next[existing] = event;
    else next.push(event);
    return next;
  }
  const previous = next.at(-1);
  if ((event.kind === 'text' || event.kind === 'thinking') && previous?.kind === event.kind) {
    next[next.length - 1] = { kind: event.kind, text: `${previous.text}${event.text}` };
  } else {
    next.push(event);
  }
  return next;
}

export function isPendingQuestion(
  part: AgentChatPart,
): part is Extract<AgentChatPart, { kind: 'question' }> {
  return part.kind === 'question' && part.answers === undefined && part.cancelled !== true;
}

export function finishTurn(state: AgentChatState, result: DesktopAgentRunResult): AgentChatState {
  const last = state.messages.at(-1);
  const settled =
    last !== undefined && last.role === 'agent' && last.pending
      ? last.parts.length === 0
        ? state.messages.slice(0, -1)
        : [...state.messages.slice(0, -1), { ...last, pending: false }]
      : state.messages;
  return {
    ...state,
    running: false,
    messages: settled,
    conversationId: result.ok ? result.conversationId : (result.conversationId ?? state.conversationId),
    error: result.ok ? null : result.error,
  };
}

export function resetChat(state: AgentChatState): AgentChatState {
  return { ...EMPTY_AGENT_CHAT, hostId: state.hostId, modelId: state.modelId, draft: state.draft };
}

export function restoreChat(
  snapshot: DesktopAgentConversationSnapshot | null,
  /** `draft` rides along so loading a conversation does not discard what is typed. */
  fallback: Pick<AgentChatState, 'hostId' | 'modelId'> & { draft?: string },
): AgentChatState {
  const draft = fallback.draft ?? '';
  if (snapshot === null) return { ...EMPTY_AGENT_CHAT, ...fallback, draft };
  return {
    hostId: snapshot.hostId,
    modelId: snapshot.modelId,
    draft,
    conversationId: snapshot.id,
    messages: snapshot.messages,
    running: false,
    error: null,
  };
}

const HOST_STORAGE_KEY = 'openroom.agentHost';

/** People pick one agent and stick with it; the choice survives restarts. */
export function storedHostId(): DesktopAgentHostId | null {
  try {
    return localStorage.getItem(HOST_STORAGE_KEY) as DesktopAgentHostId | null;
  } catch {
    return null;
  }
}

export function storeHostId(id: DesktopAgentHostId): void {
  try {
    localStorage.setItem(HOST_STORAGE_KEY, id);
  } catch {
    // Storage can be unavailable; the fallback picker order still applies.
  }
}

const MODEL_STORAGE_PREFIX = 'openroom.agentModel.';
/** Stored when the tutor explicitly picks the host's own default over ours. */
const HOST_DEFAULT_SENTINEL = 'host-default';

/** The last model picked for this host survives restarts, like the host itself. */
export function storeModelId(host: DesktopAgentHostId, modelId: string | null): void {
  try {
    localStorage.setItem(MODEL_STORAGE_PREFIX + host, modelId ?? HOST_DEFAULT_SENTINEL);
  } catch {
    // Storage can be unavailable; the picker just starts from the default again.
  }
}

/**
 * The model a fresh chat on this host should start on: the machine's last
 * explicit pick when it still exists, otherwise our own default. For ChatGPT
 * that default is the Luna tier, not the CLI's frontier default — deck edits
 * are small structured writes, and the fast tier is the right cost for them.
 * `null` means the host's own default (also what an explicit "Default model"
 * pick pins).
 */
export function preferredModelId(
  host: DesktopAgentHostId,
  models: ReadonlyArray<{ id: string; label: string }>,
): string | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(MODEL_STORAGE_PREFIX + host);
  } catch {
    stored = null;
  }
  if (stored === HOST_DEFAULT_SENTINEL) return null;
  if (stored !== null && models.some((model) => model.id === stored)) return stored;
  if (host !== 'codex') return null;
  const luna = models.find((model) => /luna/i.test(model.id) || /luna/i.test(model.label));
  return luna?.id ?? null;
}

export function selectModel(state: AgentChatState, modelId: string | null): AgentChatState {
  if (state.modelId === modelId) return state;
  // Mid-conversation switches are fine: the model rides each turn, not the thread.
  return { ...state, modelId };
}

export function selectHost(state: AgentChatState, hostId: DesktopAgentHostId): AgentChatState {
  if (state.hostId === hostId) return state;
  // A conversation's resume handle belongs to one host; switching starts over.
  return { ...EMPTY_AGENT_CHAT, hostId };
}

type Listener = () => void;

function createAgentChatStore() {
  let state = EMPTY_AGENT_CHAT;
  const listeners = new Set<Listener>();
  return {
    getState: () => state,
    setState(updater: (current: AgentChatState) => AgentChatState) {
      const next = updater(state);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Module singleton so the transcript survives AgentPane unmount. */
export const agentChatStore = createAgentChatStore();

/**
 * Put reading material in the agent's prompt box, ready for the tutor to send.
 *
 * The text is handed over, not the address it came from: the worker has already
 * read the page, so refining does not depend on the selected runtime having web
 * access — of the three, only Codex does. Nothing is sent here; the tutor reads
 * the prompt and presses send, which is also what keeps `outline.insert`
 * approval with the person and not the button.
 */
export function seedAgentWithReading(markdown: string): void {
  agentChatStore.setState((current) => ({
    ...current,
    draft: [
      'Rewrite the reading material below for this session, in Markdown.',
      'Keep the meaning, drop anything that was page furniture, and keep it to what fits one scrollable slide.',
      'Save it back onto the reading slide when it is ready.',
      '',
      markdown,
    ].join('\n'),
  }));
}
