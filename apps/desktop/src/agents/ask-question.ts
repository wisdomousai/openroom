/**
 * Desktop-only MCP tool: the agent pauses until the tutor answers in AgentPane.
 *
 * Kept out of `packages/mcp` TOOL_DEFINITIONS on purpose — that list is the
 * hosted `/api/mcp` surface. Claude, Codex and the API-key host all wait on
 * MCP `tools/call`, so a blocking tool here reaches every runtime without a
 * vendor-specific approval callback.
 */
import { randomUUID } from 'node:crypto';

import {
  handleMcpMessage,
  jsonRpcResult,
  parseMessage,
  TOOL_DEFINITIONS,
  type ServerInfo,
  type ToolDeps,
} from '@openroom/mcp';

import type { AgentEvent, AgentQuestion, AgentQuestionAnswer, AgentQuestionOption } from './types.js';

export const ASK_QUESTION_TOOL_NAME = 'ask_question';

export const ASK_QUESTION_UNAVAILABLE =
  'ask_question is only available in OpenRoom Desktop’s agent pane.';

export const ASK_QUESTION_CANCELLED = 'Cancelled.';

export const ASK_QUESTION_TOOL = {
  name: ASK_QUESTION_TOOL_NAME,
  description:
    'Ask the tutor a clarifying question before changing the outline. ' +
    'Use this when a choice would change what you write — level, exercise type, which slide, yes or no. ' +
    'Do not narrate the call. One call may include up to four questions. ' +
    'Offer labelled options when you can; omit options for a free-text answer. ' +
    'The tutor can always pick Other and type their own answer.',
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        description: 'One to four questions to show in the agent pane.',
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable id echoed in the answer.' },
            prompt: { type: 'string', description: 'The question shown to the tutor.' },
            header: { type: 'string', description: 'Optional short label above the prompt.' },
            multiSelect: {
              type: 'boolean',
              description: 'When true, the tutor may pick more than one option.',
            },
            options: {
              description:
                'Two to six labelled choices. Omit or leave empty for a free-text question.',
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['label'],
                additionalProperties: false,
              },
            },
          },
          required: ['prompt'],
          additionalProperties: false,
        },
      },
    },
    required: ['questions'],
    additionalProperties: false,
  },
};

export function parseAskQuestionArgs(args: Record<string, unknown>): AgentQuestion[] {
  const raw = args['questions'];
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) {
    throw new Error('ask_question requires 1–4 questions.');
  }
  return raw.map((item, index) => parseQuestion(item, index));
}

function parseQuestion(raw: unknown, index: number): AgentQuestion {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`Question ${String(index + 1)} must be an object.`);
  }
  const record = raw as Record<string, unknown>;
  const prompt = typeof record['prompt'] === 'string' ? record['prompt'].trim() : '';
  if (prompt === '') throw new Error(`Question ${String(index + 1)} needs a prompt.`);
  const id =
    typeof record['id'] === 'string' && record['id'].trim() !== ''
      ? record['id'].trim()
      : `q${String(index + 1)}`;
  const header =
    typeof record['header'] === 'string' && record['header'].trim() !== ''
      ? record['header'].trim()
      : undefined;
  const multiSelect = record['multiSelect'] === true;
  const options = parseOptions(record['options'], id);
  return {
    id,
    prompt,
    ...(header === undefined ? {} : { header }),
    ...(multiSelect ? { multiSelect: true } : {}),
    options,
  };
}

function parseOptions(raw: unknown, questionId: string): AgentQuestionOption[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`Options for ${questionId} must be an array.`);
  if (raw.length === 0) return [];
  if (raw.length === 1 || raw.length > 6) {
    throw new Error(`Question ${questionId} needs 2–6 options, or none.`);
  }
  return raw.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`Option ${String(index + 1)} on ${questionId} must be an object.`);
    }
    const record = item as Record<string, unknown>;
    const label = typeof record['label'] === 'string' ? record['label'].trim() : '';
    if (label === '') throw new Error(`Option ${String(index + 1)} on ${questionId} needs a label.`);
    const id =
      typeof record['id'] === 'string' && record['id'].trim() !== ''
        ? record['id'].trim()
        : `${questionId}-${String(index + 1)}`;
    const description =
      typeof record['description'] === 'string' && record['description'].trim() !== ''
        ? record['description'].trim()
        : undefined;
    return { id, label, ...(description === undefined ? {} : { description }) };
  });
}

export function parseAskQuestionAnswers(
  questions: AgentQuestion[],
  raw: unknown,
): { ok: true; answers: AgentQuestionAnswer[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length !== questions.length) {
    return { ok: false, error: 'Answer every question.' };
  }
  const answers: AgentQuestionAnswer[] = [];
  for (const [index, question] of questions.entries()) {
    const item = raw[index];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { ok: false, error: `Answer ${String(index + 1)} must be an object.` };
    }
    const record = item as Record<string, unknown>;
    const questionId = typeof record['questionId'] === 'string' ? record['questionId'] : '';
    if (questionId !== question.id) {
      return { ok: false, error: `Answer ${String(index + 1)} does not match its question.` };
    }
    const optionIds = Array.isArray(record['optionIds'])
      ? record['optionIds'].filter((id): id is string => typeof id === 'string')
      : [];
    const known = new Set(question.options.map((option) => option.id));
    if (optionIds.some((id) => !known.has(id))) {
      return { ok: false, error: `Answer ${String(index + 1)} names an unknown option.` };
    }
    if (question.multiSelect !== true && optionIds.length > 1) {
      return { ok: false, error: `Answer ${String(index + 1)} allows only one option.` };
    }
    const text =
      typeof record['text'] === 'string' && record['text'].trim() !== ''
        ? record['text'].trim()
        : undefined;
    if (question.options.length === 0) {
      if (text === undefined) return { ok: false, error: `Answer ${String(index + 1)} needs text.` };
    } else if (optionIds.length === 0 && text === undefined) {
      return { ok: false, error: `Answer ${String(index + 1)} needs an option or Other.` };
    }
    answers.push({
      questionId,
      optionIds,
      ...(text === undefined ? {} : { text }),
    });
  }
  return { ok: true, answers };
}

