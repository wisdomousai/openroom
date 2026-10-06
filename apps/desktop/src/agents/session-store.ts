import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type {
  AgentChatMessage,
  AgentConversationSnapshot,
  AgentEvent,
  AgentHostId,
  AgentRunRequest,
  AgentWorkspaceSnapshot,
  McpStdioCommand,
} from './types.js';
import { nextAgentParts } from './types.js';
import { addAttachments, createAgentWorkdir, removeAgentWorkdir, type AgentWorkdir } from './workdir.js';

interface PersistedConversation {
  version: 1;
  id: string;
  deckKey: string;
  hostId: AgentHostId;
  modelId: string | null;
  resumeId: string | null;
  folders: string[];
  messages: AgentChatMessage[];
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceIndex {
  version: 1;
  deckKey: string;
  activeConversationId: string | null;
  conversationIds: string[];
}

export interface AgentSession {
  id: string;
  deckKey: string;
  host: AgentHostId;
  modelId: string | null;
  workdir: AgentWorkdir;
  /** Claude session_id / Codex thread id, null until the first turn finishes. */
  resumeId: string | null;
  /** Union of folders referenced so far in the conversation. */
  folders: string[];
  /** Attachment paths copied in by the latest acquire (new files only on reuse). */
  newAttachmentPaths: string[];
  /** Folders first referenced by the latest acquire. */
  newFolders: string[];
  firstTurn: boolean;
  messages: AgentChatMessage[];
  createdAt: string;
  updatedAt: string;
  persistence: Promise<void>;
}

export interface AgentSessionStoreDeps {
  /** Temporary attachment copies. This root is swept at startup. */
  runsRoot(): string;
  /** Persistent deck workspaces, transcripts, and vendor resume handles. */
  workspacesRoot(): string;
  skillsRoot(): string;
  mcp(): McpStdioCommand;
}

export interface AgentCodexHandoff {
  workdir: string;
  resumeId: string | null;
  modelId: string | null;
}

export interface AgentSessionStore {
  acquire(senderId: number, deckKey: string, request: AgentRunRequest): Promise<AgentSession>;
  /**
   * The deck workspace as the Codex CLI needs it: the (created) workdir, plus
   * the active conversation's thread id and model when that conversation is
   * Codex's own — a Claude thread cannot be resumed by another vendor.
   */
  codexHandoff(deckKey: string): Promise<AgentCodexHandoff>;
  load(deckKey: string): Promise<AgentWorkspaceSnapshot>;
  select(deckKey: string, conversationId: string): Promise<AgentWorkspaceSnapshot>;
  reset(senderId: number, deckKey: string): Promise<AgentWorkspaceSnapshot>;
  beginTurn(session: AgentSession, request: AgentRunRequest): Promise<void>;
  recordEvent(session: AgentSession, event: AgentEvent): void;
  finishTurn(session: AgentSession): Promise<void>;
  recordResume(session: AgentSession, resumeId: string | null): Promise<void>;
  dispose(senderId: number, conversationId: string): Promise<void>;
  disposeSender(senderId: number): Promise<void>;
  disposeAll(): Promise<void>;
}

function workspaceSlug(deckKey: string): string {
  return createHash('sha256').update(deckKey).digest('hex');
}

function workspaceDir(root: string, deckKey: string): string {
  return join(root, workspaceSlug(deckKey));
}

function indexPath(root: string, deckKey: string): string {
  return join(workspaceDir(root, deckKey), 'workspace.json');
}

function conversationPath(root: string, deckKey: string, id: string): string {
  return join(workspaceDir(root, deckKey), 'conversations', `${id}.json`);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

function emptyIndex(deckKey: string): WorkspaceIndex {
  return { version: 1, deckKey, activeConversationId: null, conversationIds: [] };
}

function snapshot(conversation: PersistedConversation): AgentConversationSnapshot {
  return {
    id: conversation.id,
    hostId: conversation.hostId,
    modelId: conversation.modelId,
    messages: conversation.messages.map((message) =>
      message.role === 'agent' ? { ...message, pending: false, parts: [...message.parts] } : { ...message },
    ),
  };
}

function persisted(session: AgentSession): PersistedConversation {
  return {
    version: 1,
    id: session.id,
    deckKey: session.deckKey,
    hostId: session.host,
    modelId: session.modelId,
    resumeId: session.resumeId,
    folders: session.folders,
    messages: session.messages,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function createAgentSessionStore(deps: AgentSessionStoreDeps): AgentSessionStore {
  const senders = new Map<number, Map<string, AgentSession>>();

  const sessionsOf = (senderId: number): Map<string, AgentSession> => {
    let sessions = senders.get(senderId);
    if (sessions === undefined) {
      sessions = new Map();
      senders.set(senderId, sessions);
    }
    return sessions;
  };

  const readIndex = async (deckKey: string): Promise<WorkspaceIndex> =>
    (await readJson<WorkspaceIndex>(indexPath(deps.workspacesRoot(), deckKey))) ?? emptyIndex(deckKey);

  const writeIndex = async (index: WorkspaceIndex): Promise<void> =>
    atomicJson(indexPath(deps.workspacesRoot(), index.deckKey), index);

  const readConversation = (deckKey: string, id: string): Promise<PersistedConversation | null> =>
    readJson<PersistedConversation>(conversationPath(deps.workspacesRoot(), deckKey, id));

  const queuePersist = (session: AgentSession): Promise<void> => {
    const value = persisted(session);
    session.persistence = session.persistence.then(() =>
      atomicJson(conversationPath(deps.workspacesRoot(), session.deckKey, session.id), value),
    );
    return session.persistence;
  };

  const workspaceSnapshot = async (deckKey: string): Promise<AgentWorkspaceSnapshot> => {
    const index = await readIndex(deckKey);
    const conversations = (
      await Promise.all(index.conversationIds.map((id) => readConversation(deckKey, id)))
    ).filter((item): item is PersistedConversation => item !== null && item.deckKey === deckKey);
    conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const active = conversations.find((item) => item.id === index.activeConversationId) ?? null;
    return {
      active: active === null ? null : snapshot(active),
      history: conversations.map((item) => ({
        id: item.id,
        hostId: item.hostId,
        preview: item.messages.find((message) => message.role === 'tutor')?.text.slice(0, 80) ?? 'New chat',
        updatedAt: item.updatedAt,
      })),
    };
  };

  const runtimeSession = async (
    deckKey: string,
    conversation: PersistedConversation,
    request: AgentRunRequest,
    firstTurn: boolean,
  ): Promise<AgentSession> => {
    const temporaryRoot = join(deps.runsRoot(), conversation.id);
    const workdir = await createAgentWorkdir({
      root: join(workspaceDir(deps.workspacesRoot(), deckKey), 'work'),
      attachmentsRoot: temporaryRoot,
      attachments: request.attachments,
      skillsRoot: deps.skillsRoot(),
      mcp: deps.mcp(),
    });
    const newFolders = request.folders.filter((folder) => !conversation.folders.includes(folder));
    const folders = [...conversation.folders, ...newFolders];
    const now = new Date().toISOString();
    return {
      id: conversation.id,
      deckKey,
      host: conversation.hostId,
      modelId: request.model === undefined ? conversation.modelId : request.model,
      workdir,
      resumeId: conversation.resumeId,
      folders,
      newAttachmentPaths: workdir.attachmentNames.map((name) => join(workdir.attachmentsDir, name)),
      newFolders,
      firstTurn,
      messages: conversation.messages.map((message) =>
        message.role === 'agent' ? { ...message, pending: false, parts: [...message.parts] } : { ...message },
      ),
      createdAt: conversation.createdAt,
      updatedAt: now,
      persistence: Promise.resolve(),
    };
  };

  return {
    async acquire(senderId, deckKey, request) {
      const sessions = sessionsOf(senderId);
      const existing = request.conversationId === null ? undefined : sessions.get(request.conversationId);
      if (existing !== undefined && existing.deckKey === deckKey && existing.host === request.host) {
        const names = await addAttachments(existing.workdir.attachmentsDir, request.attachments);
        existing.newAttachmentPaths = names.map((name) => join(existing.workdir.attachmentsDir, name));
        existing.newFolders = request.folders.filter((folder) => !existing.folders.includes(folder));
        existing.folders.push(...existing.newFolders);
        existing.modelId = request.model === undefined ? existing.modelId : request.model;
        existing.firstTurn = false;
        existing.updatedAt = new Date().toISOString();
        await queuePersist(existing);
        return existing;
      }

      let conversation =
        request.conversationId === null ? null : await readConversation(deckKey, request.conversationId);
      if (conversation !== null && conversation.hostId !== request.host) conversation = null;
      const now = new Date().toISOString();
      conversation ??= {
        version: 1,
        id: randomUUID(),
        deckKey,
        hostId: request.host,
        modelId: request.model ?? null,
        resumeId: null,
        folders: [],
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      const session = await runtimeSession(deckKey, conversation, request, conversation.messages.length === 0);
      sessions.set(session.id, session);
      const index = await readIndex(deckKey);
      index.activeConversationId = session.id;
      if (!index.conversationIds.includes(session.id)) index.conversationIds.push(session.id);
      await Promise.all([writeIndex(index), queuePersist(session)]);
      return session;
    },

    load: workspaceSnapshot,

    async codexHandoff(deckKey) {
      const workdir = await createAgentWorkdir({
        root: join(workspaceDir(deps.workspacesRoot(), deckKey), 'work'),
        attachmentsRoot: join(deps.runsRoot(), 'codex-handoff'),
        attachments: [],
        skillsRoot: deps.skillsRoot(),
        mcp: deps.mcp(),
      });
      const index = await readIndex(deckKey);
      const active =
        index.activeConversationId === null
          ? null
          : await readConversation(deckKey, index.activeConversationId);
      const codexOwned = active !== null && active.hostId === 'codex';
      return {
        workdir: workdir.path,
        resumeId: codexOwned ? active.resumeId : null,
        modelId: codexOwned ? active.modelId : null,
      };
    },

    async select(deckKey, conversationId) {
      const index = await readIndex(deckKey);
      if (!index.conversationIds.includes(conversationId)) throw new Error('Chat not found for this deck.');
      index.activeConversationId = conversationId;
      await writeIndex(index);
      return workspaceSnapshot(deckKey);
    },

    async reset(senderId, deckKey) {
      const sessions = senders.get(senderId);
      if (sessions !== undefined) {
        for (const [id, session] of sessions) {
          if (session.deckKey !== deckKey) continue;
          sessions.delete(id);
          await removeAgentWorkdir(join(deps.runsRoot(), id));
        }
      }
      const index = await readIndex(deckKey);
      index.activeConversationId = null;
      await writeIndex(index);
      return workspaceSnapshot(deckKey);
    },

    async beginTurn(session, request) {
      session.messages.push(
        {
          role: 'tutor',
          text: request.prompt,
          attachments: request.attachments.map((path) => basename(path)),
          folders: request.folders,
        },
        { role: 'agent', parts: [], pending: true },
      );
      session.updatedAt = new Date().toISOString();
      await queuePersist(session);
    },

    recordEvent(session, event) {
      const message = session.messages.at(-1);
      if (message === undefined || message.role !== 'agent' || !message.pending) return;
      message.parts = nextAgentParts(message.parts, event);
      session.updatedAt = new Date().toISOString();
      void queuePersist(session);
    },

    async finishTurn(session) {
      const message = session.messages.at(-1);
      if (message?.role === 'agent' && message.pending) {
        if (message.parts.length === 0) session.messages.pop();
        else message.pending = false;
      }
      session.updatedAt = new Date().toISOString();
      await queuePersist(session);
    },

    async recordResume(session, resumeId) {
      if (resumeId !== null) session.resumeId = resumeId;
      await queuePersist(session);
    },

    async dispose(senderId, conversationId) {
      const sessions = senders.get(senderId);
      const session = sessions?.get(conversationId);
      if (sessions === undefined || session === undefined) return;
      sessions.delete(conversationId);
      await removeAgentWorkdir(join(deps.runsRoot(), conversationId));
    },

    async disposeSender(senderId) {
      const sessions = senders.get(senderId);
      if (sessions === undefined) return;
      senders.delete(senderId);
      for (const session of sessions.values()) {
        await session.persistence;
        await removeAgentWorkdir(join(deps.runsRoot(), session.id));
      }
    },

    async disposeAll() {
      for (const senderId of [...senders.keys()]) await this.disposeSender(senderId);
    },
  };
}

/** Crash hygiene: temporary attachment copies must not outlive the app. */
export async function sweepAgentRuns(runsRoot: string): Promise<void> {
  await rm(runsRoot, { recursive: true, force: true });
}
