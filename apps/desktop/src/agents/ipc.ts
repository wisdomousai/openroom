import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IpcMain, WebContents } from 'electron';
import * as electron from 'electron';
import { dialog, shell } from 'electron';

import { AGENT_CHANNELS } from './channels.js';
import { ASK_QUESTION_TOOL_NAME, createAskQuestionBroker, type AskQuestionBroker } from './ask-question.js';
import { createHostDetector, isHostSignedIn, systemAsyncDetectDeps, systemDetectDeps, type HostDetector } from './detect.js';
import { byokModels } from './byok-models.js';
import { createClaudeRunner } from './hosts/claude.js';
import { createCodexRunner } from './hosts/codex.js';
import { createByokRunner, createByokWarmer, type ByokRunnerDeps } from './hosts/byok.js';
import { agentFollowUpPrompt, agentUserPrompt, memoizedByokSystemPrompt } from './instructions.js';
import { createAgentKeyStore, defaultKeyFile, isByokProviderId, type AgentKeyStore, type ByokCredential, type ByokProviderId } from './keys.js';
import { byokModelResolver } from './providers.js';
import { startCliLogin } from './login.js';
import { createModelCatalog, listClaudeModels, listCodexModels, type AgentModelCatalog } from './models.js';
import { codexOpenScript } from './open-in-codex.js';
import { createPastedImageStore, type PastedImage, type PastedImageStore } from './pasted.js';
import { agentTaskProfile, FULL_TASK_PROFILE, type AgentTaskProfileId } from './profiles.js';
import { routeAgentProfile, type AgentRouterDeps } from './router.js';
import { createAgentSessionStore, isConversationId, type AgentSessionStore } from './session-store.js';
import type { AgentRunnerMap } from './runner.js';
import { AGENT_HOST_ORDER } from './types.js';
import type {
  AgentEvent,
  AgentChatMessage,
  AgentHostId,
  AgentRunRequest,
  AgentRunResult,
  AgentWorkspaceSnapshot,
  McpStdioCommand,
} from './types.js';

export interface AgentIpcDeps {
  userData(): string;
  skillsRoot(): string;
  mcpSocketPath(): string;
  mcpStdioPath(): string;
  electronExecPath(): string;
  deckKey(sender: WebContents, deckId: string | null): string;
  getSenderWindow(sender: WebContents): Electron.BrowserWindow | null;
  runners?: AgentRunnerMap;
  keys?: AgentKeyStore;
  detector?: HostDetector;
  store?: AgentSessionStore;
  models?: AgentModelCatalog;
  pasted?: PastedImageStore;
  router?: AgentRouterDeps;
  askBroker?: AskQuestionBroker;
}

/** Context for the router: what the agent last said, not the whole thread. */
function lastAgentText(messages: AgentChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== 'agent') continue;
    const text = message.parts
      .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
      .join(' ')
      .trim();
    if (text !== '') return text;
  }
  return null;
}

const LOGIN_ARGS: Record<AgentHostId, string[]> = {
  claude: ['auth', 'login', '--claudeai'],
  codex: ['login'],
  // The API-key host signs in by storing a key, not by running a CLI.
  byok: [],
};

const LOGIN_MISSING: Record<AgentHostId, string> = {
  claude: 'Claude Code is not installed.',
  codex: 'Codex CLI is not installed.',
  byok: 'Add an API key in Agent settings instead.',
};

/**
 * Paths the tutor chose in this window's native dialogs, or pasted as images.
 * The renderer hands them back with a run, but only main decides which of them
 * the agent may read or be given as a folder.
 */
export interface PickedPaths {
  files: Set<string>;
  folders: Set<string>;
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`Invalid ${field}.`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null || typeof value === 'string') return value;
  throw new Error(`Invalid ${field}.`);
}

/**
 * The run request as main accepts it: every attachment and folder was picked
 * in this window, and the conversation id is one this store minted. Anything
 * else is refused before a path reaches the workdir or an agent host.
 */
