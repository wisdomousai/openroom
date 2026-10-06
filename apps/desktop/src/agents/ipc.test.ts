import { describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';

import { AGENT_CHANNELS } from './channels.js';
import { createAskQuestionBroker } from './ask-question.js';
import { mcpStdioCommand, registerAgentIpc, type AgentIpcDeps } from './ipc.js';
import type { AgentHostRunner, AgentRunnerMap, HostTurnInput } from './runner.js';
import { createAgentKeyStore, NO_KEYCHAIN_MESSAGE, type AgentKeyStore } from './keys.js';
import type { AgentSession, AgentSessionStore } from './session-store.js';
import type { AgentHostStatus, AgentRunRequest } from './types.js';

vi.mock('electron', () => ({ dialog: {}, shell: { openExternal: vi.fn() } }));

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function fakeIpc(): { ipc: IpcMain; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipc: {
      handle: (channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      },
    } as unknown as IpcMain,
  };
}

function fakeSenderEvent(id = 1) {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  return {
    sent,
    event: { sender: { id, send: (channel: string, payload: unknown) => sent.push({ channel, payload }), isDestroyed: () => false } },
  };
}

function hostStatus(overrides: Partial<AgentHostStatus> = {}): AgentHostStatus {
  return {
    id: 'claude',
    name: 'Claude',
    installUrl: 'https://claude.ai/download',
    experimental: false,
    binary: 'claude',
    installed: true,
    signedIn: true,
    loginAvailable: true,
    runtimeVersion: null,
    detail: null,
    ...overrides,
  };
}

function fakeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'conv-1',
    deckKey: 'deck:one',
    host: 'claude',
    modelId: null,
    workdir: {
      path: '/runs/conv-1',
      attachmentsDir: '/runs/conv-1/attachments',
      attachmentNames: [],
      claudeMcpConfigPath: '/runs/conv-1/mcp.json',
    },
    resumeId: null,
    folders: [],
    newAttachmentPaths: [],
    newFolders: [],
    firstTurn: true,
    messages: [],
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    persistence: Promise.resolve(),
    ...overrides,
  };
}

function fakeStore(session: AgentSession) {
  const resetDecks: string[] = [];
  const store: AgentSessionStore = {
    acquire: vi.fn(async (_senderId: number, _deckKey: string, request: AgentRunRequest) => {
      if (request.conversationId === session.id) {
        session.firstTurn = false;
        return session;
      }
      return session;
    }),
    load: vi.fn(async () => ({ active: null, history: [] })),
    codexHandoff: vi.fn(async () => ({ workdir: session.workdir.path, resumeId: session.resumeId, modelId: session.modelId })),
    select: vi.fn(async () => ({ active: null, history: [] })),
    reset: vi.fn(async (_senderId, deckKey) => {
      resetDecks.push(deckKey);
      return { active: null, history: [] };
    }),
    beginTurn: vi.fn(async () => undefined),
    recordEvent: vi.fn(),
    finishTurn: vi.fn(async () => undefined),
    recordResume: async (target, resumeId) => {
      if (resumeId !== null) target.resumeId = resumeId;
    },
    dispose: vi.fn(async () => undefined),
    disposeSender: vi.fn(async () => undefined),
    disposeAll: vi.fn(async () => undefined),
  };
  return { store, resetDecks };
}

