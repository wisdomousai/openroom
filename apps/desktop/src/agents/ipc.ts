import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IpcMain, WebContents } from 'electron';
import * as electron from 'electron';
import { dialog, shell } from 'electron';

import { AGENT_CHANNELS } from './channels.js';
import { createAskQuestionBroker, type AskQuestionBroker } from './ask-question.js';
import { createHostDetector, isCodexSignedIn, systemAsyncDetectDeps, systemDetectDeps, type HostDetector } from './detect.js';
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
import { createAgentSessionStore, type AgentSessionStore } from './session-store.js';
import type { AgentRunnerMap } from './runner.js';
import type { AgentEvent, AgentChatMessage, AgentHostId, AgentRunRequest, AgentRunResult, McpStdioCommand } from './types.js';

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

/** What each host needs before a turn can run. Only Codex has a sign-in flow. */
const HOST_NOT_READY: Record<AgentHostId, string> = {
  claude: 'Add an Anthropic API key first.',
  codex: 'Sign in to ChatGPT first.',
  byok: 'Add an API key first.',
};

export function mcpStdioCommand(deps: AgentIpcDeps, denyTools: readonly string[] = []): McpStdioCommand {
  return {
    command: deps.electronExecPath(),
    args: [
      deps.mcpStdioPath(),
      '--socket',
      deps.mcpSocketPath(),
      ...['deck_preview', ...denyTools].flatMap((tool) => ['--deny-tool', tool]),
    ],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

export interface AgentIpcHandle {
  store: AgentSessionStore;
}

export function registerAgentIpc(ipc: IpcMain, deps: AgentIpcDeps): AgentIpcHandle {
  const syncDetect = systemDetectDeps();
  const keys =
    deps.keys ??
    createAgentKeyStore({
      file: () => defaultKeyFile(deps.userData()),
      safeStorage: () => electron.safeStorage ?? null,
    });
  /** One Anthropic key serves both the Claude host and the API-key host's Anthropic provider. */
  const anthropicKey = async (): Promise<string | null> => (await keys.resolve('anthropic'))?.apiKey ?? null;
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
    claude: createClaudeRunner({ apiKey: anthropicKey }),
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
        claude: async () => {
          const apiKey = await anthropicKey();
          return apiKey === null ? [] : listClaudeModels(deps.userData(), apiKey);
        },
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
  const runs = new Map<number, { cancel: () => void }>();

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
    if (host !== 'codex') throw new Error(HOST_NOT_READY[host]);
    await new Promise<void>((resolve, reject) => {
      const cancel = startCliLogin({
        bin,
        args: ['login'],
        signedIn: () => isCodexSignedIn(syncDetect),
        missingBinaryMessage: 'Codex CLI is not installed.',
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
    return result.filePaths;
  });

  ipc.handle(AGENT_CHANNELS.pickFolders, async (event) => {
    const win = deps.getSenderWindow(event.sender);
    const options = { properties: ['openDirectory', 'multiSelections'] as Array<'openDirectory' | 'multiSelections'> };
    const result = win === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options);
    if (result.canceled) return [];
    return result.filePaths;
  });

  /**
   * Pasted or dropped images: bytes in, path out. They then travel as ordinary
   * attachments, so nothing else in the run path needs to know about them.
   */
  ipc.handle(AGENT_CHANNELS.savePasted, async (_event, images: PastedImage[]) => {
    if (!Array.isArray(images)) return [];
    const saved = await Promise.all(
      images.map((image) =>
        pasted
          .save({ type: String(image.type), name: image.name, bytes: new Uint8Array(image.bytes) })
          .catch(() => null),
      ),
    );
    return saved.filter((path): path is string => path !== null);
  });

  ipc.handle(AGENT_CHANNELS.load, (event, deckId?: string | null) =>
    store.load(deps.deckKey(event.sender, deckId ?? null)),
  );

  ipc.handle(AGENT_CHANNELS.select, (event, conversationId: string, deckId?: string | null) =>
    store.select(deps.deckKey(event.sender, deckId ?? null), conversationId),
  );

  ipc.handle(AGENT_CHANNELS.run, async (event, request: AgentRunRequest): Promise<AgentRunResult> => {
    const existing = runs.get(event.sender.id);
    if (existing !== undefined) throw new Error('A preparation is already running.');
    // Claim the slot before any await so a rapid second send cannot slip past the guard.
    let cancelled = false;
    runs.set(event.sender.id, {
      cancel: () => {
        cancelled = true;
      },
    });
    let session: Awaited<ReturnType<AgentSessionStore['acquire']>> | null = null;
    let beganTurn = false;
    try {
      const hosts = await detector.list();
      const host = hosts.find((item) => item.id === request.host);
      if (host === undefined || !host.installed) {
        throw new Error(host?.detail ?? `${request.host} CLI is not installed.`);
      }
      if (!host.signedIn) throw new Error(HOST_NOT_READY[request.host]);

      const deckKey = deps.deckKey(event.sender, request.deckId ?? null);
      session = await store.acquire(event.sender.id, deckKey, request);
      await store.beginTurn(session, request);
      beganTurn = true;
      if (cancelled) return { ok: false, error: 'Cancelled.', conversationId: session.id };
      const prompt = session.firstTurn
        ? agentUserPrompt(request.prompt, session.newAttachmentPaths, session.folders, request.deckId ?? null)
        : agentFollowUpPrompt(request.prompt, session.newAttachmentPaths, session.newFolders);
      const preparing = { kind: 'status' as const, text: 'Preparing…' };
      store.recordEvent(session, preparing);
      event.sender.send(AGENT_CHANNELS.event, preparing);

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
        event.sender.send(AGENT_CHANNELS.event, running);
      }

      const onEvent = (item: AgentEvent) => {
        if (session !== null) store.recordEvent(session, item);
        if (!event.sender.isDestroyed()) event.sender.send(AGENT_CHANNELS.event, item);
      };
      askBroker.beginRun(event.sender, onEvent);
      const turn = runners[request.host].runTurn({
        prompt,
        workdir: session.workdir.path,
        mcpConfigPath: session.workdir.claudeMcpConfigPath,
        mcp: mcpStdioCommand(deps),
        folders: session.folders,
        resume: session.resumeId,
        // beginTurn already pushed this turn's prompt and a pending agent
        // placeholder; replaying them would duplicate the prompt.
        transcript: session.messages.slice(0, -2),
        model: request.model ?? null,
        profile,
        onEvent,
      });
      runs.set(event.sender.id, {
        cancel: () => {
          askBroker.cancelRun(event.sender.id);
          turn.cancel();
        },
      });
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
      runs.delete(event.sender.id);
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

  ipc.handle(AGENT_CHANNELS.cancel, (event) => {
    logins.get(event.sender.id)?.();
    logins.delete(event.sender.id);
    runs.get(event.sender.id)?.cancel();
    return { ok: true };
  });

  ipc.handle(AGENT_CHANNELS.reset, async (event, deckId?: string | null) => {
    askBroker.endRun(event.sender.id);
    runs.get(event.sender.id)?.cancel();
    runs.delete(event.sender.id);
    await pasted.clear();
    return store.reset(event.sender.id, deps.deckKey(event.sender, deckId ?? null));
  });

  ipc.handle(AGENT_CHANNELS.answer, (_event, payload: { id?: unknown; answers?: unknown }) => {
    if (typeof payload?.id !== 'string') return { ok: false as const, error: 'Missing question id.' };
    return askBroker.answer(payload.id, payload.answers);
  });

  return { store };
}
