import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type {
  DesktopAgentConversationSummary,
  DesktopAgentHost,
  DesktopAgentHostId,
  DesktopAgentKeys,
  DesktopAgentModel,
  DesktopAgentQuestionAnswer,
  DesktopAgentRunResult,
  DesktopByokProviderId,
} from '../desktop-bridge';
import { useEditorServices } from '../services';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './ai-elements/conversation';
import { Loader } from './ai-elements/loader';
import { Message, MessageResponse } from './ai-elements/message';
import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from './ai-elements/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './ai-elements/reasoning';
import { Button } from '@openroom/ui/components/button';
import { Input } from '@openroom/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@openroom/ui/components/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@openroom/ui/components/select';
import { cn } from '@openroom/ui/utils';
import { Check, FolderOpen, Paperclip, Settings2 } from 'lucide-react';
import {
  agentChatStore,
  applyAgentEvent,
  beginTurn,
  finishTurn,
  isPendingQuestion,
  preferredModelId,
  resetChat,
  restoreChat,
  selectHost,
  selectModel,
  storeHostId,
  storeModelId,
  storedHostId,
  type AgentChatMessage,
} from './agent-chat';
import { agentToolActivity } from './agent-tool-activity';
import { AgentQuestionCard } from './AgentQuestionCard';

function baseName(path: string): string {
  return path.split(/[/\\]/).at(-1) ?? path;
}

/**
 * Mirrors the desktop provider catalog. Duplicated rather than imported: the host
 * app is a browser bundle and must not reach into the Electron main process.
 */
const BYOK_PROVIDERS: { id: DesktopByokProviderId; label: string; keysUrl: string; note: string; needsAccountId?: true }[] = [
  { id: 'openai', label: 'OpenAI', keysUrl: 'https://platform.openai.com/api-keys', note: 'Paid per token.' },
  { id: 'google', label: 'Google', keysUrl: 'https://aistudio.google.com/apikey', note: 'Free tier with daily limits.' },
  { id: 'anthropic', label: 'Anthropic', keysUrl: 'https://console.anthropic.com/settings/keys', note: 'Paid per token.' },
  { id: 'mistral', label: 'Mistral', keysUrl: 'https://console.mistral.ai/api-keys', note: 'Free experiment tier.' },
  { id: 'groq', label: 'Groq', keysUrl: 'https://console.groq.com/keys', note: 'Free tier, rate-limited.' },
  { id: 'openrouter', label: 'OpenRouter', keysUrl: 'https://openrouter.ai/keys', note: 'One key, many models.' },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    keysUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    note: 'Daily free allowance. Token needs Account · Workers AI · Read.',
    needsAccountId: true,
  },
];

/**
 * Mirrors the desktop task-profile titles and the escalation status, duplicated
 * for the same reason the provider catalog above is: the host app is a browser
 * bundle and cannot reach into the Electron main process. A turn under a narrow
 * profile says so as an ordinary status event; the full agent is the unmarked
 * case and sends nothing.
 */
const AGENT_PROFILE_TITLES = ['Add image', 'Add exercise'];
const AGENT_ESCALATED_STATUS = 'escalated to full agent';
const AGENT_FULL_PROFILE_TITLE = 'Full agent';

