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
