/**
 * Replay of prior turns for the API-key host, which has no vendor session to resume.
 *
 * Text only, deliberately. The stored transcript is display data: a tool call is
 * kept as its name, with no call id, input, or result, so tool-call/tool-result
 * pairs cannot be reconstructed. Faking them would be worse than dropping them —
 * Anthropic rejects an assistant message whose tool_use has no matching
 * tool_result, and a call id minted by one provider is meaningless once the tutor
 * switches models mid-conversation, which this host allows.
 *
 * Pruning is chunked rather than sliding, and that is a cache decision. A window
 * of "the last N messages" moves by one every turn, so the replayed prefix is a
 * different byte string every turn and the conversation cache is never read.
 * Cutting to PRUNE_TO only when LIMIT is exceeded holds the cut point still for
 * the next LIMIT - PRUNE_TO turns, so each turn extends the cached prefix instead
 * of replacing it. The cut point is recomputed from the transcript length alone,
 * not remembered, so it has to be a function of length that only moves in steps.
 */
import type { ModelMessage } from 'ai';

import type { AgentChatMessage } from '../types.js';

/** Prior turns kept in the replay. Unbounded history is a cost bug, not a feature. */
export const BYOK_HISTORY_LIMIT = 40;
/** What one prune cuts back to. The gap to the limit is how long a cut point holds. */
export const BYOK_HISTORY_PRUNE_TO = 30;

export function byokHistory(
  transcript: AgentChatMessage[],
  limit = BYOK_HISTORY_LIMIT,
  pruneTo = BYOK_HISTORY_PRUNE_TO,
): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const message of transcript) {
    if (message.role === 'tutor') {
      if (message.text.trim() === '') continue;
      messages.push({ role: 'user', content: message.text });
      continue;
    }
    const text = message.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join('');
    // Providers reject an assistant message with empty content; a tool-only turn has none.
    if (text.trim() === '') continue;
    messages.push({ role: 'assistant', content: text });
  }
  if (messages.length <= limit) return messages;
  // Each step drops the same block, so the cut point lands on the same message
  // for every length in one step's range.
  const step = limit - pruneTo + 1;
  let drop = step * Math.ceil((messages.length - limit) / step);
  // Anthropic and Google both reject a replay that opens on an assistant turn.
  while (drop < messages.length && messages[drop]?.role !== 'user') drop += 1;
  return messages.slice(drop);
}