function ChatMessage({
  message,
  onAnswer,
}: {
  message: AgentChatMessage;
  onAnswer?: (id: string, answers: DesktopAgentQuestionAnswer[]) => void;
}) {
  if (message.role === 'tutor') {
    return (
      <Message from="user" className="items-end gap-0.5">
        {/* Own bubble: the vendored MessageContent leans on bg-secondary, a token
            this theme deliberately does not register (see index.css). */}
        <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-accent px-2.5 py-1.5 text-caption">
          {message.text}
        </p>
        {message.attachments.length + message.folders.length > 0 ? (
          <p className="text-caption text-muted-foreground">
            {[...message.attachments.map(baseName), ...message.folders.map((path) => `${baseName(path)}/`)].join(', ')}
          </p>
        ) : null}
      </Message>
    );
  }
  const escalated = message.parts.some(
    (part) => part.kind === 'status' && part.text === AGENT_ESCALATED_STATUS,
  );
  return (
    <Message from="assistant" className="max-w-full gap-1">
      {message.parts.map((part, index) => {
        const key = `${part.kind}-${String(index)}`;
        if (part.kind === 'text') {
          return <MessageResponse key={key} className="text-caption">{part.text}</MessageResponse>;
        }
        if (part.kind === 'thinking') {
          return (
            <Reasoning
              key={key}
              className="w-full"
              defaultOpen={false}
              isStreaming={message.pending && index === message.parts.length - 1}
            >
              <ReasoningTrigger className="text-caption" />
              <ReasoningContent className="text-caption">{part.text}</ReasoningContent>
            </Reasoning>
          );
        }
        if (part.kind === 'tool') {
          const active = message.pending && index === message.parts.length - 1;
          const activity = agentToolActivity(part.text, active);
          if (activity === null) return null;
          return (
            <p key={key} className="flex items-center gap-1.5 font-sans text-caption text-muted-foreground">
              {active ? (
                <Loader size={12} aria-label="In progress" />
              ) : (
                <Check size={12} aria-hidden="true" />
              )}
              <span>{activity}{active ? '…' : ''}</span>
            </p>
          );
        }
        if (part.kind === 'status') {
          const title = AGENT_PROFILE_TITLES.includes(part.text) ? part.text : null;
          if (title !== null || part.text === AGENT_ESCALATED_STATUS) {
            // One chip per turn: an escalation replaces the profile it left
            // rather than stacking a second chip under the same answer.
            if (title !== null && escalated) return null;
            return (
              <span
                key={key}
                className="w-fit rounded-md border border-border bg-background px-1.5 py-0.5 font-sans text-caption text-muted-foreground"
              >
                {title ?? AGENT_FULL_PROFILE_TITLE}
              </span>
            );
          }
        }
        if (part.kind === 'question') {
          return (
            <AgentQuestionCard
              key={key}
              id={part.id}
              questions={part.questions}
              answers={part.answers}
              cancelled={part.cancelled}
              interactive={message.pending && isPendingQuestion(part)}
              onAnswer={onAnswer}
            />
          );
        }
        return (
          <p
            key={key}
            role={part.kind === 'error' ? 'alert' : undefined}
            className={cn(
              'whitespace-pre-wrap text-caption',
              part.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {part.text}
          </p>
        );
      })}
      {message.pending && message.parts.length === 0 ? <Loader className="text-muted-foreground" /> : null}
    </Message>
  );
}

export function AgentPane({
  onBeforeRun,
  deckId = null,
  onAfterRun,
}: {
  onBeforeRun: () => Promise<boolean>;
  /** Hosted deck the chat prepares (deck editor); null targets the open local file. */
  deckId?: string | null;
  /** Called after a successful run so the mounting editor can adopt the agent's saves. */
  onAfterRun?: () => void;
}) {
  const bridge = useEditorServices().desktop;
  const chat = useSyncExternalStore(agentChatStore.subscribe, agentChatStore.getState, agentChatStore.getState);
  // The unsent prompt lives in the store, not here, so a surface elsewhere in
  // the editor can hand the agent something to work on.
  const prompt = chat.draft;
  const setPrompt = (next: string) => {
    agentChatStore.setState((current) => ({ ...current, draft: next }));
  };
  const [hosts, setHosts] = useState<DesktopAgentHost[]>([]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [signingIn, setSigningIn] = useState(false);
  const [keys, setKeys] = useState<DesktopAgentKeys | null>(null);
  const [keyProvider, setKeyProvider] = useState<DesktopByokProviderId>('google');
  const [keyValue, setKeyValue] = useState('');
  const [accountId, setAccountId] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [loginLines, setLoginLines] = useState<string[]>([]);
  const [models, setModels] = useState<Partial<Record<DesktopAgentHostId, DesktopAgentModel[]>>>({});
  const [history, setHistory] = useState<DesktopAgentConversationSummary[]>([]);
  const modelsLoading = useRef(new Set<DesktopAgentHostId>());

  const adoptWorkspace = (workspace: Awaited<ReturnType<NonNullable<typeof bridge>['loadAgentChat']>>) => {
    setHistory(workspace.history);
    agentChatStore.setState((current) =>
      restoreChat(workspace.active, { hostId: current.hostId, modelId: current.modelId, draft: current.draft }),
    );
  };

  useEffect(() => {
    if (bridge === null) return;
    let active = true;
    agentChatStore.setState((current) =>
      restoreChat(null, { hostId: current.hostId, modelId: current.modelId, draft: current.draft }),
    );
    void bridge.loadAgentChat(deckId).then((workspace) => {
      if (active) adoptWorkspace(workspace);
    });
    return () => {
      active = false;
    };
  }, [bridge, deckId]);

  const refresh = () => {
    if (bridge === null) return;
    void bridge.listAgentHosts().then((next) => {
      setHosts(next);
      agentChatStore.setState((current) => {
        if (current.hostId !== null && next.some((host) => host.id === current.hostId)) return current;
        const stored = storedHostId();
        const fallback =
          (stored !== null && next.some((host) => host.id === stored) ? stored : null) ??
          next.find((host) => host.installed)?.id ??
          next[0]?.id ??
          null;
        return fallback === null ? current : selectHost(current, fallback);
      });
    });
  };

  // Must live above the browser early-return: the effect below always registers,
  // and a const after `return null` is still in the TDZ when that effect runs.
  const refreshKeys = () => {
    if (bridge === null) return;
    void bridge.listAgentKeys().then(setKeys).catch(() => undefined);
  };

  useEffect(() => {
    refresh();
    refreshKeys();
  }, [bridge]);

  useEffect(() => {
    if (bridge === null) return;
    const offEvent = bridge.onAgentEvent((event) => {
      agentChatStore.setState((current) => applyAgentEvent(current, event));
    });
    const offLogin = bridge.onAgentLoginOutput((event) => {
      setLoginLines((current) => [...current.slice(-3), event.line]);
    });
    return () => {
      offEvent();
      offLogin();
    };
  }, [bridge]);

  /** First use fetches the host's own model list; the desktop caches it after that. */
  useEffect(() => {
    const host = hosts.find((candidate) => candidate.id === chat.hostId);
    if (bridge === null || host === undefined || !host.signedIn) return;
    if (models[host.id] !== undefined || modelsLoading.current.has(host.id)) return;
    modelsLoading.current.add(host.id);
    void bridge
      .listAgentModels(host.id)
      .then((list) => setModels((current) => ({ ...current, [host.id]: list })))
      .finally(() => modelsLoading.current.delete(host.id));
  }, [bridge, hosts, chat.hostId, models]);

  /**
   * An unset model is not "whatever the CLI defaults to": it is the machine's
   * last pick, falling back to our own per-host default (Luna for ChatGPT).
   * An explicit "Default model" pick is stored too and stays untouched here.
   */
  useEffect(() => {
    if (chat.hostId === null || chat.modelId !== null) return;
    const list = models[chat.hostId];
    if (list === undefined) return;
    const preferred = preferredModelId(chat.hostId, list);
    if (preferred !== null) agentChatStore.setState((current) => selectModel(current, preferred));
  }, [chat.hostId, chat.modelId, models]);

  /**
   * The API-key host re-sends a ~4k-token system prompt plus every MCP tool
   * schema on each turn, so the first turn of a conversation pays to write that
   * prefix into the provider's cache. Warming it while the tutor is still typing
   * moves that cost off the turn they are waiting on.
   *
   * Only the selected model: prompt caches are per-model everywhere, so warming
   * another one bills for an entry nothing will read. Only with a key in hand,
   * and only for the API-key host — the CLI hosts run their own caching.
   */
  useEffect(() => {
    if (bridge === null || chat.hostId !== 'byok' || chat.modelId === null) return;
    const providerId = chat.modelId.slice(0, chat.modelId.indexOf(':'));
    const hasKey = (keys?.providers ?? []).some(
      (provider) => provider.providerId === providerId && provider.hasKey,
    );
    if (!hasKey) return;
    void bridge.warmAgentCache(chat.modelId).catch(() => undefined);
  }, [bridge, chat.hostId, chat.modelId, keys]);

  if (bridge === null) return null;

  const selected = hosts.find((host) => host.id === chat.hostId) ?? null;
  const selectedModels = selected === null ? [] : (models[selected.id] ?? []);
  const selectedProvider = BYOK_PROVIDERS.find((provider) => provider.id === keyProvider) ?? null;
  const canSend = selected !== null && selected.installed && selected.signedIn && prompt.trim() !== '' && !chat.running;
  const hasConversation = chat.messages.length > 0;

  /**
   * Pasted or dropped images become real files in the desktop's scratch folder,
   * then join the turn as ordinary path attachments — same no-upload posture as
   * anything picked from the file dialog.
   */
  const addImages = async (list: FileList | File[] | null): Promise<boolean> => {
    const images = [...(list ?? [])].filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return false;
    const payload = await Promise.all(
      images.map(async (file) => ({
        type: file.type,
        name: file.name === '' ? undefined : file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    const paths = await bridge.saveAgentPastedImages(payload);
    if (paths.length > 0) setAttachments((current) => [...new Set([...current, ...paths])]);
    return paths.length > 0;
  };

  const send = async (text: string) => {
    if (selected === null) return;
    const ready = await onBeforeRun();
    if (!ready) {
      agentChatStore.setState((current) => ({ ...current, error: 'Repair or save the deck before preparing it.' }));
      return;
    }
    const turn = { prompt: text, attachments, folders };
    setAttachments([]);
    setFolders([]);
    agentChatStore.setState((current) => beginTurn(current, turn));
    let result: DesktopAgentRunResult;
    try {
      result = await bridge.runAgent({
        host: selected.id,
        prompt: turn.prompt,
        attachments: turn.attachments,
        folders: turn.folders,
        conversationId: agentChatStore.getState().conversationId,
        deckId,
        model: agentChatStore.getState().modelId,
      });
    } catch (cause) {
      result = {
        ok: false,
        error: cause instanceof Error ? cause.message : 'Could not start the agent.',
        conversationId: null,
      };
    }
    agentChatStore.setState((current) => finishTurn(current, result));
    void bridge.loadAgentChat(deckId).then((workspace) => setHistory(workspace.history));
    if (result.ok) onAfterRun?.();
    refresh();
  };

  const signIn = async () => {
    if (selected === null) return;
    setSigningIn(true);
    setLoginLines([]);
    try {
      await bridge.loginAgentHost(selected.id);
      refresh();
    } catch (cause) {
      agentChatStore.setState((current) => ({
        ...current,
        error: cause instanceof Error ? cause.message : 'Sign-in did not finish.',
      }));
    } finally {
      setSigningIn(false);
    }
  };

  /** The model list is per host, so adding or removing a key has to drop the cached rows. */
  const forgetByokModels = () => {
    setModels((current) => {
      const { byok: _dropped, ...rest } = current;
      return rest;
    });
  };

  const saveKey = async () => {
    if (keyValue.trim() === '') return;
    setSavingKey(true);
    agentChatStore.setState((current) => ({ ...current, error: null }));
    try {
      await bridge.setAgentKey(keyProvider, {
        apiKey: keyValue.trim(),
        ...(accountId.trim() === '' ? {} : { accountId: accountId.trim() }),
      });
      setKeyValue('');
      setAccountId('');
      forgetByokModels();
      refreshKeys();
      refresh();
    } catch (cause) {
      agentChatStore.setState((current) => ({
        ...current,
        error: cause instanceof Error ? cause.message : 'The API key could not be stored.',
      }));
    } finally {
      setSavingKey(false);
    }
  };

  const clearKey = async (provider: DesktopByokProviderId) => {
    await bridge.clearAgentKey(provider).catch(() => undefined);
    forgetByokModels();
    refreshKeys();
    refresh();
  };

  const newChat = async () => {
    const workspace = await bridge.resetAgentChat(deckId);
    setHistory(workspace.history);
    agentChatStore.setState(resetChat);
  };

  const openChat = async (conversationId: string) => {
    if (chat.running || conversationId === chat.conversationId) return;
    adoptWorkspace(await bridge.selectAgentChat(conversationId, deckId));
  };

  return (
    // Blue is the slide-design accent; inside the chat, focus chrome stays neutral.
    <aside className="flex w-[22rem] shrink-0 flex-col border-l border-border bg-chrome [--ring:var(--muted-foreground)]">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex flex-col gap-1">
          <h2 className="text-row-title">Agent</h2>
          <p className="text-caption text-muted-foreground">Claude, ChatGPT, or an API key.</p>
        </div>
        <div className="flex items-center gap-1">
          {selected?.id === 'codex' && selected.signedIn ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={chat.running}
              onClick={() => {
                void bridge.openAgentInCodex(deckId).then((result) => {
                  if (!result.ok) {
                    agentChatStore.setState((current) => ({ ...current, error: result.error }));
                  }
                });
              }}
            >
              Open in Codex
            </Button>
          ) : null}
          {hasConversation ? (
            <Button size="sm" variant="ghost" disabled={chat.running} onClick={() => void newChat()}>
              New chat
            </Button>
          ) : null}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" aria-label="Agent settings" className="px-2">
                <Settings2 aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-64 flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <p className="text-caption text-muted-foreground">Agent</p>
                <Select
                  value={chat.hostId ?? ''}
                  disabled={chat.running}
                  onValueChange={(id) => {
                    if (id === '' || id === chat.hostId) return;
                    if (hasConversation) {
                      void bridge.resetAgentChat(deckId).then((workspace) => setHistory(workspace.history));
                    }
                    storeHostId(id as DesktopAgentHostId);
                    agentChatStore.setState((current) => selectHost(current, id as DesktopAgentHostId));
                  }}
                >
                  <SelectTrigger aria-label="Agent" className="h-8 text-caption">
                    <SelectValue placeholder="Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {hosts.map((host) => (
                      <SelectItem key={host.id} value={host.id}>
                        {host.name}
                        {host.experimental ? ' · preview' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selected?.id === 'byok' ? (
                  <div className="flex flex-col gap-1.5">
                    {(keys?.providers ?? [])
                      .filter((provider) => provider.hasKey)
                      .map((provider) => {
                        const info = BYOK_PROVIDERS.find((item) => item.id === provider.providerId);
                        return (
                          <div key={provider.providerId} className="flex items-center justify-between gap-2">
                            <span className="truncate text-caption">{info?.label ?? provider.providerId}</span>
                            {provider.fromEnv ? (
                              <span className="text-caption text-muted-foreground">From environment</span>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={chat.running}
                                onClick={() => void clearKey(provider.providerId)}
                              >
                                Remove
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    <Select
                      value={keyProvider}
                      onValueChange={(value) => setKeyProvider(value as DesktopByokProviderId)}
                    >
                      <SelectTrigger aria-label="Provider" className="h-8 text-caption">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BYOK_PROVIDERS.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="password"
                      className="h-8 text-caption"
                      aria-label="API key"
                      placeholder="API key"
                      value={keyValue}
                      onChange={(event) => setKeyValue(event.target.value)}
                    />
                    {selectedProvider?.needsAccountId === true ? (
                      <Input
                        className="h-8 text-caption"
                        aria-label="Account ID"
                        placeholder="Account ID"
                        value={accountId}
                        onChange={(event) => setAccountId(event.target.value)}
                      />
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={savingKey || keyValue.trim() === ''}
                      onClick={() => void saveKey()}
                    >
                      {savingKey ? 'Saving…' : 'Save key'}
                    </Button>
                    <p className="text-caption text-muted-foreground">
                      {selectedProvider?.note}{' '}
                      <a
                        href={selectedProvider?.keysUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Get a key
                      </a>
                    </p>
                    <p className="text-caption text-muted-foreground">
                      The key stays on this computer in the OS keychain and goes only to that provider.
                    </p>
                  </div>
                ) : null}
              </div>
              {selected !== null && selected.signedIn && selectedModels.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-caption text-muted-foreground">Model</p>
                  <Select
                    value={chat.modelId ?? 'default'}
                    disabled={chat.running}
                    onValueChange={(value) => {
                      const modelId = value === 'default' ? null : value;
                      if (chat.hostId !== null) storeModelId(chat.hostId, modelId);
                      agentChatStore.setState((current) => selectModel(current, modelId));
                    }}
                  >
                    <SelectTrigger aria-label="Model" className="h-8 text-caption">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Radix Select forbids empty item values; 'default' stands in for null. */}
                      <SelectItem value="default">Default model</SelectItem>
                      {selectedModels.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {history.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-caption text-muted-foreground">Chats for this deck</p>
                  <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                    {history.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={chat.running}
                        className={cn(
                          'truncate rounded-md px-2 py-1 text-left text-caption hover:bg-accent',
                          item.id === chat.conversationId && 'bg-accent',
                        )}
                        onClick={() => void openChat(item.id)}
                      >
                        {item.preview}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Only blocking states show on the face; host and model live behind the gear. */}
      <div className={cn('flex-col gap-1.5 border-b border-border px-3 py-2', selected !== null && selected.signedIn ? 'hidden' : 'flex')}>
        {selected === null ? (
          <p className="text-caption text-muted-foreground">
            Sign in to Claude or ChatGPT, or add an API key in Agent settings.
          </p>
        ) : selected.id === 'byok' ? (
          <p className="text-caption text-muted-foreground">Add an API key in Agent settings.</p>
        ) : !selected.signedIn && !selected.loginAvailable ? (
          <div className="flex flex-col gap-1.5">
            {/* An outdated CLI reads as "not installed" unless the reason is spelled out. */}
            {selected.detail === null ? null : (
              <p className="text-caption text-muted-foreground">{selected.detail}</p>
            )}
            <a
              href={selected.installUrl}
              target="_blank"
              rel="noreferrer"
              className="text-caption text-primary underline-offset-4 hover:underline"
            >
              Install {selected.name}
            </a>
          </div>
        ) : !selected.signedIn ? (
          <div className="flex flex-col gap-1">
            <Button size="sm" variant="outline" disabled={signingIn} onClick={() => void signIn()}>
              {signingIn ? 'Waiting for sign-in…' : `Sign in to ${selected.name}`}
            </Button>
            {signingIn && loginLines.length > 0 ? (
              <p className="whitespace-pre-wrap text-caption text-muted-foreground">{loginLines.join('\n')}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <Conversation className="min-h-0 flex-1 bg-card">
        <ConversationContent className="gap-2.5 px-3 py-2" aria-live="polite">
          {chat.messages.length === 0 ? (
            <p className="text-caption text-muted-foreground">No messages yet.</p>
          ) : (
            chat.messages.map((message, index) => (
              <ChatMessage
                key={`${message.role}-${String(index)}`}
                message={message}
                onAnswer={
                  message.role === 'agent' && message.pending
                    ? (id, answers) => {
                        void bridge.answerAgentQuestion({ id, answers });
                      }
                    : undefined
                }
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div
        className="flex flex-col gap-2 border-t border-border px-3 py-2.5"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          void addImages(event.dataTransfer.files);
        }}
      >
        <PromptInput
          onSubmit={(message) => {
            const text = message.text.trim();
            if (!canSend || text === '') return;
            void send(text);
          }}
        >
        {attachments.length + folders.length > 0 ? (
          <PromptInputHeader>
          <ul className="flex flex-wrap gap-1">
            {attachments.map((path) => (
              <li key={path} className="flex items-center gap-1 rounded-md bg-background px-2 py-0.5 text-caption" title={path}>
                {baseName(path)}
                <button
                  type="button"
                  aria-label={`Remove ${baseName(path)}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setAttachments((current) => current.filter((item) => item !== path))}
                >
                  ×
                </button>
              </li>
            ))}
            {folders.map((path) => (
              <li key={path} className="flex items-center gap-1 rounded-md bg-background px-2 py-0.5 text-caption" title={path}>
                {baseName(path)}/
                <button
                  type="button"
                  aria-label={`Remove ${baseName(path)}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setFolders((current) => current.filter((item) => item !== path))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          </PromptInputHeader>
        ) : null}
          <PromptInputBody>
            <PromptInputTextarea
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              onPaste={(event) => {
                const files = [...event.clipboardData.files];
                if (files.some((file) => file.type.startsWith('image/'))) {
                  // Keep the clipboard's text form out of the box when it carried an image.
                  event.preventDefault();
                  void addImages(files);
                }
              }}
              placeholder="Message"
              disabled={chat.running}
              className="min-h-[3.5rem] text-caption"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger aria-label="Add files" disabled={chat.running}>
                  <Paperclip className="size-4" aria-hidden="true" />
                </PromptInputActionMenuTrigger>
                <PromptInputActionMenuContent>
                  <PromptInputActionMenuItem
                    onSelect={() => {
                      void bridge.pickAgentAttachments().then((paths) => {
                        if (paths.length > 0) setAttachments((current) => [...new Set([...current, ...paths])]);
                      });
                    }}
                  >
                    <Paperclip aria-hidden="true" /> Attach files
                  </PromptInputActionMenuItem>
                  <PromptInputActionMenuItem
                    onSelect={() => {
                      void bridge.pickAgentFolders().then((paths) => {
                        if (paths.length > 0) setFolders((current) => [...new Set([...current, ...paths])]);
                      });
                    }}
                  >
                    <FolderOpen aria-hidden="true" /> Reference folder
                  </PromptInputActionMenuItem>
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
            </PromptInputTools>
            <PromptInputSubmit
              status={chat.running ? 'streaming' : undefined}
              disabled={!chat.running && !canSend}
              onClick={(event) => {
                // While a turn runs, the same button is Stop.
                if (chat.running) {
                  event.preventDefault();
                  void bridge.cancelAgent();
                }
              }}
            />
          </PromptInputFooter>
        </PromptInput>
        {chat.error === null ? null : (
          <p className="text-caption text-destructive" role="alert">
            {chat.error}
          </p>
        )}
        <p className="text-caption text-muted-foreground">Attached files and referenced folders are never uploaded.</p>
      </div>
    </aside>
  );
}