export interface AskQuestionTarget {
  id: number;
}

export interface AskQuestionBroker {
  beginRun(target: AskQuestionTarget, onEvent: (event: AgentEvent) => void): void;
  endRun(senderId: number): void;
  cancelRun(senderId: number): void;
  ask(args: Record<string, unknown>): Promise<AgentQuestionAnswer[]>;
  answer(id: string, answers: unknown): { ok: true } | { ok: false; error: string };
}

interface ActiveRun {
  senderId: number;
  onEvent: (event: AgentEvent) => void;
}

interface PendingAsk {
  id: string;
  senderId: number;
  questions: AgentQuestion[];
  resolve: (answers: AgentQuestionAnswer[]) => void;
  reject: (error: Error) => void;
}

export function createAskQuestionBroker(): AskQuestionBroker {
  const runs: ActiveRun[] = [];
  const pending = new Map<string, PendingAsk>();

  function rejectPending(senderId: number, message: string): void {
    for (const [id, item] of [...pending]) {
      if (item.senderId !== senderId) continue;
      pending.delete(id);
      const run = runs.find((candidate) => candidate.senderId === senderId);
      run?.onEvent({ kind: 'question', id, questions: item.questions, cancelled: true });
      item.reject(new Error(message));
    }
  }

  function removeRun(senderId: number): void {
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      if (runs[index]?.senderId === senderId) runs.splice(index, 1);
    }
  }

  return {
    beginRun(target, onEvent) {
      rejectPending(target.id, ASK_QUESTION_CANCELLED);
      removeRun(target.id);
      runs.push({ senderId: target.id, onEvent });
    },
    endRun(senderId) {
      rejectPending(senderId, ASK_QUESTION_CANCELLED);
      removeRun(senderId);
    },
    cancelRun(senderId) {
      rejectPending(senderId, ASK_QUESTION_CANCELLED);
    },
    async ask(args) {
      const questions = parseAskQuestionArgs(args);
      const run = runs.at(-1);
      if (run === undefined) throw new Error(ASK_QUESTION_UNAVAILABLE);
      const id = randomUUID();
      run.onEvent({ kind: 'question', id, questions });
      return new Promise((resolve, reject) => {
        pending.set(id, { id, senderId: run.senderId, questions, resolve, reject });
      });
    },
    answer(id, raw) {
      const item = pending.get(id);
      if (item === undefined) return { ok: false, error: 'No matching question.' };
      const parsed = parseAskQuestionAnswers(item.questions, raw);
      if (!parsed.ok) return parsed;
      pending.delete(id);
      const run = runs.find((candidate) => candidate.senderId === item.senderId);
      run?.onEvent({
        kind: 'question',
        id,
        questions: item.questions,
        answers: parsed.answers,
      });
      item.resolve(parsed.answers);
      return { ok: true };
    },
  };
}

/**
 * Desktop socket handler: hosted `handleMcpMessage` plus `ask_question`.
 * Mutating the `tools/list` array in place would leak the tool into
 * TOOL_DEFINITIONS (the same array hosted `/api/mcp` returns).
 */
export async function handleDesktopMcpMessage(
  raw: unknown,
  deps: ToolDeps,
  serverInfo: ServerInfo,
  ask: (args: Record<string, unknown>) => Promise<AgentQuestionAnswer[]>,
): Promise<Record<string, unknown> | null> {
  const parsed = parseMessage(raw);
  if (parsed.ok && parsed.request.id !== undefined && parsed.request.method === 'tools/list') {
    const response = await handleMcpMessage(raw, deps, serverInfo);
    if (response === null) return null;
    const listed = response['result'] as { tools?: unknown[] } | undefined;
    if (listed !== undefined && Array.isArray(listed.tools)) {
      listed.tools = [...listed.tools, ASK_QUESTION_TOOL];
    }
    return response;
  }
  if (parsed.ok && parsed.request.id !== undefined && parsed.request.method === 'tools/call') {
    const name = parsed.request.params?.['name'];
    if (name === ASK_QUESTION_TOOL_NAME) {
      const args =
        typeof parsed.request.params?.['arguments'] === 'object' &&
        parsed.request.params['arguments'] !== null &&
        !Array.isArray(parsed.request.params['arguments'])
          ? (parsed.request.params['arguments'] as Record<string, unknown>)
          : {};
      try {
        const answers = await ask(args);
        return jsonRpcResult(parsed.request.id, {
          content: [{ type: 'text', text: JSON.stringify({ answers }) }],
          isError: false,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'internal tool error';
        return jsonRpcResult(parsed.request.id, {
          content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
          isError: true,
        });
      }
    }
  }
  return handleMcpMessage(raw, deps, serverInfo);
}

/** Hosted `/api/mcp` must never grow this tool. */
export function hostedToolsIncludeAskQuestion(): boolean {
  return TOOL_DEFINITIONS.some((tool) => tool.name === ASK_QUESTION_TOOL_NAME);
}
