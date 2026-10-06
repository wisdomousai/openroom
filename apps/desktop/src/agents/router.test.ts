import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';

import { ROUTER_SYSTEM_PROMPT, routeAgentProfile, type AgentRouterDeps } from './router.js';

const MODEL = 'anthropic:claude-opus-5';

function fakeDeps(
  object: { profile: string } | Error,
  overrides: Partial<AgentRouterDeps> = {},
): { deps: AgentRouterDeps; generateObject: ReturnType<typeof vi.fn>; resolveModel: ReturnType<typeof vi.fn> } {
  const generateObject = vi.fn(() =>
    object instanceof Error ? Promise.reject(object) : Promise.resolve({ object }),
  );
  const resolveModel = vi.fn(() => Promise.resolve('model' as unknown as LanguageModel));
  return {
    generateObject,
    resolveModel,
    deps: {
      resolveModel,
      generateObject: generateObject as unknown as AgentRouterDeps['generateObject'],
      ...overrides,
    },
  };
}

describe('routeAgentProfile', () => {
  it('routes a clear picture request to the add-image profile', async () => {
    const { deps, generateObject } = fakeDeps({ profile: 'add-image' });
    await expect(
      routeAgentProfile(deps, { prompt: 'Put a photo of the Eiffel Tower on slide 3.', model: MODEL }),
    ).resolves.toBe('add-image');
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it('routes a clear exercise request to the add-exercise profile', async () => {
    const { deps } = fakeDeps({ profile: 'add-exercise' });
    await expect(
      routeAgentProfile(deps, { prompt: 'Add a fill-the-gap exercise for the past tense.', model: MODEL }),
    ).resolves.toBe('add-exercise');
  });

  /** The cheap model, not the tutor's selection: the router is meant to be nearly free. */
  it('classifies on the provider’s small model, with the request in the user message', async () => {
    const { deps, resolveModel, generateObject } = fakeDeps({ profile: 'full' });
    await routeAgentProfile(deps, {
      prompt: 'Add another one.',
      model: MODEL,
      lastAssistantText: 'Added a photo of the harbour to slide 3.',
    });
    expect(resolveModel).toHaveBeenCalledWith('anthropic:claude-haiku-4-5');
    const call = generateObject.mock.calls[0]?.[0] as { system: string; prompt: string };
    expect(call.system).toBe(ROUTER_SYSTEM_PROMPT);
    expect(call.prompt).toContain('Add another one.');
    expect(call.prompt).toContain('harbour');
    expect(call.system).not.toContain('harbour');
  });

  it('falls back to the full agent on an ambiguous answer', async () => {
    const { deps } = fakeDeps({ profile: 'add-video' });
    await expect(routeAgentProfile(deps, { prompt: 'Make this better.', model: MODEL })).resolves.toBe(
      'full',
    );
  });

  it('does not route a long request', async () => {
    const { deps, generateObject } = fakeDeps({ profile: 'add-image' });
    await expect(
      routeAgentProfile(deps, { prompt: 'Add a picture. '.repeat(40), model: MODEL }),
    ).resolves.toBe('full');
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('does not route when the provider has no cheap model', async () => {
    const { deps, generateObject } = fakeDeps({ profile: 'add-image' });
    await expect(
      routeAgentProfile(deps, { prompt: 'Add a picture to slide 2.', model: 'cloudflare:@cf/zai-org/glm-5.2' }),
    ).resolves.toBe('full');
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('does not route without a selected model', async () => {
    const { deps, generateObject } = fakeDeps({ profile: 'add-image' });
    await expect(routeAgentProfile(deps, { prompt: 'Add a picture.', model: null })).resolves.toBe('full');
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('keeps a follow-up turn on the profile the conversation is running under', async () => {
    const { deps, generateObject } = fakeDeps({ profile: 'full' });
    await expect(
      routeAgentProfile(deps, { prompt: 'Add another one.', model: MODEL, priorProfile: 'add-image' }),
    ).resolves.toBe('add-image');
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('falls back to the full agent when the model call fails', async () => {
    const { deps } = fakeDeps(new Error('402 payment required'));
    await expect(routeAgentProfile(deps, { prompt: 'Add a picture.', model: MODEL })).resolves.toBe('full');
  });

  it('falls back to the full agent when the model cannot be resolved', async () => {
    const { deps } = fakeDeps({ profile: 'add-image' }, {
      resolveModel: () => Promise.reject(new Error('Add an API key for Anthropic in Agent settings.')),
    });
    await expect(routeAgentProfile(deps, { prompt: 'Add a picture.', model: MODEL })).resolves.toBe('full');
  });

  it('falls back to the full agent when the call outlives its budget', async () => {
    const { deps } = fakeDeps({ profile: 'add-image' }, {
      generateObject: (() => new Promise(() => undefined)) as unknown as AgentRouterDeps['generateObject'],
      timeoutMs: 5,
    });
    await expect(routeAgentProfile(deps, { prompt: 'Add a picture.', model: MODEL })).resolves.toBe('full');
  });

  it('snapshots the router prompt', () => {
    expect(ROUTER_SYSTEM_PROMPT).toMatchSnapshot();
  });
});
