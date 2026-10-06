/**
 * A2A Agent Card — discovery manifest at /.well-known/agent-card.json
 * (A2A Protocol Spec § Agent Discovery / RFC 8615).
 *
 * Clients fetch this to learn identity, skills, and the JSON-RPC service URL
 * before calling POST /api/a2a.
 */

export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  version: string;
  documentationUrl: string;
  provider: { organization: string; url: string };
  supportedInterfaces: Array<{
    url: string;
    protocolBinding: string;
    protocolVersion: string;
  }>;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    extendedAgentCard: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples?: string[];
    inputModes?: string[];
    outputModes?: string[];
  }>;
  securitySchemes?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
}

const CARD_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=3600',
  'x-content-type-options': 'nosniff',
  'access-control-allow-origin': '*',
} as const;

/** Build the public Agent Card for this origin. */
export function buildAgentCard(origin: string): AgentCard {
  return {
    protocolVersion: '1.0',
    name: 'OpenRoom',
    description:
      'Validate classroom session outlines, create live sessions, and read aggregate results for ' +
      'polls, quizzes, ranking, Q&A and exit tickets. Participants join with an 8-character ' +
      'session code and do not need an account. Ballots are deleted 30 minutes after a session ends.',
    version: '0.1.0',
    documentationUrl: `${origin}/llms.txt`,
    provider: {
      organization: 'OpenRoom',
      url: origin,
    },
    supportedInterfaces: [
      {
        url: `${origin}/api/a2a`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json', 'text/plain'],
    skills: [
      {
        id: 'outline-validate',
        name: 'Validate session outline',
        description:
          'Validate an OpenRoom SimpleSession / Session (YAML or JSON) against the schema. ' +
          'Returns ok plus a summary, or a stable error list. Always validate before creating a session.',
        tags: ['outline', 'validate', 'classroom', 'session'],
        examples: [
          'Validate this outline:\nversion: 1\nmeta:\n  title: Quick check\ninteractions:\n  - id: q1\n    type: choice\n    prompt: Pick one\n    options:\n      - id: a\n        label: A\n      - id: b\n        label: B',
        ],
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'session-create',
        name: 'Create live session',
        description:
          'Create a live session from a validated session outline. Returns join code, joinUrl, hostToken ' +
          'and stageToken. Requires bearer auth (API token, OAuth access token, or admin key).',
        tags: ['session', 'create', 'live', 'classroom'],
        examples: ['Create a session from this validated outline YAML.'],
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'session-status',
        name: 'Session status',
        description:
          'Get a session’s current status by join code: session status, participant count, and each ' +
          'question’s lifecycle state (pending/open/closed/revealed). No results included.',
        tags: ['session', 'status', 'monitor'],
        examples: ['What is the status of session ABCD1234?'],
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'session-results',
        name: 'Session aggregate results',
        description:
          'Read a session’s aggregate results by join code (counts, distributions, text entries). ' +
          'Never includes per-participant ballots or pre-reveal answer keys.',
        tags: ['session', 'results', 'aggregates'],
        examples: ['Get results for session ABCD1234'],
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
    ],
    securitySchemes: {
      bearer: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Personal API token (orpat_…), MCP OAuth access token, or deployment admin key. ' +
          'Required for session-create and owned-session reads.',
      },
    },
    security: [{ bearer: [] }],
  };
}

/** GET /.well-known/agent-card.json */
export function agentCardRoute(origin: string): Response {
  return new Response(JSON.stringify(buildAgentCard(origin), null, 2), {
    status: 200,
    headers: CARD_HEADERS,
  });
}
