import { describe, expect, it } from 'vitest';

import type { AgentChatMessage } from '../types.js';
import { BYOK_HISTORY_LIMIT, BYOK_HISTORY_PRUNE_TO, byokHistory } from './byok-history.js';

function tutor(text: string): AgentChatMessage {
  return { role: 'tutor', text, attachments: [], folders: [] };
}

describe('byokHistory', () => {
  it('keeps text and drops thinking, tool and status parts', () => {
    const messages = byokHistory([
      tutor('Prepare the deck'),
      {
        role: 'agent',
        pending: false,
        parts: [
          { kind: 'thinking', text: 'weighing options' },
          { kind: 'tool', text: 'deck_get' },
          { kind: 'text', text: 'Saved ' },
          { kind: 'status', text: 'tool failed' },
          { kind: 'text', text: 'the outline.' },
        ],
      },
    ]);

    expect(messages).toEqual([
      { role: 'user', content: 'Prepare the deck' },
      { role: 'assistant', content: 'Saved the outline.' },
    ]);
  });

  it('skips an agent turn with no text, which providers reject as empty content', () => {
    const messages = byokHistory([
      tutor('Check it'),
      { role: 'agent', pending: false, parts: [{ kind: 'tool', text: 'outline_validate' }] },
      tutor('And again'),
    ]);

    expect(messages).toEqual([
      { role: 'user', content: 'Check it' },
      { role: 'user', content: 'And again' },
    ]);
  });

  it('leaves a transcript at or under the limit alone', () => {
    const transcript = Array.from({ length: BYOK_HISTORY_LIMIT }, (_unused, index) => tutor(`turn ${String(index)}`));
    expect(byokHistory(transcript)).toHaveLength(BYOK_HISTORY_LIMIT);
    expect(byokHistory(transcript.slice(0, 5))).toHaveLength(5);
  });

  it('prunes to the floor in one chunk once the limit is exceeded', () => {
    const transcript = Array.from({ length: BYOK_HISTORY_LIMIT + 1 }, (_unused, index) => tutor(`turn ${String(index)}`));
    const messages = byokHistory(transcript);

    expect(messages).toHaveLength(BYOK_HISTORY_PRUNE_TO);
    expect(messages[0]).toEqual({ role: 'user', content: 'turn 11' });
  });

  it('opens the pruned chunk on a user message, which providers require', () => {
    // 25 alternating turns: the raw cut lands on an assistant message, so the
    // chunk has to give up one more to open on the tutor.
    const transcript: AgentChatMessage[] = [];
    for (let index = 0; index < 25; index += 1) {
      transcript.push(tutor(`ask ${String(index)}`));
      transcript.push({ role: 'agent', pending: false, parts: [{ kind: 'text', text: `answer ${String(index)}` }] });
    }
    const messages = byokHistory(transcript);

    expect(messages[0]).toEqual({ role: 'user', content: 'ask 6' });
    expect(messages.length).toBeGreaterThanOrEqual(BYOK_HISTORY_PRUNE_TO);
    expect(messages.length).toBeLessThanOrEqual(BYOK_HISTORY_LIMIT);
  });

  it('holds the cut point still until the limit is exceeded again', () => {
    const grow = (count: number) =>
      byokHistory(Array.from({ length: count }, (_unused, index) => tutor(`turn ${String(index)}`)));

    // One prune, then the window grows a message at a time off the same cut.
    const pruned = grow(BYOK_HISTORY_LIMIT + 1);
    for (let count = BYOK_HISTORY_LIMIT + 1; count <= 51; count += 1) {
      expect(grow(count).slice(0, BYOK_HISTORY_PRUNE_TO)).toEqual(pruned);
    }
    expect(grow(51)).toHaveLength(BYOK_HISTORY_LIMIT);

    // Exceeding it again cuts back to the floor on a new, still-stable point.
    expect(grow(52)).toHaveLength(BYOK_HISTORY_PRUNE_TO);
    expect(grow(52)[0]).toEqual({ role: 'user', content: 'turn 22' });
    expect(grow(53).slice(0, BYOK_HISTORY_PRUNE_TO)).toEqual(grow(52));
  });

  it('takes an explicit limit and floor', () => {
    const transcript = Array.from({ length: 10 }, (_unused, index) => tutor(`turn ${String(index)}`));
    expect(byokHistory(transcript, 4, 3)).toEqual([
      { role: 'user', content: 'turn 6' },
      { role: 'user', content: 'turn 7' },
      { role: 'user', content: 'turn 8' },
      { role: 'user', content: 'turn 9' },
    ]);
  });
});
