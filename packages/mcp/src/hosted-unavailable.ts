import { ToolError, type ToolDeps } from './tools.js';

/** Headless host with no app session: outline tools still work; live sessions do not. */
export function unavailableHostedDeps(): ToolDeps {
  const denied = (): never => {
    throw new ToolError('sign-in-required');
  };
  return {
    createSession: async () => denied(),
    getExport: async () => null,
    controlRequest: async () => ({ status: 401, body: { error: 'sign-in-required' } }),
    sessionCommand: async () => denied(),
  };
}
