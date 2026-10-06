import type { PresentCursor } from './presenter/cursor';
import type { OpenRoomFileResourceV1 } from '@openroom/schema';

export interface DesktopDocumentSnapshot {
  path: string | null;
  displayName: string;
  source: string | null;
  recoverySource: string | null;
  deviceId: string;
  deviceName: string;
  onlineOrigin: string;
}

export interface DesktopDisplay {
  id: string;
  label: string;
  primary: boolean;
  external: boolean;
}

export interface DesktopPresentationState {
  source: string;
  cursor: PresentCursor;
  listening?: { stepId: string; mode: 'room' | 'individual'; transcriptShown: boolean };
  live?: { sessionCode: string; stageToken: string };
}

export type DesktopPresentationCommand = 'next' | 'previous' | 'close';

export type DesktopAgentHostId = 'claude' | 'codex' | 'byok';

export type DesktopByokProviderId =
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'mistral'
  | 'groq'
  | 'openrouter'
  | 'cloudflare';

export interface DesktopAgentHost {
  id: DesktopAgentHostId;
  name: string;
  installUrl: string;
  experimental: boolean;
  binary: string;
  installed: boolean;
  signedIn: boolean;
  loginAvailable: boolean;
  runtimeVersion: string | null;
  detail: string | null;
}

export interface DesktopAgentKeyStatus {
  providerId: DesktopByokProviderId;
  hasKey: boolean;
  accountId: string | null;
  /** Supplied through the environment: shown, but not editable here. */
  fromEnv: boolean;
}

export interface DesktopAgentKeys {
  /** Metadata only: listing providers never unlocks the OS keychain. */
  providers: DesktopAgentKeyStatus[];
}

export type DesktopAgentEvent =
  | { kind: 'text' | 'thinking' | 'tool' | 'status' | 'error'; text: string }
  | {
      kind: 'question';
      id: string;
      questions: DesktopAgentQuestion[];
      answers?: DesktopAgentQuestionAnswer[];
      cancelled?: boolean;
    };

export interface DesktopAgentQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface DesktopAgentQuestion {
  id: string;
  prompt: string;
  header?: string;
  multiSelect?: boolean;
  options: DesktopAgentQuestionOption[];
}

export interface DesktopAgentQuestionAnswer {
  questionId: string;
  optionIds: string[];
  text?: string;
}

export interface DesktopAgentConversationSnapshot {
  id: string;
  hostId: DesktopAgentHostId;
  modelId: string | null;
  messages: Array<
    | { role: 'tutor'; text: string; attachments: string[]; folders: string[] }
    | { role: 'agent'; parts: DesktopAgentEvent[]; pending: boolean }
  >;
}

export interface DesktopAgentConversationSummary {
  id: string;
  hostId: DesktopAgentHostId;
  preview: string;
  updatedAt: string;
}

export interface DesktopAgentWorkspaceSnapshot {
  active: DesktopAgentConversationSnapshot | null;
  history: DesktopAgentConversationSummary[];
}

/** Kept in step with AgentTaskProfileId in the desktop app; the bridge imports nothing from it. */
export type DesktopAgentTaskProfileId = 'add-image' | 'add-exercise' | 'full';

export interface DesktopAgentRunRequest {
  host: DesktopAgentHostId;
  prompt: string;
  attachments: string[];
  folders: string[];
  conversationId: string | null;
  /** Hosted deck to prepare (deck editor runs); null targets the open local file. */
  deckId?: string | null;
  /** Vendor model id from the picker; absent/null uses the host's default. */
  model?: string | null;
  /**
   * Task profile for the API-key host: a narrow prompt, tool allowlist and cheap
   * model for a small ask. Absent/unknown runs the full agent.
   */
  profile?: DesktopAgentTaskProfileId | null;
}

export interface DesktopPastedImage {
  type: string;
  name?: string;
  bytes: Uint8Array;
}

export interface DesktopAgentModel {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

export type DesktopAgentRunResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: string; conversationId: string | null };

export interface DesktopDocumentChanged {
  path: string | null;
  displayName: string;
  source: string;
}

