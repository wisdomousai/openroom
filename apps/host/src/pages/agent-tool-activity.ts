type ToolActivity = {
  active: string;
  complete: string;
};

const OPENROOM_TOOL_ACTIVITY: Record<string, ToolActivity> = {
  outline_validate: { active: 'Validating', complete: 'Validating' },
  session_create: { active: 'Session start', complete: 'Session started' },
  deck_preview: { active: 'Preview', complete: 'Preview ready' },
  deck_save_version: { active: 'Slide update', complete: 'Slides updated' },
  deck_draft_put: { active: 'Slide update', complete: 'Slides updated' },
  deck_start: { active: 'Session start', complete: 'Session started' },
  session_command: { active: 'Live update', complete: 'Live session updated' },
};

function toolName(value: string): string {
  return value
    .replace(/^openroom:\s*/, '')
    .replace(/^mcp__openroom__/, '')
    .trim();
}

export function agentToolActivity(value: string, active: boolean): string | null {
  const activity = OPENROOM_TOOL_ACTIVITY[toolName(value)];
  if (activity === undefined) return null;
  return active ? activity.active : activity.complete;
}