export function checkedRunRequest(raw: unknown, picked: PickedPaths): AgentRunRequest {
  const request = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const host = request['host'];
  if (!AGENT_HOST_ORDER.includes(host as AgentHostId)) throw new Error('Unknown agent host.');
  const prompt = request['prompt'];
  if (typeof prompt !== 'string') throw new Error('Invalid prompt.');
  const attachments = stringList(request['attachments'], 'attachments');
  const folders = stringList(request['folders'], 'folders');
  if (attachments.some((path) => !picked.files.has(path))) {
    throw new Error('Attach files with the attach button.');
  }
  if (folders.some((path) => !picked.folders.has(path))) {
    throw new Error('Choose reference folders with the folder button.');
  }
  const conversationId = request['conversationId'] ?? null;
  if (conversationId !== null && !isConversationId(conversationId)) throw new Error('Chat not found for this deck.');
  const deckId = optionalString(request['deckId'], 'deck');
  const deckTitle = optionalString(request['deckTitle'], 'deck title');
  const model = optionalString(request['model'], 'model');
  const profile = optionalString(request['profile'], 'profile');
  return {
    host: host as AgentHostId,
    prompt,
    attachments,
    folders,
    conversationId,
    ...(deckId === undefined ? {} : { deckId }),
    ...(deckTitle === undefined || deckTitle === null ? {} : { deckTitle: deckTitle.slice(0, 200) }),
    ...(model === undefined ? {} : { model }),
    ...(profile === undefined ? {} : { profile: profile as AgentRunRequest['profile'] }),
  };
}

/**
 * The sidecar every embedded host talks to. With ask_question available (the
 * pane), account-level openroom_api writes wait for the tutor's confirmation
 * there. The Codex terminal handoff denies ask_question and confirms each tool
 * call in Codex's own prompt instead.
 */
