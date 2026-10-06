import { describe, expect, it } from 'vitest';

import { TOOL_DEFINITIONS, type ToolDeps } from '@openroom/mcp';

import {
  ASK_QUESTION_TOOL_NAME,
  ASK_QUESTION_UNAVAILABLE,
  createAskQuestionBroker,
  handleDesktopMcpMessage,
  hostedToolsIncludeAskQuestion,
  parseAskQuestionArgs,
} from './ask-question.js';
import type { AgentEvent } from './types.js';

const SERVER_INFO = { name: 'openroom-desktop', version: '0.1.0' };

function stubDeps(): ToolDeps {
  return {
    createSession: async () => ({
      sessionCode: 'CODE',
      code: 'CODE',
      joinUrl: 'https://example.test/?code=CODE',
      hostToken: 'host',
      stageToken: 'stage',
    }),
    getExport: async () => null,
    controlRequest: async () => ({ status: 200, body: {} }),
    sessionCommand: async () => ({ ok: true }),
  };
}

function rpc(method: string, params?: Record<string, unknown>, id: number = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

describe('parseAskQuestionArgs', () => {
  it('fills ids and accepts two options or none', () => {
    expect(
      parseAskQuestionArgs({
        questions: [{ prompt: 'Which level?', options: [{ label: 'A1' }, { label: 'B1' }] }],
      }),
    ).toEqual([
      {
        id: 'q1',
        prompt: 'Which level?',
        options: [
          { id: 'q1-1', label: 'A1' },
          { id: 'q1-2', label: 'B1' },
        ],
      },
    ]);
    expect(parseAskQuestionArgs({ questions: [{ id: 'why', prompt: 'Why this slide?' }] })).toEqual([
      { id: 'why', prompt: 'Why this slide?', options: [] },
    ]);
  });

  it('rejects a single option and more than four questions', () => {
    expect(() =>
      parseAskQuestionArgs({ questions: [{ prompt: 'Pick', options: [{ label: 'Only' }] }] }),
    ).toThrow('2–6 options');
    expect(() =>
      parseAskQuestionArgs({
        questions: [
          { prompt: '1' },
          { prompt: '2' },
          { prompt: '3' },
          { prompt: '4' },
          { prompt: '5' },
        ],
      }),
    ).toThrow('1–4 questions');
  });
});

describe('createAskQuestionBroker', () => {
  it('asks, answers, and refuses a call with no active pane run', async () => {
    const broker = createAskQuestionBroker();
    await expect(broker.ask({ questions: [{ prompt: 'Level?' }] })).rejects.toThrow(ASK_QUESTION_UNAVAILABLE);

    const events: AgentEvent[] = [];
    broker.beginRun({ id: 1 }, (event) => events.push(event));
    const asking = broker.ask({
      questions: [{ prompt: 'Which level?', options: [{ label: 'A1' }, { label: 'B1' }] }],
    });
    const pending = events[0];
    expect(pending?.kind).toBe('question');
    if (pending?.kind !== 'question') throw new Error('expected a question event');

    expect(broker.answer(pending.id, [{ questionId: 'q1', optionIds: ['q1-2'] }])).toEqual({ ok: true });
    await expect(asking).resolves.toEqual([{ questionId: 'q1', optionIds: ['q1-2'] }]);
    expect(events.at(-1)).toMatchObject({ kind: 'question', id: pending.id, answers: [{ questionId: 'q1', optionIds: ['q1-2'] }] });
  });

  it('cancels a waiter and marks the question skipped', async () => {
    const broker = createAskQuestionBroker();
    const events: AgentEvent[] = [];
    broker.beginRun({ id: 3 }, (event) => events.push(event));
    const asking = broker.ask({ questions: [{ prompt: 'Keep the warm-up?' }] });
    broker.cancelRun(3);
    await expect(asking).rejects.toThrow('Cancelled.');
    expect(events.at(-1)).toMatchObject({ kind: 'question', cancelled: true });
  });
});

describe('handleDesktopMcpMessage', () => {
  it('lists ask_question on the desktop socket without adding it to hosted TOOL_DEFINITIONS', async () => {
    const hostedCount = TOOL_DEFINITIONS.length;
    expect(hostedToolsIncludeAskQuestion()).toBe(false);

    const listed = await handleDesktopMcpMessage(rpc('tools/list'), stubDeps(), SERVER_INFO, async () => []);
    const tools = (listed as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools.some((tool) => tool.name === ASK_QUESTION_TOOL_NAME)).toBe(true);
    expect(tools.filter((tool) => tool.name === ASK_QUESTION_TOOL_NAME)).toHaveLength(1);
    expect(TOOL_DEFINITIONS).toHaveLength(hostedCount);
    expect(TOOL_DEFINITIONS.some((tool) => tool.name === ASK_QUESTION_TOOL_NAME)).toBe(false);
  });

  it('returns the tutor answers from tools/call', async () => {
    const answers = [{ questionId: 'q1', optionIds: ['q1-1'] }];
    const response = await handleDesktopMcpMessage(
      rpc('tools/call', {
        name: ASK_QUESTION_TOOL_NAME,
        arguments: { questions: [{ prompt: 'A or B?', options: [{ label: 'A' }, { label: 'B' }] }] },
      }),
      stubDeps(),
      SERVER_INFO,
      async () => answers,
    );
    const result = (response as { result: { content: Array<{ text: string }>; isError: boolean } }).result;
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]!.text)).toEqual({ answers });
  });

  it('surfaces an unavailable pane as a tool error, not a protocol error', async () => {
    const response = await handleDesktopMcpMessage(
      rpc('tools/call', { name: ASK_QUESTION_TOOL_NAME, arguments: { questions: [{ prompt: 'Hello?' }] } }),
      stubDeps(),
      SERVER_INFO,
      async () => {
        throw new Error(ASK_QUESTION_UNAVAILABLE);
      },
    );
    const result = (response as { result: { content: Array<{ text: string }>; isError: boolean } }).result;
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toEqual({ error: ASK_QUESTION_UNAVAILABLE });
  });
});