function register(options: {
  hosts?: AgentHostStatus[];
  runner?: AgentHostRunner;
  session?: AgentSession;
  keys?: AgentKeyStore;
  askBroker?: import('./ask-question.js').AskQuestionBroker;
}) {
  const { ipc, handlers } = fakeIpc();
  const session = options.session ?? fakeSession();
  const { store, resetDecks } = fakeStore(session);
  const turns: HostTurnInput[] = [];
  const runner: AgentHostRunner =
    options.runner ??
    {
      runTurn(input) {
        turns.push(input);
        return { cancel: vi.fn(), done: Promise.resolve({ ok: true, sessionId: 'sess-1' }) };
      },
    };
  const runners: AgentRunnerMap = { claude: runner, codex: runner, byok: runner };
  const deps: AgentIpcDeps = {
    userData: () => '/user-data',
    skillsRoot: () => '/skills',
    mcpSocketPath: () => '/tmp/mcp.sock',
    mcpStdioPath: () => '/app/mcp-stdio.js',
    electronExecPath: () => '/app/electron',
    deckKey: (_sender, deckId) => deckId === null ? 'file:one' : `deck:${deckId}`,
    getSenderWindow: () => null,
    runners,
    detector: { list: async () => options.hosts ?? [hostStatus()], invalidate: vi.fn() },
    store,
    ...(options.keys === undefined ? {} : { keys: options.keys }),
    ...(options.askBroker === undefined ? {} : { askBroker: options.askBroker }),
  };
  registerAgentIpc(ipc, deps);
  return { handlers, session, store, turns, resetDecks };
}

function runRequest(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return { host: 'claude', prompt: 'Make an exit ticket', attachments: [], folders: [], conversationId: null, ...overrides };
}

