/**
 * Task profiles for the API-key host.
 *
 * "Add a picture to slide 4" does not need the whole agent: the full system
 * prompt is around four thousand tokens, every MCP tool schema rides along, and
 * a frontier model bills for all of it before it reads the deck. A profile runs
 * the same loop with a small prompt, a tool allowlist, a cheap model and a low
 * step cap, and hands the turn back to the full agent when the request turns out
 * to be bigger than the profile.
 *
 * Every prompt here is a static string constant. That is load-bearing, not
 * style: cache-middleware.ts gives each distinct prefix its own cache entry, so
 * a profile only earns one if its system text and tool schemas are the same
 * bytes for every tutor, every machine and every conversation. Interpolating a
 * deck id, a path or a name would buy a cache nobody ever hits. The skill text a
 * profile needs is inlined here rather than read from disk for the same reason —
 * and because a profile carries the one slice it needs, not a whole skill.
 */

export type AgentTaskProfileId = 'add-image' | 'add-exercise' | 'full';

export interface AgentTaskProfile {
  id: AgentTaskProfileId;
  /** Noun label for the picker. */
  title: string;
  /** null uses the full byok system prompt. */
  systemPrompt: string | null;
  /** MCP tool allowlist; read_file is always added by the runner. */
  tools: string[] | 'all';
  modelTier: 'cheap' | 'selected';
  maxSteps: number;
}

const ADD_IMAGE_PROMPT = `Add one picture to a deck.

Read the deck with deck_get and locate the step the tutor named. Find a
photograph with picture_search. Paste the result's "media" object onto that
step's "media", or into an image element when the step already carries
elements. Replace the suggested "alt" with alt text describing what the
picture shows. Never write a caption naming the stock source: the credit is
rendered from the URL, and an authored caption replaces it.

Save with deck_save_version against the baseVersion deck_get returned. On a
version-conflict, re-read with deck_get, re-apply and save again — never retry
the same body. Use deck_draft_put only when the tutor asked for working text
rather than a stamped version.

Add the picture. Change nothing else in the outline.

Report the outcome in one sentence. Report a failure as the error the tool
returned. Do not narrate tool calls, retries or workflow.

Call escalate when the request needs anything beyond adding a picture:
rewriting steps, adding questions, reading school files, starting a session.`;

const ADD_EXERCISE_PROMPT = `Add one interactive exercise to a deck.

Read the deck with deck_get. Author one wired step in the outline's existing
structure and language.

An exercise is authored in two places. The question goes in the top-level
"interactions" array; a step of kind "interaction" whose "interactionId"
matches places it. Questions are not a step kind. Interaction types are
choice, scale, numeric, text, qna, ranking, fill-the-gaps and match. A fill-the-gap
exercise is type "fill-the-gaps":

interactions:
  - id: gap-avoir
    type: fill-the-gaps
    prompt: "J'{{g1}} raté le {{g2}}."
    display: gaps
    gaps:
      - id: g1
        answers: [ai]
        distractors: [suis, as]
      - id: g2
        answers: [train]
    # display: bank needs extras or ≥2 gaps; display: choices needs distractors on every gap.
steps:
  - id: s-gap-avoir
    kind: interaction
    interactionId: gap-avoir

Every gap id appears exactly once as a {{id}} placeholder in the prompt, and
every placeholder has a gap; the same placeholder twice is not two gaps. Ids
are unique across the outline. Never put "elements" on an interaction step —
those kinds use named layouts.

Validate with outline_validate and fix what it reports before saving. Save
with deck_save_version against the baseVersion deck_get returned. On a
version-conflict, re-read with deck_get, re-apply and save again. Use
deck_draft_put only when the tutor asked for working text rather than a
stamped version.

Add one exercise. Change nothing else in the outline.

Report the outcome in one sentence. Report a failure as the error the tool
returned. Do not narrate tool calls, retries or workflow.

Call escalate when the request needs anything beyond adding one exercise:
rewriting the outline, adding pictures, reading school files, starting a
session.`;

export const AGENT_TASK_PROFILES: Record<AgentTaskProfileId, AgentTaskProfile> = {
  'add-image': {
    id: 'add-image',
    title: 'Add image',
    systemPrompt: ADD_IMAGE_PROMPT,
    tools: ['picture_search', 'deck_get', 'deck_draft_put', 'deck_save_version'],
    modelTier: 'cheap',
    // read → search → write → save, plus one retry after a version conflict.
    maxSteps: 6,
  },
  'add-exercise': {
    id: 'add-exercise',
    title: 'Add exercise',
    systemPrompt: ADD_EXERCISE_PROMPT,
    tools: ['deck_get', 'outline_validate', 'deck_draft_put', 'deck_save_version'],
    modelTier: 'cheap',
    // One validate–fix–validate round on top of the add-image budget.
    maxSteps: 8,
  },
  full: {
    id: 'full',
    title: 'Full agent',
    systemPrompt: null,
    tools: 'all',
    modelTier: 'selected',
    /** Enough for read → validate → save, plus a re-read after a version conflict. */
    maxSteps: 24,
  },
};

export const FULL_TASK_PROFILE = AGENT_TASK_PROFILES.full;

export function isAgentTaskProfileId(id: unknown): id is AgentTaskProfileId {
  return typeof id === 'string' && Object.hasOwn(AGENT_TASK_PROFILES, id);
}

/** An unknown or absent id falls back to the full agent rather than failing the turn. */
export function agentTaskProfile(id: unknown): AgentTaskProfile {
  return isAgentTaskProfileId(id) ? AGENT_TASK_PROFILES[id] : FULL_TASK_PROFILE;
}
