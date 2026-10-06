import { describe, expect, it } from 'vitest';

import { agentToolActivity } from './agent-tool-activity';

describe('agentToolActivity', () => {
  it('names meaningful Codex and Claude OpenRoom actions as teacher-facing activity', () => {
    expect(agentToolActivity('mcp__openroom__outline_validate', false)).toBe('Validating');
    expect(agentToolActivity('deck_save_version', false)).toBe('Slides updated');
    expect(agentToolActivity('openroom: deck_start', true)).toBe('Session start');
  });

  it('hides read-only plumbing and unknown tools', () => {
    expect(agentToolActivity('openroom: deck_get', true)).toBeNull();
    expect(agentToolActivity('mcp__openroom__session_status', false)).toBeNull();
    expect(agentToolActivity('ask_question', true)).toBeNull();
    expect(agentToolActivity('future_tool', false)).toBeNull();
  });
});
