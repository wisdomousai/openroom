/**
 * Minimal JSON-RPC 2.0 framing for the stateless MCP endpoint.
 *
 * Deliberately tiny: single messages only (MCP over Streamable HTTP posts one
 * message per request; batches were removed from the MCP spec), and no
 * transport concerns — the worker owns HTTP.
 */

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export function result(id: JsonRpcId, value: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result: value };
}

export function error(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

/**
 * Parse one JSON-RPC message from a raw body. Returns a request object, or an
 * error response ready to send. Arrays (batches) are rejected per current MCP.
 */
export function parseMessage(
  raw: unknown,
): { ok: true; request: JsonRpcRequest } | { ok: false; response: Record<string, unknown> } {
  if (Array.isArray(raw)) {
    return { ok: false, response: error(null, INVALID_REQUEST, 'batch requests are not supported') };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, response: error(null, INVALID_REQUEST, 'expected a JSON-RPC object') };
  }
  const message = raw as Record<string, unknown>;
  if (message['jsonrpc'] !== '2.0' || typeof message['method'] !== 'string') {
    return { ok: false, response: error(null, INVALID_REQUEST, 'not a JSON-RPC 2.0 request') };
  }
  const id = message['id'];
  if (id !== undefined && id !== null && typeof id !== 'string' && typeof id !== 'number') {
    return { ok: false, response: error(null, INVALID_REQUEST, 'invalid id') };
  }
  const params = message['params'];
  if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
    return { ok: false, response: error(id ?? null, INVALID_REQUEST, 'params must be an object') };
  }
  return {
    ok: true,
    request: {
      jsonrpc: '2.0',
      ...(id === undefined ? {} : { id: id as JsonRpcId }),
      method: message['method'],
      ...(params === undefined ? {} : { params: params as Record<string, unknown> }),
    },
  };
}