describe('agent IPC', () => {
  it('lists saved provider metadata without unlocking the keychain, but still requires encryption to save', async () => {
    const safeStorage = vi.fn(() => null);
    const keys = createAgentKeyStore({
      file: () => '/user-data/agent-keys.json',
      safeStorage,
      env: {},
      readFile: async () => JSON.stringify({ version: 1, providers: { google: { secret: 'sealed-test-value' } } }),
      writeFile: async () => { throw new Error('Must not write a plaintext credential'); },
    });
    const { handlers } = register({ keys });
    const { event } = fakeSenderEvent();
    const result = await handlers.get(AGENT_CHANNELS.listKeys)?.(event);
    expect(result).toMatchObject({ providers: expect.arrayContaining([
      { providerId: 'google', hasKey: true, accountId: null, fromEnv: false },
      { providerId: 'openai', hasKey: false, accountId: null, fromEnv: false },
    ]) });
    expect(safeStorage).not.toHaveBeenCalled();
    await expect(handlers.get(AGENT_CHANNELS.setKey)?.(event, 'openai', { apiKey: 'test-only' })).rejects.toThrow(NO_KEYCHAIN_MESSAGE);
    expect(safeStorage).toHaveBeenCalled();
  });

  it('starts the sidebar MCP sidecar with deck_preview denied', () => {
    const command = mcpStdioCommand({
      userData: () => '/user-data',
      skillsRoot: () => '/skills',
      mcpSocketPath: () => '/tmp/mcp.sock',
      mcpStdioPath: () => '/app/mcp-stdio.js',
      electronExecPath: () => '/app/electron',
      deckKey: () => 'file:one',
      getSenderWindow: () => null,
    });
    expect(command.args).toEqual([
      '/app/mcp-stdio.js', '--socket', '/tmp/mcp.sock', '--deny-tool', 'deck_preview',
    ]);
  });

  it('denies ask_question as well when asked, for the Codex terminal handoff', () => {
    const command = mcpStdioCommand({
      userData: () => '/user-data',
      skillsRoot: () => '/skills',
      mcpSocketPath: () => '/tmp/mcp.sock',
      mcpStdioPath: () => '/app/mcp-stdio.js',
      electronExecPath: () => '/app/electron',
      deckKey: () => 'file:one',
      getSenderWindow: () => null,
    }, ['ask_question']);
    expect(command.args).toEqual([
      '/app/mcp-stdio.js', '--socket', '/tmp/mcp.sock',
      '--deny-tool', 'deck_preview', '--deny-tool', 'ask_question',
    ]);
  });

  it('rejects a run when the host is not signed in', async () => {
    const { handlers } = register({ hosts: [hostStatus({ signedIn: false })] });
    const { event } = fakeSenderEvent();
    await expect(handlers.get(AGENT_CHANNELS.run)?.(event, runRequest())).rejects.toThrow('Sign in to Claude first.');
  });

  it('loads and selects chat history using the deck identity from main', async () => {
    const { handlers, store } = register({});
    const { event } = fakeSenderEvent();
    await handlers.get(AGENT_CHANNELS.load)?.(event, 'deck-9');
    await handlers.get(AGENT_CHANNELS.select)?.(event, 'conv-1', 'deck-9');
    expect(store.load).toHaveBeenCalledWith('deck:deck-9');
    expect(store.select).toHaveBeenCalledWith('deck:deck-9', 'conv-1');
  });

  it('runs a turn, forwards events, and returns the conversation id', async () => {
    const runner: AgentHostRunner = {
      runTurn(input) {
        input.onEvent({ kind: 'text', text: 'Drafting.' });
        return { cancel: vi.fn(), done: Promise.resolve({ ok: true, sessionId: 'sess-1' }) };
      },
    };
    const { handlers, session } = register({ runner });
    const { event, sent } = fakeSenderEvent();
    const result = await handlers.get(AGENT_CHANNELS.run)?.(event, runRequest());
    expect(result).toEqual({ ok: true, conversationId: session.id });
    expect(session.resumeId).toBe('sess-1');
    expect(sent.map((item) => item.channel)).toEqual([AGENT_CHANNELS.event, AGENT_CHANNELS.event]);
    expect(sent.at(0)?.payload).toEqual({ kind: 'status', text: 'Preparing…' });
    expect(sent.at(-1)?.payload).toEqual({ kind: 'text', text: 'Drafting.' });
  });

  it('feeds the recorded resume id into the next turn of the same conversation', async () => {
    const { handlers, session, turns } = register({});
    const { event } = fakeSenderEvent();
    await handlers.get(AGENT_CHANNELS.run)?.(event, runRequest());
    await handlers.get(AGENT_CHANNELS.run)?.(event, runRequest({ conversationId: session.id }));
    expect(turns[0]?.resume).toBeNull();
    expect(turns[1]?.resume).toBe('sess-1');
  });

  it('rejects a second run while one is in flight, then allows the next', async () => {
    let release: (value: { ok: true; sessionId: string | null }) => void = () => undefined;
    const runner: AgentHostRunner = {
      runTurn: () => ({
        cancel: vi.fn(),
        done: new Promise((resolve) => {
          release = resolve;
        }),
      }),
    };
    const { handlers } = register({ runner });
    const { event } = fakeSenderEvent();
    const first = handlers.get(AGENT_CHANNELS.run)?.(event, runRequest()) as Promise<unknown>;
    await expect(handlers.get(AGENT_CHANNELS.run)?.(event, runRequest())).rejects.toThrow(
      'A preparation is already running.',
    );
    release({ ok: true, sessionId: null });
    await first;
  });

  it('returns failures without also broadcasting an error event', async () => {
    const runner: AgentHostRunner = {
      runTurn: () => ({ cancel: vi.fn(), done: Promise.resolve({ ok: false, error: 'rate limited' }) }),
    };
    const { handlers, session } = register({ runner });
    const { event, sent } = fakeSenderEvent();
    const result = await handlers.get(AGENT_CHANNELS.run)?.(event, runRequest());
    expect(result).toEqual({ ok: false, error: 'rate limited', conversationId: session.id });
    expect(sent.filter((item) => (item.payload as { kind: string }).kind === 'error')).toEqual([]);
  });

  it('refuses an API-key turn with no key stored, and never starts the runner', async () => {
    const runTurn = vi.fn();
    const byok = hostStatus({ id: 'byok', name: 'API key', binary: '', signedIn: false, loginAvailable: false });
    const { handlers } = register({ runner: { runTurn }, hosts: [byok] });
    const { event } = fakeSenderEvent();
    await expect(handlers.get(AGENT_CHANNELS.run)?.(event, runRequest({ host: 'byok' }))).rejects.toThrow(
      'Add an API key first.',
    );
    expect(runTurn).not.toHaveBeenCalled();
  });

  it('replays prior turns to the API-key host without repeating the current prompt', async () => {
    const session = fakeSession({
      firstTurn: false,
      messages: [
        { role: 'tutor', text: 'Make an exit ticket', attachments: [], folders: [] },
        { role: 'agent', parts: [{ kind: 'text', text: 'Saved version 3.' }], pending: false },
        // beginTurn pushes this turn's message and a pending placeholder before runTurn.
        { role: 'tutor', text: 'Now add a warm-up', attachments: [], folders: [] },
        { role: 'agent', parts: [], pending: true },
      ],
    });
    const byok = hostStatus({ id: 'byok', name: 'API key', binary: '' });
    const { handlers, turns } = register({ session, hosts: [byok] });
    const { event } = fakeSenderEvent();
    await handlers.get(AGENT_CHANNELS.run)?.(event, runRequest({ host: 'byok', prompt: 'Now add a warm-up' }));
    expect(turns[0]?.transcript).toEqual([
      { role: 'tutor', text: 'Make an exit ticket', attachments: [], folders: [] },
      { role: 'agent', parts: [{ kind: 'text', text: 'Saved version 3.' }], pending: false },
    ]);
  });

  it('cancel stops the in-flight turn', async () => {
    const cancel = vi.fn();
    let started: () => void = () => undefined;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runner: AgentHostRunner = {
      runTurn: () => {
        started();
        return { cancel, done: new Promise(() => undefined) };
      },
    };
    const { handlers } = register({ runner });
    const { event } = fakeSenderEvent();
    void handlers.get(AGENT_CHANNELS.run)?.(event, runRequest());
    await didStart;
    handlers.get(AGENT_CHANNELS.cancel)?.(event);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('answers an ask_question from the pane and rejects it on cancel', async () => {
    const broker = createAskQuestionBroker();
    let started: () => void = () => undefined;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runner: AgentHostRunner = {
      runTurn: () => {
        started();
        return { cancel: vi.fn(), done: new Promise(() => undefined) };
      },
    };
    const { handlers } = register({ runner, askBroker: broker });
    const { event, sent } = fakeSenderEvent();
    void handlers.get(AGENT_CHANNELS.run)?.(event, runRequest());
    await didStart;

    const asking = broker.ask({
      questions: [{ prompt: 'Which level?', options: [{ label: 'A1' }, { label: 'B1' }] }],
    });
    const question = sent.map((item) => item.payload).find((payload) => (payload as { kind?: string }).kind === 'question') as {
      id: string;
      questions: Array<{ id: string; options: Array<{ id: string }> }>;
    };
    expect(question.questions[0]?.id).toBe('q1');

    const answered = handlers.get(AGENT_CHANNELS.answer)?.(event, {
      id: question.id,
      answers: [{ questionId: 'q1', optionIds: [question.questions[0]!.options[1]!.id] }],
    });
    expect(answered).toEqual({ ok: true });
    await expect(asking).resolves.toEqual([{ questionId: 'q1', optionIds: [question.questions[0]!.options[1]!.id] }]);

    const second = broker.ask({
      questions: [{ prompt: 'Keep going?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    });
    handlers.get(AGENT_CHANNELS.cancel)?.(event);
    await expect(second).rejects.toThrow('Cancelled.');
  });

  it('reset archives the active deck chat without deleting its workspace', async () => {
    const { handlers, resetDecks } = register({});
    const { event } = fakeSenderEvent(7);
    await handlers.get(AGENT_CHANNELS.reset)?.(event, 'deck-7');
    expect(resetDecks).toEqual(['deck:deck-7']);
  });
});
