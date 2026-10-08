import { describe, expect, it } from 'vitest';

import {
  EMPTY_AGENT_CHAT,
  applyAgentEvent,
  beginTurn,
  finishTurn,
  preferredModelId,
  resetChat,
  restoreChat,
  selectHost,
  storeModelId,
  type AgentChatState,
} from './agent-chat';

function started(): AgentChatState {
  return beginTurn(
    { ...EMPTY_AGENT_CHAT, hostId: 'claude' },
    { prompt: 'Make an exit ticket', attachments: ['/a.pdf'], folders: ['/School'] },
  );
}

describe('agent chat transitions', () => {
  it('beginTurn appends the tutor message and a pending agent message', () => {
    const state = started();
    expect(state.running).toBe(true);
    expect(state.messages).toEqual([
      { role: 'tutor', text: 'Make an exit ticket', attachments: ['/a.pdf'], folders: ['/School'] },
      { role: 'agent', parts: [], pending: true },
    ]);
  });

  it('merges consecutive text events into one part but keeps tool parts separate', () => {
    let state = started();
    state = applyAgentEvent(state, { kind: 'text', text: 'Drafting ' });
    state = applyAgentEvent(state, { kind: 'text', text: 'the outline.' });
    state = applyAgentEvent(state, { kind: 'tool', text: 'outline_validate' });
    state = applyAgentEvent(state, { kind: 'text', text: 'Valid.' });
    const agent = state.messages.at(-1);
    expect(agent?.role === 'agent' && agent.parts).toEqual([
      { kind: 'text', text: 'Drafting the outline.' },
      { kind: 'tool', text: 'outline_validate' },
      { kind: 'text', text: 'Valid.' },
    ]);
  });

  it('finishTurn success records the conversation id and settles the pending message', () => {
    let state = started();
    state = applyAgentEvent(state, { kind: 'text', text: 'Done.' });
    state = finishTurn(state, { ok: true, conversationId: 'conv-1' });
    expect(state.running).toBe(false);
    expect(state.conversationId).toBe('conv-1');
    expect(state.error).toBeNull();
    const agent = state.messages.at(-1);
    expect(agent?.role === 'agent' && agent.pending).toBe(false);
  });

  it('finishTurn failure sets the error and drops an empty pending message', () => {
    const state = finishTurn(started(), { ok: false, error: 'Add an Anthropic API key first.', conversationId: null });
    expect(state.error).toBe('Add an Anthropic API key first.');
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.role).toBe('tutor');
  });

  it('failure mid-conversation keeps the conversation id for the retry', () => {
    let state = finishTurn(started(), { ok: true, conversationId: 'conv-1' });
    state = beginTurn(state, { prompt: 'again', attachments: [], folders: [] });
    state = finishTurn(state, { ok: false, error: 'rate limited', conversationId: 'conv-1' });
    expect(state.conversationId).toBe('conv-1');
  });

  it('resetChat clears the transcript but keeps the chosen host', () => {
    const state = resetChat(finishTurn(started(), { ok: true, conversationId: 'conv-1' }));
    expect(state).toEqual({ ...EMPTY_AGENT_CHAT, hostId: 'claude' });
  });

  it('switching host abandons the conversation; re-selecting the same host does not', () => {
    const state = finishTurn(started(), { ok: true, conversationId: 'conv-1' });
    expect(selectHost(state, 'claude')).toBe(state);
    expect(selectHost(state, 'codex')).toEqual({ ...EMPTY_AGENT_CHAT, hostId: 'codex' });
  });

  it('appends a question part and replaces it by id when answered', () => {
    let state = started();
    const question = {
      kind: 'question' as const,
      id: 'ask-1',
      questions: [
        {
          id: 'level',
          prompt: 'Which level is this for?',
          header: 'Level',
          options: [
            { id: 'a1', label: 'A1' },
            { id: 'b1', label: 'B1' },
          ],
        },
      ],
    };
    state = applyAgentEvent(state, question);
    state = applyAgentEvent(state, {
      ...question,
      answers: [{ questionId: 'level', optionIds: ['b1'] }],
    });
    const agent = state.messages.at(-1);
    expect(agent?.role === 'agent' && agent.parts).toEqual([
      { ...question, answers: [{ questionId: 'level', optionIds: ['b1'] }] },
    ]);
  });

  it('restores a session conversation after Desktop reloads it', () => {
    expect(restoreChat({
      id: 'conv-old',
      hostId: 'codex',
      modelId: 'gpt-5',
      messages: [
        { role: 'tutor', text: 'Add an image', attachments: [], folders: [] },
        { role: 'agent', parts: [{ kind: 'text', text: 'Done.' }], pending: false },
      ],
    }, { hostId: 'claude', modelId: null })).toMatchObject({
      conversationId: 'conv-old',
      hostId: 'codex',
      modelId: 'gpt-5',
      running: false,
    });
  });

  it('defaults a fresh ChatGPT chat to the Luna tier, other hosts to their own default', () => {
    // No localStorage in this workspace: the stored-pick branch is inert, so
    // this pins exactly the fallback rule.
    const models = [
      { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna' },
    ];
    expect(preferredModelId('codex', models)).toBe('gpt-5.6-luna');
    expect(preferredModelId('claude', [{ id: 'opus', label: 'Opus' }])).toBeNull();
    expect(preferredModelId('codex', [{ id: 'gpt-6', label: 'GPT-6' }])).toBeNull();
  });

  it('storeModelId survives a machine without storage', () => {
    expect(() => storeModelId('codex', 'gpt-5.6-luna')).not.toThrow();
    expect(() => storeModelId('codex', null)).not.toThrow();
  });
});
