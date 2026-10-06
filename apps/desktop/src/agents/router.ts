/**
 * Picks the task profile for a turn (see profiles.ts).
 *
 * A profile only pays off when it is chosen without the tutor doing the
 * choosing, so one cheap-model call reads the request and names the outcome.
 * The call is a cost and a delay, and every way it can go wrong ends the same
 * way: the full agent, which handles every request. Hence the guards below —
 * long requests, a provider with no cheap tier, an error, a timeout — all
 * return `full` rather than reaching for a second opinion.
 *
 * The system prompt is a static constant and the turn's text rides in the user
 * message. That is the cache-middleware.ts rule (a prefix with per-tutor bytes
 * earns a cache nobody hits), and it applies to the router's own small prefix
 * too.
 *
 * Follow-up turns are not routed: a conversation that started under a profile
 * stays under it, and the profile's own escalate tool is the way out (byok.ts).
 * Re-routing every turn would swap prompts and tools mid-thread for the price
 * of another call.
 */
import { generateObject as sdkGenerateObject, jsonSchema, type LanguageModel } from 'ai';

import { cheapModelFor } from './byok-models.js';
import { isAgentTaskProfileId, type AgentTaskProfileId } from './profiles.js';
import { splitModelId } from './providers.js';

/** Past this, the request is describing a project rather than one small task. */
const MAX_PROMPT_CHARS = 200;
/** Enough context to read "add another one" without carrying a whole answer. */
const MAX_CONTEXT_CHARS = 500;
/** The router runs before the turn does, so its failure mode has to be fast. */
const TIMEOUT_MS = 5000;

export const ROUTER_SYSTEM_PROMPT = `Name the task a tutor's request asks for. Answer with one id.

add-image — adding a picture, photo or illustration to a slide.
"Put a photo of the Eiffel Tower on slide 3."
"Add a picture to the vocabulary slide."
"This slide needs an image."

add-exercise — adding one question or interactive exercise to a slide.
"Add a fill-the-gap exercise for the past tense."
"Put a multiple choice question after the reading."
"Add a quick poll at the end."

full — everything else: rewriting or building an outline, several tasks at
once, running a session, reading files, questions about the deck.
"Build a lesson on the water cycle from this PDF."
"Add a picture to slide 2 and rewrite the intro."
"Start the session and show me the results."

Pick add-image or add-exercise only when the request is that one task and
nothing more. When unsure, choose full.`;

const ROUTE_SCHEMA = jsonSchema<{ profile: AgentTaskProfileId }>({
  type: 'object',
  properties: { profile: { type: 'string', enum: ['add-image', 'add-exercise', 'full'] } },
  required: ['profile'],
  additionalProperties: false,
});

export interface AgentRouterDeps {
  resolveModel(modelId: string | null): Promise<LanguageModel>;
  generateObject?: typeof sdkGenerateObject;
  timeoutMs?: number;
}

export interface AgentRouterInput {
  prompt: string;
  /** Composite `provider:model` id the tutor selected; null has no provider to be cheap on. */
  model: string | null;
  /** The profile this conversation is already running under, on a follow-up turn. */
  priorProfile?: AgentTaskProfileId | null;
  /** The previous answer, for a request that only makes sense against it. */
  lastAssistantText?: string | null;
}

function routerUserMessage(input: AgentRouterInput): string {
  const context = (input.lastAssistantText ?? '').trim().slice(0, MAX_CONTEXT_CHARS);
  const request = `Request: ${input.prompt.trim()}`;
  return context === '' ? request : `Previous answer: ${context}\n\n${request}`;
}

export async function routeAgentProfile(
  deps: AgentRouterDeps,
  input: AgentRouterInput,
): Promise<AgentTaskProfileId> {
  if (input.priorProfile != null) return input.priorProfile;
  const prompt = input.prompt.trim();
  if (prompt === '' || prompt.length > MAX_PROMPT_CHARS) return 'full';
  const split = input.model === null ? null : splitModelId(input.model);
  const cheapModel = split === null ? null : cheapModelFor(split.providerId);
  if (cheapModel === null) return 'full';

  const generateObject = deps.generateObject ?? sdkGenerateObject;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const routed = generateObject({
      model: await deps.resolveModel(cheapModel),
      schema: ROUTE_SCHEMA,
      schemaName: 'task_profile',
      system: ROUTER_SYSTEM_PROMPT,
      prompt: routerUserMessage(input),
      abortSignal: abort.signal,
    })
      .then((result) => result.object.profile)
      // Caught here, not by the try: once the timeout has won the race, a later
      // rejection has no one waiting on it and would surface unhandled.
      .catch((): AgentTaskProfileId => 'full');
    // Raced rather than left to the abort signal alone: a provider that ignores
    // it would hold the turn open past the budget this router is allowed.
    const expired = new Promise<'full'>((resolve) => {
      timer = setTimeout(() => resolve('full'), deps.timeoutMs ?? TIMEOUT_MS);
    });
    const profile = await Promise.race([routed, expired]);
    return isAgentTaskProfileId(profile) ? profile : 'full';
  } catch {
    // Every failure is the full agent: the turn still runs, it just runs wide.
    return 'full';
  } finally {
    if (timer !== null) clearTimeout(timer);
    abort.abort();
  }
}
