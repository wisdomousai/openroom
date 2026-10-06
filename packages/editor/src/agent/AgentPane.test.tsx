/**
 * Rendering via `react-dom/server` (no jsdom in this workspace): effects never
 * run, so hosts stay unloaded — these tests assert transcript rendering derived
 * from the module chat store, which server rendering does read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { AgentPane } from './AgentPane';
import { EMPTY_AGENT_CHAT, agentChatStore } from './agent-chat';
import type { OpenRoomDesktopBridge } from '../../../../apps/host/src/desktop-bridge';

const bridge = { listAgentHosts: () => Promise.resolve([]) } as unknown as OpenRoomDesktopBridge;

function render(): string {
  (globalThis as { window?: unknown }).window = { openroomDesktop: bridge };
  return renderToStaticMarkup(<AgentPane onBeforeRun={() => Promise.resolve(true)} />);
}

afterEach(() => {
  agentChatStore.setState(() => EMPTY_AGENT_CHAT);
  delete (globalThis as { window?: unknown }).window;
});

describe('AgentPane transcript', () => {
  it('renders tutor and agent turns, naming completed activity and alerting on error parts', () => {
    agentChatStore.setState(() => ({
      ...EMPTY_AGENT_CHAT,
      hostId: 'claude',
      conversationId: 'conv-1',
      messages: [
        { role: 'tutor', text: 'Make an exit ticket', attachments: ['/Users/t/quiz.pdf'], folders: ['/Users/t/School'] },
        {
          role: 'agent',
          pending: false,
          parts: [
            { kind: 'tool', text: 'deck_save_version' },
            { kind: 'text', text: 'Saved the outline.' },
            { kind: 'error', text: 'One gap could not be validated.' },
          ],
        },
      ],
    }));
    const html = render();
    expect(html).toContain('Make an exit ticket');
    expect(html).toContain('Slides updated');
    expect(html).not.toContain('deck_save_version');
    expect(html).toContain('Saved the outline.');
    expect(html).toContain('role="alert"');
    expect(html).toContain('quiz.pdf');
    expect(html).toContain('School/');
    expect(html).toContain('New chat');
  });

  it('shows meaningful current activity as progress without exposing its identifier', () => {
    agentChatStore.setState(() => ({
      ...EMPTY_AGENT_CHAT,
      hostId: 'codex',
      running: true,
      messages: [
        { role: 'tutor', text: 'Add a cat picture', attachments: [], folders: [] },
        {
          role: 'agent',
          pending: true,
          parts: [
            { kind: 'tool', text: 'openroom: outline_validate' },
          ],
        },
      ],
    }));
    const html = render();
    expect(html).toContain('Validating…');
    expect(html).toContain('aria-label="In progress"');
    expect(html).not.toContain('outline_validate');
  });

  it('does not render mechanical read activity', () => {
    agentChatStore.setState(() => ({
      ...EMPTY_AGENT_CHAT,
      hostId: 'codex',
      running: true,
      messages: [
        { role: 'tutor', text: 'Add a cat picture', attachments: [], folders: [] },
        {
          role: 'agent',
          pending: true,
          parts: [{ kind: 'tool', text: 'openroom: legacy_tool' }],
        },
      ],
    }));
    const html = render();
    expect(html).not.toContain('Reading the session');
    expect(html).not.toContain('legacy_tool');
  });

  it('folds thinking into a collapsible reasoning block, apart from the answer', () => {
    agentChatStore.setState(() => ({
      ...EMPTY_AGENT_CHAT,
      hostId: 'claude',
      messages: [
        { role: 'tutor', text: 'Add a recap', attachments: [], folders: [] },
        {
          role: 'agent',
          pending: false,
          parts: [
            { kind: 'thinking', text: 'The outline has three sections.' },
            { kind: 'text', text: 'Added the recap.' },
          ],
        },
      ],
    }));
    const html = render();
    expect(html).not.toContain('The outline has three sections.');
    expect(html).toContain('Added the recap.');
    // Reasoning renders as a collapsible with its own trigger button.
    expect(html).toContain('aria-expanded="false"');
  });

  it('offers no New chat button and reports the empty transcript before the first turn', () => {
    const html = render();
    expect(html).not.toContain('New chat');
    expect(html).toContain('No messages yet.');
  });

  it('chips the task profile a running turn was routed to', () => {
    agentChatStore.setState(() => ({
      ...EMPTY_AGENT_CHAT,
      hostId: 'byok',
      running: true,
      messages: [
        { role: 'tutor', text: 'Add a cat picture to slide 2', attachments: [], folders: [] },
        { role: 'agent', pending: true, parts: [{ kind: 'status', text: 'Add image' }] },
      ],
    }));
    const html = render();
    expect(html).toContain('Add image');
    expect(html).not.toContain('Full agent');
  });

  it('replaces the profile chip when the turn escalates', () => {
    agentChatStore.setState(() => ({
      ...EMPTY_AGENT_CHAT,
      hostId: 'byok',
      running: true,
      messages: [
        { role: 'tutor', text: 'Add a cat picture and rewrite the intro', attachments: [], folders: [] },
        {
          role: 'agent',
          pending: true,
          parts: [
            { kind: 'status', text: 'Add image' },
            { kind: 'status', text: 'escalated to full agent' },
          ],
        },
      ],
    }));
    const html = render();
    expect(html).toContain('Full agent');
    expect(html).not.toContain('Add image');
    expect(html).not.toContain('escalated to full agent');
  });

  it('surfaces the turn error once, under the composer', () => {
    agentChatStore.setState(() => ({ ...EMPTY_AGENT_CHAT, error: 'Sign in to Claude first.' }));
    const html = render();
    expect(html.split('Sign in to Claude first.')).toHaveLength(2);
  });

  it('renders a pending question as a form and hides the tool name', () => {
    agentChatStore.setState(() => ({
      ...EMPTY_AGENT_CHAT,
      hostId: 'claude',
      running: true,
      messages: [
        { role: 'tutor', text: 'Add a recap', attachments: [], folders: [] },
        {
          role: 'agent',
          pending: true,
          parts: [
            { kind: 'tool', text: 'ask_question' },
            {
              kind: 'question',
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
            },
          ],
        },
      ],
    }));
    const html = render();
    expect(html).toContain('Which level is this for?');
    expect(html).toContain('A1');
    expect(html).toContain('B1');
    expect(html).toContain('Continue');
    expect(html).toContain('Other');
    expect(html).not.toContain('ask_question');
  });

  it('summarises an answered question and skips a cancelled one', () => {
    agentChatStore.setState(() => ({
      ...EMPTY_AGENT_CHAT,
      hostId: 'claude',
      messages: [
        { role: 'tutor', text: 'Add a recap', attachments: [], folders: [] },
        {
          role: 'agent',
          pending: false,
          parts: [
            {
              kind: 'question',
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
              answers: [{ questionId: 'level', optionIds: ['b1'] }],
            },
            {
              kind: 'question',
              id: 'ask-2',
              questions: [{ id: 'skip', prompt: 'Keep the warm-up?', options: [] }],
              cancelled: true,
            },
          ],
        },
      ],
    }));
    const html = render();
    expect(html).toContain('Level');
    expect(html).toContain('B1');
    expect(html).toContain('Skipped');
    expect(html).not.toContain('Continue');
  });
});