export interface OpenRoomDesktopBridge {
  /** Control-plane origin Electron is pointed at (LAN IP when using `bun desktop`). */
  controlOrigin: string;
  /** Whether this window is bound to a file; false in the workspace window. */
  hasDocument(): Promise<boolean>;
  getDocument(): Promise<DesktopDocumentSnapshot>;
  saveDocument(source: string): Promise<DesktopDocumentSnapshot>;
  saveDocumentAs(source: string): Promise<DesktopDocumentSnapshot | null>;
  saveRecovery(fileId: string, source: string): Promise<void>;
  clearRecovery(fileId: string): Promise<void>;
  openFile(): Promise<void>;
  newFile(): Promise<void>;
  pickImage(): Promise<{ resourceId: string; resource: OpenRoomFileResourceV1 } | null>;
  pickAudio(): Promise<{ resourceId: string; resource: OpenRoomFileResourceV1 } | null>;
  pickPdf(): Promise<{ selectionId: string; name: string; pageCount: number } | null>;
  extractPdf(
    selectionId: string,
    fromPage: number,
    toPage: number,
  ): Promise<{ resourceId: string; resource: OpenRoomFileResourceV1 }>;
  /** Page range as bytes, for decks that keep media in a space's asset store. */
  extractPdfBytes(
    selectionId: string,
    fromPage: number,
    toPage: number,
  ): Promise<{ name: string; bytes: Uint8Array }>;
  readResource(resourceId: string): Promise<Uint8Array>;
  showInFolder(): Promise<void>;
  listDisplays(): Promise<DesktopDisplay[]>;
  startPresentation(state: DesktopPresentationState, displayId?: string): Promise<void>;
  updatePresentation(state: DesktopPresentationState): Promise<void>;
  closePresentation(): Promise<void>;
  getPresentation(): Promise<DesktopPresentationState | null>;
  sendPresentationCommand(command: DesktopPresentationCommand): void;
  onPresentationState(listener: (state: DesktopPresentationState | null) => void): () => void;
  onPresentationCommand(listener: (command: DesktopPresentationCommand) => void): () => void;
  onDocumentChanged(listener: (change: DesktopDocumentChanged) => void): () => void;
  /** An agent stamped a version of this hosted deck (embedded pane or Codex terminal). */
  onDeckSaved(listener: (event: { deckId: string }) => void): () => void;
  openSignIn(): Promise<{ ok: true }>;
  listAgentHosts(): Promise<DesktopAgentHost[]>;
  loginAgentHost(host: DesktopAgentHostId): Promise<{ ok: true }>;
  listAgentKeys(): Promise<DesktopAgentKeys>;
  setAgentKey(
    provider: DesktopByokProviderId,
    credential: { apiKey: string; accountId?: string },
  ): Promise<{ ok: true }>;
  clearAgentKey(provider: DesktopByokProviderId): Promise<{ ok: true }>;
  pickAgentAttachments(): Promise<string[]>;
  pickAgentFolders(): Promise<string[]>;
  /** Writes pasted or dropped images to disk and returns their paths (never uploaded). */
  saveAgentPastedImages(images: DesktopPastedImage[]): Promise<string[]>;
  listAgentModels(host: DesktopAgentHostId): Promise<DesktopAgentModel[]>;
  loadAgentChat(deckId?: string | null): Promise<DesktopAgentWorkspaceSnapshot>;
  selectAgentChat(conversationId: string, deckId?: string | null): Promise<DesktopAgentWorkspaceSnapshot>;
  runAgent(request: DesktopAgentRunRequest): Promise<DesktopAgentRunResult>;
  /**
   * Opens the deck's conversation in the Codex CLI (Terminal): same workdir and
   * MCP sidecar, same thread when one exists, with the CLI's own approvals.
   */
  openAgentInCodex(deckId?: string | null): Promise<{ ok: true } | { ok: false; error: string }>;
  /** API-key host only: pre-writes the prompt cache for one model. Fire and forget. */
  warmAgentCache(model: string | null): Promise<{ ok: true }>;
  cancelAgent(): Promise<{ ok: true }>;
  resetAgentChat(deckId?: string | null): Promise<DesktopAgentWorkspaceSnapshot>;
  answerAgentQuestion(payload: {
    id: string;
    answers: DesktopAgentQuestionAnswer[];
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  onAgentEvent(listener: (event: DesktopAgentEvent) => void): () => void;
  onAgentLoginOutput(listener: (event: { host: DesktopAgentHostId; line: string }) => void): () => void;
}

declare global {
  interface Window {
    openroomDesktop?: OpenRoomDesktopBridge;
  }
}

export function desktopBridge(): OpenRoomDesktopBridge | null {
  return window.openroomDesktop ?? null;
}
