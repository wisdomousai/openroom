import type { AgentTaskProfileId } from './profiles.js';

export type AgentHostId = 'claude' | 'codex' | 'byok';

export interface AgentHostInfo {
  id: AgentHostId;
  name: string;
  installUrl: string;
  experimental: boolean;
}

export interface AgentHostStatus extends AgentHostInfo {
  binary: string;
  installed: boolean;
  signedIn: boolean;
  /** Whether the sign-in flow can run (a CLI binary is reachable for the login command). */
  loginAvailable: boolean;
  /** Version of the CLI behind a subscription host; null for the API-key host. */
  runtimeVersion: string | null;
  /** Why the host cannot run yet, when that needs spelling out (an outdated CLI). */
  detail: string | null;
}

export type AgentEventKind = 'text' | 'thinking' | 'tool' | 'status' | 'error' | 'question';

export interface AgentQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface AgentQuestion {
  id: string;
  prompt: string;
  header?: string;
  multiSelect?: boolean;
  options: AgentQuestionOption[];
}

export interface AgentQuestionAnswer {
  questionId: string;
  optionIds: string[];
  text?: string;
}

export type AgentTextEvent = {
  kind: 'text' | 'thinking' | 'tool' | 'status' | 'error';
  text: string;
};

export type AgentQuestionEvent = {
  kind: 'question';
  id: string;
  questions: AgentQuestion[];
  answers?: AgentQuestionAnswer[];
  cancelled?: boolean;
};

export type AgentEvent = AgentTextEvent | AgentQuestionEvent;

export type AgentChatPart = AgentEvent;

/** Merge a streamed event into the pending agent parts (replace question by id). */
export function nextAgentParts(parts: AgentChatPart[], event: AgentEvent): AgentChatPart[] {
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

export type AgentChatMessage =
  | { role: 'tutor'; text: string; attachments: string[]; folders: string[] }
  | { role: 'agent'; parts: AgentChatPart[]; pending: boolean };

export interface AgentConversationSnapshot {
  id: string;
  hostId: AgentHostId;
  modelId: string | null;
  messages: AgentChatMessage[];
}

export interface AgentConversationSummary {
  id: string;
  hostId: AgentHostId;
  preview: string;
  updatedAt: string;
}

export interface AgentWorkspaceSnapshot {
  active: AgentConversationSnapshot | null;
  history: AgentConversationSummary[];
}

export interface AgentRunRequest {
  host: AgentHostId;
  prompt: string;
  /** Absolute file paths, copied into the conversation workdir. */
  attachments: string[];
  /** Absolute directory paths, read in place — never copied. */
  folders: string[];
  /** null starts a new conversation; otherwise continues an existing one. */
  conversationId: string | null;
  /**
   * Hosted deck this conversation prepares (run from the deck editor).
   * Absent/null means the run targets the open local .openroom file.
   */
  deckId?: string | null;
  /** Vendor model id from the picker; absent/null uses the host's default. */
  model?: string | null;
  /**
   * Task profile for the API-key host: a narrow prompt, tool allowlist and cheap
   * model for a small ask. Absent/unknown runs the full agent.
   */
  profile?: AgentTaskProfileId | null;
}

export type AgentRunResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: string; conversationId: string | null };

export interface McpStdioCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const AGENT_HOSTS: Record<AgentHostId, AgentHostInfo> = {
  claude: {
    id: 'claude',
    name: 'Claude',
    installUrl: 'https://claude.ai/download',
    experimental: false,
  },
  codex: {
    id: 'codex',
    name: 'ChatGPT',
    installUrl: 'https://github.com/openai/codex',
    experimental: false,
  },
  byok: {
    id: 'byok',
    name: 'API key',
    installUrl: '',
    experimental: false,
  },
};

export const AGENT_HOST_ORDER: AgentHostId[] = ['claude', 'codex', 'byok'];
