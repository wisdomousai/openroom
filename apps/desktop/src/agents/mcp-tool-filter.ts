type JsonRpcMessage = Record<string, unknown>;

function record(value: unknown): JsonRpcMessage | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRpcMessage
    : null;
}

function idKey(id: unknown): string | null {
  if (typeof id !== 'string' && typeof id !== 'number' && id !== null) return null;
  return JSON.stringify(id);
}

export function inspectSidebarMcpRequest(
  line: string,
  deniedTools: ReadonlySet<string>,
): { forward: true; toolsListId: string | null } | { forward: false; response: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return { forward: true, toolsListId: null };
  }
  const request = record(parsed);
  if (request === null) return { forward: true, toolsListId: null };
  const key = idKey(request['id']);
  if (request['method'] === 'tools/list') return { forward: true, toolsListId: key };
  if (request['method'] !== 'tools/call') return { forward: true, toolsListId: null };
  const params = record(request['params']);
  const name = params?.['name'];
  if (typeof name !== 'string' || !deniedTools.has(name)) return { forward: true, toolsListId: null };
  if (key === null) return { forward: false, response: null };
  return {
    forward: false,
    response: JSON.stringify({
      jsonrpc: '2.0',
      id: request['id'],
      result: {
        content: [{ type: 'text', text: JSON.stringify({ error: 'tool-not-available-in-sidebar' }) }],
        isError: true,
      },
    }),
  };
}

export function filterSidebarMcpResponse(
  line: string,
  deniedTools: ReadonlySet<string>,
  toolsListIds: Set<string>,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return line;
  }
  const response = record(parsed);
  if (response === null) return line;
  const key = idKey(response['id']);
  if (key === null || !toolsListIds.delete(key)) return line;
  const result = record(response['result']);
  if (result === null || !Array.isArray(result['tools'])) return line;
  const tools = result['tools'].filter((tool) => {
    const item = record(tool);
    return typeof item?.['name'] !== 'string' || !deniedTools.has(item['name']);
  });
  return JSON.stringify({ ...response, result: { ...result, tools } });
}

/**
 * openroom_api writes that act with the tutor's full account authority on
 * other people or on money: space membership and invitations, student access
 * links (credentials), billing. The embedded agent reads text other people
 * wrote (audience answers, co-author decks), so the sidecar holds these until
 * the tutor answers a confirmation in the pane. The agent cannot answer it.
 */
const CONFIRMED_API_PATHS: ReadonlyArray<{ pattern: RegExp; effect: string }> = [
  { pattern: /^\/api\/my\/spaces\/[^/]+\/(?:members|invites)(?:\/|$)/, effect: 'This changes who can open a space.' },
  { pattern: /^\/api\/my\/invites(?:\/|$)/, effect: 'This accepts or revokes a space invitation.' },
  { pattern: /^\/api\/tutoring\/contexts\/[^/]+\/links(?:\/|$)/, effect: 'This creates or revokes a student’s access link.' },
  { pattern: /^\/api\/my\/billing(?:\/|$)/, effect: 'This starts or changes billing for the account.' },
];

/** Prefix of the sidecar's own JSON-RPC ids, so its confirmation answers are not passed to the agent. */
export const CONFIRMATION_ID_PREFIX = 'openroom-confirm-';
const CONFIRMATION_QUESTION_ID = 'confirm';
const CONFIRMATION_ALLOW = 'allow';

export interface ApiCallToConfirm {
  /** JSON-RPC id of the agent's request; undefined for a notification. */
  id: unknown;
  method: string;
  path: string;
  body: unknown;
  effect: string;
}

/**
 * The path as sent, as fetch normalises it, and decoded then normalised again,
 * so `..`, `%2e` or `%2f` cannot walk a request around a pattern.
 */
function routedPaths(path: string): string[] | null {
  const base = 'http://openroom.invalid';
  const raw = path.split(/[?#]/, 1)[0] ?? '';
  try {
    const fetched = new URL(path, base).pathname;
    return [raw, fetched, new URL(decodeURIComponent(fetched), base).pathname];
  } catch {
    return null;
  }
}

export function apiCallNeedingConfirmation(line: string): ApiCallToConfirm | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  const request = record(parsed);
  if (request === null || request['method'] !== 'tools/call') return null;
  const params = record(request['params']);
  if (params?.['name'] !== 'openroom_api') return null;
  const args = record(params['arguments']) ?? {};
  const method = typeof args['method'] === 'string' ? args['method'].toUpperCase() : '';
  const path = typeof args['path'] === 'string' ? args['path'] : '';
  if (method === 'GET' || method === '' || path === '') return null;
  const paths = routedPaths(path);
  const match =
    paths === null
      ? { effect: 'The path could not be read.' }
      : CONFIRMED_API_PATHS.find((item) => paths.some((candidate) => item.pattern.test(candidate)));
  if (match === undefined) return null;
  return { id: request['id'], method, path, body: args['body'], effect: match.effect };
}

/** An ask_question call the sidecar sends on its own behalf; the pane shows it like any other question. */
export function confirmationRequest(id: string, call: ApiCallToConfirm): string {
  const body = call.body === undefined ? '' : ` with ${JSON.stringify(call.body).slice(0, 400)}`;
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name: 'ask_question',
      arguments: {
        questions: [
          {
            id: CONFIRMATION_QUESTION_ID,
            header: 'Confirm',
            prompt: `The agent wants to send ${call.method} ${call.path}${body}. ${call.effect} Allow it?`,
            options: [
              { id: CONFIRMATION_ALLOW, label: 'Allow' },
              { id: 'deny', label: 'Don’t allow' },
            ],
          },
        ],
      },
    },
  });
}

export function confirmationResponseId(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  const id = record(parsed)?.['id'];
  return typeof id === 'string' && id.startsWith(CONFIRMATION_ID_PREFIX) ? id : null;
}

/** Only an explicit Allow counts; a typed answer, a cancel or an error is a no. */
export function confirmationAllowed(line: string): boolean {
  try {
    const result = record(record(JSON.parse(line) as unknown)?.['result']);
    if (result === null || result['isError'] === true || !Array.isArray(result['content'])) return false;
    const text = record(result['content'][0])?.['text'];
    if (typeof text !== 'string') return false;
    const answers = record(JSON.parse(text) as unknown)?.['answers'];
    if (!Array.isArray(answers) || answers.length !== 1) return false;
    const answer = record(answers[0]);
    const optionIds = answer?.['optionIds'];
    return (
      answer?.['questionId'] === CONFIRMATION_QUESTION_ID &&
      Array.isArray(optionIds) &&
      optionIds.length === 1 &&
      optionIds[0] === CONFIRMATION_ALLOW
    );
  } catch {
    return false;
  }
}

export function confirmationRefusal(id: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: JSON.stringify({ error: 'not-confirmed-by-tutor' }) }],
      isError: true,
    },
  });
}
