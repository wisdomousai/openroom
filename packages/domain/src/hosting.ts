import type { ApplyResult, Command, SessionHost, SessionState } from './types.js';
import { commit, fail, noop } from './apply/helpers.js';

/** The control plane verifies current account/space access before registering a seat. */
export function registerHost(state: SessionState, host: SessionHost): ApplyResult {
  if (state.status === 'ended') return fail('E_ENDED', 'The session has ended.');
  if (!host || typeof host.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(host.id) ||
      typeof host.name !== 'string' || !host.name.trim() || host.name.length > 200 ||
      typeof host.canRecover !== 'boolean') return fail('E_INVALID_ANSWER', 'Invalid host.');
  const existing = Object.hasOwn(state.hosting.hosts, host.id) ? state.hosting.hosts[host.id] : undefined;
  if (!existing && Object.keys(state.hosting.hosts).length >= 50) return fail('E_FORBIDDEN', 'This session already has 50 hosts.');
  const next = { id: host.id, name: host.name.trim(), canRecover: host.canRecover };
  if (existing?.name === next.name && existing.canRecover === next.canRecover) return noop(state);
  return commit({ ...state, hosting: { ...state.hosting, hosts: { ...state.hosting.hosts, [next.id]: next } } });
}

/** Co-hosts may moderate and organize groups without changing what is presented. */
export const MODERATOR_COMMANDS: ReadonlySet<Command['command']> = new Set([
  'text.hide', 'text.unhide', 'qna.hide', 'qna.unhide', 'group.set', 'group.remove',
]);

export function hostCanCommand(state: SessionState, hostId: string, command: Command): boolean {
  const host = Object.hasOwn(state.hosting.hosts, hostId) ? state.hosting.hosts[hostId] : undefined;
  if (!host) return false;
  if (command.command === 'presentation.recover') return host.canRecover;
  return state.hosting.presenterId === hostId || MODERATOR_COMMANDS.has(command.command);
}

export function applyHostingCommand(state: SessionState, command: Command, hostId: string): ApplyResult | undefined {
  if (command.command !== 'presentation.handoff' && command.command !== 'presentation.recover') return undefined;
  const nextId = command.command === 'presentation.handoff' ? command.hostId : hostId;
  if (typeof nextId !== 'string' || !Object.hasOwn(state.hosting.hosts, nextId)) {
    return fail('E_FORBIDDEN', 'Choose a host who has joined this session.');
  }
  if (nextId === state.hosting.presenterId) return noop(state);
  return commit({ ...state, hosting: { ...state.hosting, presenterId: nextId } });
}
