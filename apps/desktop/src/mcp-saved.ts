/**
 * Did this MCP exchange stamp a deck version? The desktop broadcasts stamped
 * saves so an open editor can adopt them — the embedded pane mid-run and a
 * handed-off Codex terminal both save without the page hearing about it.
 */
import { parseMessage } from '@openroom/mcp';

export function stampedDeckId(raw: unknown, response: Record<string, unknown> | null): string | null {
  if (response === null) return null;
  const parsed = parseMessage(raw);
  if (!parsed.ok || parsed.request.method !== 'tools/call') return null;
  const params = parsed.request.params;
  if (params === undefined || params['name'] !== 'deck_save_version') return null;
  const args = params['arguments'];
  const deckId =
    typeof args === 'object' && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)['deckId']
      : undefined;
  if (typeof deckId !== 'string' || deckId === '') return null;
  const result = response['result'] as Record<string, unknown> | undefined;
  if (result === undefined || result['isError'] === true) return null;
  const content = Array.isArray(result['content'])
    ? (result['content'][0] as Record<string, unknown> | undefined)
    : undefined;
  if (content?.['type'] !== 'text' || typeof content['text'] !== 'string') return null;
  try {
    const body = JSON.parse(content['text']) as Record<string, unknown>;
    return body['ok'] === true ? deckId : null;
  } catch {
    return null;
  }
}
