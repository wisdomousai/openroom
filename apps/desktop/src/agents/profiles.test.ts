import { describe, expect, it } from 'vitest';

import { AGENT_TASK_PROFILES, agentTaskProfile, isAgentTaskProfileId } from './profiles.js';

/**
 * The sidecar's tool names, restated rather than imported: the desktop app does
 * not depend on the MCP package, and a profile allowlisting a name the sidecar
 * never serves is a tool the model is told about and cannot call.
 */
const MCP_TOOL_NAMES = [
  'outline_validate',
  'session_create',
  'session_status',
  'session_results',
  'openroom_api',
  'deck_get',
  'deck_preview',
  'deck_save_version',
  'deck_draft_put',
  'deck_start',
  'session_command',
  'picture_search',
];

describe('AGENT_TASK_PROFILES', () => {
  it('allowlists only tools the sidecar serves', () => {
    for (const profile of Object.values(AGENT_TASK_PROFILES)) {
      if (profile.tools === 'all') continue;
      for (const name of profile.tools) expect(MCP_TOOL_NAMES).toContain(name);
    }
  });

  it('runs the full agent on the selected model and every task profile cheap', () => {
    expect(AGENT_TASK_PROFILES.full.modelTier).toBe('selected');
    expect(AGENT_TASK_PROFILES.full.systemPrompt).toBeNull();
    expect(AGENT_TASK_PROFILES.full.tools).toBe('all');
    for (const profile of Object.values(AGENT_TASK_PROFILES)) {
      if (profile.id === 'full') continue;
      expect(profile.modelTier).toBe('cheap');
      expect(profile.maxSteps).toBeLessThan(AGENT_TASK_PROFILES.full.maxSteps);
      expect(typeof profile.systemPrompt).toBe('string');
      expect(profile.systemPrompt).toContain('escalate');
    }
  });

  /** A path in a profile prompt is a per-machine byte, and the cache entry is per-prefix. */
  it('names no absolute path', () => {
    for (const profile of Object.values(AGENT_TASK_PROFILES)) {
      expect(profile.systemPrompt ?? '').not.toMatch(/(^|\s)(\/[\w.-]+){2,}/);
      expect(profile.systemPrompt ?? '').not.toMatch(/[A-Za-z]:\\/);
    }
  });

  it('snapshots the add-image prompt', () => {
    expect(AGENT_TASK_PROFILES['add-image'].systemPrompt).toMatchSnapshot();
  });

  it('snapshots the add-exercise prompt', () => {
    expect(AGENT_TASK_PROFILES['add-exercise'].systemPrompt).toMatchSnapshot();
  });
});

describe('agentTaskProfile', () => {
  it('resolves a known id and falls back to the full agent', () => {
    expect(agentTaskProfile('add-image').id).toBe('add-image');
    expect(agentTaskProfile(null).id).toBe('full');
    expect(agentTaskProfile(undefined).id).toBe('full');
    expect(agentTaskProfile('add-video').id).toBe('full');
    expect(agentTaskProfile({}).id).toBe('full');
  });

  it('recognises exactly the profile ids', () => {
    expect(isAgentTaskProfileId('full')).toBe(true);
    expect(isAgentTaskProfileId('toString')).toBe(false);
  });
});