export function mcpStdioCommand(deps: AgentIpcDeps, denyTools: readonly string[] = []): McpStdioCommand {
  return {
    command: deps.electronExecPath(),
    args: [
      deps.mcpStdioPath(),
      '--socket',
      deps.mcpSocketPath(),
      ...['deck_preview', ...denyTools].flatMap((tool) => ['--deny-tool', tool]),
      ...(denyTools.includes(ASK_QUESTION_TOOL_NAME) ? [] : ['--confirm-api']),
    ],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

export interface AgentIpcHandle {
  store: AgentSessionStore;
}

/**
 * The one preparation a window runs. Main owns it: the pane reads it back
 * through the workspace snapshot, so a pane that remounts mid-run, or opens
 * on another deck, shows the run instead of guessing.
 */
interface RunSlot {
  deckKey: string;
  deckTitle: string | null;
  /** Null until the store has acquired the conversation. */
  conversationId: string | null;
  /** The live transcript, ahead of what has been written to disk. */
  messages: AgentChatMessage[] | null;
  cancel: () => void;
  /** Resolves when the run handler has settled the turn and freed the slot. */
  settled: Promise<void>;
}

function busyDeckMessage(slot: RunSlot, deckKey: string): string {
  if (slot.deckKey === deckKey) return 'A preparation is already running for this deck.';
  return slot.deckTitle === null
    ? 'A preparation is running on another deck. Stop it to prepare this deck.'
    : `A preparation is running on “${slot.deckTitle}”. Stop it to prepare this deck.`;
}

/**
 * Add the window's run state to a deck's snapshot. The in-flight conversation
 * keeps its last agent message pending, so a remounted pane resumes streaming.
 */
export function withRunState(
  workspace: AgentWorkspaceSnapshot,
  deckKey: string,
  slot: RunSlot | undefined,
): AgentWorkspaceSnapshot {
  if (slot === undefined) return { ...workspace, run: null };
  if (slot.deckKey !== deckKey) return { ...workspace, run: { state: 'busy', deckTitle: slot.deckTitle } };
  const active = workspace.active;
  const live = active !== null && active.id === slot.conversationId && slot.messages !== null;
  return {
    ...workspace,
    active: live
      ? {
          ...active,
          messages: slot.messages!.map((message) =>
            message.role === 'agent' ? { ...message, parts: [...message.parts] } : { ...message },
          ),
        }
      : active,
    run: { state: 'running', conversationId: slot.conversationId },
  };
}

export function registerAgentIpc(ipc: IpcMain, deps: AgentIpcDeps): AgentIpcHandle {
  const syncDetect = systemDetectDeps();
  const keys =
    deps.keys ??
    createAgentKeyStore({
      file: () => defaultKeyFile(deps.userData()),
      safeStorage: () => electron.safeStorage ?? null,
    });
  const detector =
    deps.detector ??
    createHostDetector(systemAsyncDetectDeps({ byokConfigured: () => keys.configured() }));
  const store =
    deps.store ??
    createAgentSessionStore({
      runsRoot: () => join(deps.userData(), 'agent-runs'),
      workspacesRoot: () => join(deps.userData(), 'agent-workspaces'),
      skillsRoot: deps.skillsRoot,
      mcp: () => mcpStdioCommand(deps),
    });
  const byokDeps: ByokRunnerDeps = {
    resolveModel: byokModelResolver(keys),
    systemPrompt: memoizedByokSystemPrompt(deps.skillsRoot),
  };
  const runners: AgentRunnerMap = deps.runners ?? {
    claude: createClaudeRunner(),
    codex: createCodexRunner(),
    byok: createByokRunner(byokDeps),
  };
  const warmByok = createByokWarmer(byokDeps);
  const routerDeps: AgentRouterDeps = deps.router ?? { resolveModel: byokDeps.resolveModel };
  /**
   * The profile each conversation is running under. Follow-up turns read it
   * instead of routing again, so a thread cannot change prompt and tools
   * between turns.
   */
  const conversationProfiles = new Map<string, AgentTaskProfileId>();
  const models =
    deps.models ??
    createModelCatalog({
      cacheFile: join(deps.userData(), 'agent-models.json'),
      sources: {
        claude: () => listClaudeModels(deps.userData()),
        codex: async () => {
          const hosts = await detector.list();
          return listCodexModels(hosts.find((host) => host.id === 'codex')?.binary ?? 'codex');
        },
      },
    });
  const pasted =
    deps.pasted ?? createPastedImageStore({ dir: () => join(deps.userData(), 'agent-pastes') });
  const askBroker = deps.askBroker ?? createAskQuestionBroker();
  const logins = new Map<number, () => void>();
  const runs = new Map<number, RunSlot>();
  // Keyed by the window's WebContents, so a closed window's picks go with it.
  const picks = new WeakMap<WebContents, PickedPaths>();
  const pickedBy = (sender: WebContents): PickedPaths => {
    let picked = picks.get(sender);
    if (picked === undefined) {
      picked = { files: new Set(), folders: new Set() };
      picks.set(sender, picked);
    }
    return picked;
  };

  ipc.handle(AGENT_CHANNELS.list, () => detector.list());

  /**
   * BYOK models are not routed through the shared catalog: it caches per host for
   * a day, so a key added today would not show its models until tomorrow.
   */
  ipc.handle(AGENT_CHANNELS.models, (_event, host: AgentHostId) =>
    host === 'byok' ? byokModels(keys) : models.list(host),
  );

  ipc.handle(AGENT_CHANNELS.listKeys, async () => ({
    // Listing configuration must not unlock the OS keychain. On macOS that
    // synchronous check can wait for a prompt and block the first editor window.
    // set/resolve check secure storage when an actual credential is needed.
    providers: await keys.list(),
  }));

  ipc.handle(AGENT_CHANNELS.setKey, async (_event, provider: string, credential: ByokCredential) => {
    if (!isByokProviderId(provider)) throw new Error(`Unknown provider "${provider}".`);
    await keys.set(provider, {
      apiKey: String(credential?.apiKey ?? ''),
      ...(credential?.accountId === undefined ? {} : { accountId: String(credential.accountId) }),
    });
    detector.invalidate();
    return { ok: true };
  });

  ipc.handle(AGENT_CHANNELS.clearKey, async (_event, provider: string) => {
    if (!isByokProviderId(provider)) throw new Error(`Unknown provider "${provider}".`);
    await keys.clear(provider as ByokProviderId);
    detector.invalidate();
    return { ok: true };
  });

  ipc.handle(AGENT_CHANNELS.login, async (event, host: AgentHostId) => {
    const win = deps.getSenderWindow(event.sender);
    if (win === null) throw new Error('Window closed');
    logins.get(event.sender.id)?.();
    const hosts = await detector.list();
    const status = hosts.find((item) => item.id === host);
    const bin = status?.binary ?? host;
    if (host === 'byok') throw new Error(LOGIN_MISSING.byok);
    await new Promise<void>((resolve, reject) => {
      const cancel = startCliLogin({
        bin,
        args: LOGIN_ARGS[host],
        signedIn: () => isHostSignedIn(host, syncDetect),
        missingBinaryMessage: LOGIN_MISSING[host],
        openUrl: (url) => {
          void shell.openExternal(url);
        },
        onOutput: (line) => event.sender.send(AGENT_CHANNELS.loginOutput, { host, line }),
        onSuccess: () => {
          logins.delete(event.sender.id);
          detector.invalidate();
          resolve();
        },
        onError: (err) => {
          logins.delete(event.sender.id);
          reject(err);
        },
      });
      logins.set(event.sender.id, () => {
        cancel();
        reject(new Error('Sign-in cancelled.'));
      });
    });
    return { ok: true };
  });

  ipc.handle(AGENT_CHANNELS.pickAttachments, async (event) => {
    const win = deps.getSenderWindow(event.sender);
    const options = { properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> };
    const result = win === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options);
    if (result.canceled) return [];
    for (const path of result.filePaths) pickedBy(event.sender).files.add(path);
    return result.filePaths;
  });

  ipc.handle(AGENT_CHANNELS.pickFolders, async (event) => {
    const win = deps.getSenderWindow(event.sender);
    const options = { properties: ['openDirectory', 'multiSelections'] as Array<'openDirectory' | 'multiSelections'> };
    const result = win === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options);
    if (result.canceled) return [];
    for (const path of result.filePaths) pickedBy(event.sender).folders.add(path);
    return result.filePaths;
  });

  /**
   * Pasted or dropped images: bytes in, path out. They then travel as ordinary
   * attachments, so nothing else in the run path needs to know about them.
   */
  ipc.handle(AGENT_CHANNELS.savePasted, async (event, images: PastedImage[]) => {
    if (!Array.isArray(images)) return [];
    const saved = await Promise.all(
      images.map((image) =>
        pasted
          .save({ type: String(image.type), name: image.name, bytes: new Uint8Array(image.bytes) })
          .catch(() => null),
      ),
    );
    const paths = saved.filter((path): path is string => path !== null);
    for (const path of paths) pickedBy(event.sender).files.add(path);
    return paths;
  });

  // Run state is read after the store's awaits, right before the reply, so a
  // snapshot never reports a run that already settled.
  ipc.handle(AGENT_CHANNELS.load, async (event, deckId?: string | null) => {
    const deckKey = deps.deckKey(event.sender, deckId ?? null);
    const workspace = await store.load(deckKey);
    return withRunState(workspace, deckKey, runs.get(event.sender.id));
  });

  ipc.handle(AGENT_CHANNELS.select, async (event, conversationId: unknown, deckId?: string | null) => {
    if (!isConversationId(conversationId)) throw new Error('Chat not found for this deck.');
    const deckKey = deps.deckKey(event.sender, deckId ?? null);
    const workspace = await store.select(deckKey, conversationId);
    return withRunState(workspace, deckKey, runs.get(event.sender.id));
  });

  ipc.handle(AGENT_CHANNELS.run, async (event, raw: unknown): Promise<AgentRunResult> => {
    const request = checkedRunRequest(raw, pickedBy(event.sender));
    const deckKey = deps.deckKey(event.sender, request.deckId ?? null);
    const existing = runs.get(event.sender.id);
    // Returned rather than thrown: Electron wraps a thrown message in its own text.
    if (existing !== undefined) return { ok: false, error: busyDeckMessage(existing, deckKey), conversationId: null };
    // Claim the slot before any await so a rapid second send cannot slip past the guard.
    let cancelled = false;
    let settle: () => void = () => undefined;
    const slot: RunSlot = {
      deckKey,
      deckTitle: request.deckTitle ?? null,
      conversationId: null,
      messages: null,
      cancel: () => {
        cancelled = true;
      },
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    runs.set(event.sender.id, slot);
    let session: Awaited<ReturnType<AgentSessionStore['acquire']>> | null = null;
    let beganTurn = false;
    try {
      const hosts = await detector.list();
      const host = hosts.find((item) => item.id === request.host);
      if (host === undefined || !host.installed) throw new Error(`${request.host} CLI is not installed.`);
      if (!host.signedIn) {
        throw new Error(
          request.host === 'byok' ? 'Add an API key first.' : `Sign in to ${host.name} first.`,
        );
      }

      session = await store.acquire(event.sender.id, deckKey, request);
      slot.conversationId = session.id;
      await store.beginTurn(session, request);
      slot.messages = session.messages;
      beganTurn = true;
      if (cancelled) return { ok: false, error: 'Cancelled.', conversationId: session.id };
      const conversationId = session.id;
      // Events name their conversation, so a pane showing another chat ignores them.
      const send = (item: AgentEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(AGENT_CHANNELS.event, { ...item, conversationId });
      };
      const prompt = session.firstTurn
        ? agentUserPrompt(request.prompt, session.newAttachmentPaths, session.folders, request.deckId ?? null)
        : agentFollowUpPrompt(request.prompt, session.newAttachmentPaths, session.newFolders);
      const preparing = { kind: 'status' as const, text: 'Preparing…' };
      store.recordEvent(session, preparing);
      send(preparing);

      /**
       * An explicit profile is honoured; otherwise the router picks one. Only
       * the API-key host has profiles — the CLI hosts ignore the field, so
       * routing them would spend a call on nothing.
       */
      const profile = agentTaskProfile(
        request.profile ?? (request.host !== 'byok'
          ? null
          : await routeAgentProfile(routerDeps, {
              prompt: request.prompt,
              model: request.model ?? null,
              priorProfile: session.firstTurn
                ? null
                : (conversationProfiles.get(session.id) ?? FULL_TASK_PROFILE.id),
              lastAssistantText: lastAgentText(session.messages),
            })),
      );
      conversationProfiles.set(session.id, profile.id);
      // The renderer learns the profile from the transcript, like every other
      // fact about a turn; the full agent is the unmarked case and says nothing.
      if (profile.id !== FULL_TASK_PROFILE.id) {
        const running = { kind: 'status' as const, text: profile.title };
        store.recordEvent(session, running);
        send(running);
      }

      const onEvent = (item: AgentEvent) => {
        if (session !== null) store.recordEvent(session, item);
        send(item);
      };
      askBroker.beginRun(event.sender, onEvent);
      const turn = runners[request.host].runTurn({
        prompt,
        workdir: session.workdir.path,
        mcpConfigPath: session.workdir.claudeMcpConfigPath,
        mcp: mcpStdioCommand(deps),
        folders: session.folders,
        attachmentsDir: session.workdir.attachmentsDir,
        resume: session.resumeId,
        // beginTurn already pushed this turn's prompt and a pending agent
        // placeholder; replaying them would duplicate the prompt.
        transcript: session.messages.slice(0, -2),
        model: request.model ?? null,
        profile,
        onEvent,
      });
      slot.cancel = () => {
        askBroker.cancelRun(event.sender.id);
        turn.cancel();
      };
      const result = await turn.done;
      // Failures are returned, not also broadcast as an event — one error surface in the UI.
      if (!result.ok) return { ok: false, error: result.error, conversationId: session.id };
      await store.recordResume(session, result.sessionId);
      return { ok: true, conversationId: session.id };
    } finally {
      // Reject waiters while the agent message is still pending so the
      // cancelled question lands in the transcript, then settle the turn.
      askBroker.endRun(event.sender.id);
      if (session !== null && beganTurn) await store.finishTurn(session);
      if (runs.get(event.sender.id) === slot) runs.delete(event.sender.id);
      settle();
    }
  });

  /**
   * Continue this deck's conversation in the Codex CLI: same workdir, same MCP
   * sidecar to the open deck, same thread when one exists — but interactive,
   * so Codex asks before acting instead of running approval-free the way the
   * embedded pane does. The `.command` file is what macOS opens straight into
   * Terminal.
   */
  ipc.handle(AGENT_CHANNELS.openCodex, async (event, deckId?: string | null) => {
    if (process.platform !== 'darwin') {
      return { ok: false as const, error: 'Open in Codex is macOS-only for now.' };
    }
    const hosts = await detector.list();
    const codex = hosts.find((host) => host.id === 'codex');
    if (codex === undefined || !codex.installed) {
      return { ok: false as const, error: 'Codex CLI is not installed.' };
    }
    const handoff = await store.codexHandoff(deps.deckKey(event.sender, deckId ?? null));
    const script = codexOpenScript({
      bin: codex.binary,
      workdir: handoff.workdir,
      resumeId: handoff.resumeId,
      model: handoff.modelId,
      // ask_question waits on the agent pane, which a terminal session does
      // not have — Codex asks inline there, so hide the tool entirely.
      mcp: mcpStdioCommand(deps, ['ask_question']),
    });
    const scriptPath = join(handoff.workdir, 'open-in-codex.command');
    await writeFile(scriptPath, script, 'utf8');
    await chmod(scriptPath, 0o755);
    const failure = await shell.openPath(scriptPath);
    return failure === '' ? { ok: true as const } : { ok: false as const, error: failure };
  });

  /**
   * Writes the API-key host's static prefix into the provider's cache before the
   * tutor's first turn does. Resolves ok whatever happens — the renderer fires
   * this and forgets, and a warm-up failure is not a thing to report.
   *
   * No deck workspace exists yet at pane mount, so the sidecar runs from the app's
   * user-data folder. It reaches the open file over `--socket`, not the cwd, and
   * the cwd is not part of the prefix.
   */
  ipc.handle(AGENT_CHANNELS.warmup, async (_event, model?: string | null) => {
    await warmByok({
      model: model ?? null,
      workdir: deps.userData(),
      folders: [],
      mcp: mcpStdioCommand(deps),
    });
    return { ok: true };
  });

  /**
   * Stop is per window: it stops the one run the window holds, on whichever
   * deck. It resolves once that run has settled (or after a few seconds), so a
   * pane that offered Stop for another deck can read the freed slot right after.
   */
  ipc.handle(AGENT_CHANNELS.cancel, async (event) => {
    logins.get(event.sender.id)?.();
    logins.delete(event.sender.id);
    const slot = runs.get(event.sender.id);
    if (slot !== undefined) {
      slot.cancel();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        slot.settled,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 5000);
        }),
      ]);
      clearTimeout(timer);
    }
    return { ok: true };
  });

  /** New chat for one deck. It stops a run only when that run belongs to the same deck. */
  ipc.handle(AGENT_CHANNELS.reset, async (event, deckId?: string | null) => {
    const deckKey = deps.deckKey(event.sender, deckId ?? null);
    const slot = runs.get(event.sender.id);
    if (slot !== undefined && slot.deckKey === deckKey) {
      askBroker.endRun(event.sender.id);
      slot.cancel();
    }
    await pasted.clear();
    const workspace = await store.reset(event.sender.id, deckKey);
    return withRunState(workspace, deckKey, runs.get(event.sender.id));
  });

  ipc.handle(AGENT_CHANNELS.answer, (_event, payload: { id?: unknown; answers?: unknown }) => {
    if (typeof payload?.id !== 'string') return { ok: false as const, error: 'Missing question id.' };
    return askBroker.answer(payload.id, payload.answers);
  });

  return { store };
}
