/**
 * MCP Server Card (SEP-1649 / SEP-2127 discovery).
 *
 * Published at `GET /.well-known/mcp/server-card.json` so agents can find the
 * Streamable HTTP endpoint and capabilities without a prior MCP session.
 * Shape matches what agent-readiness scanners expect: serverInfo, transport
 * with `endpoint`, and capabilities for tools / resources / prompts.
 */

import { PROTOCOL_VERSION, type ServerInfo } from './server.js';
import { TOOL_DEFINITIONS } from './tools.js';

/** Identity advertised by initialize and by the discovery card. */
export const DEFAULT_SERVER_INFO: ServerInfo = {
  name: 'openroom',
  version: '1.0.0',
};

export interface McpServerCard {
  $schema: string;
  version: string;
  protocolVersion: string;
  serverInfo: ServerInfo & {
    description?: string;
    homepage?: string;
  };
  transport: {
    type: 'streamable-http';
    endpoint: string;
  };
  capabilities: {
    tools: boolean;
    resources: boolean;
    prompts: boolean;
  };
  tools: Array<{ name: string; description: string }>;
  authentication: {
    required: boolean;
    schemes: string[];
  };
}

export function buildMcpServerCard(options: {
  origin: string;
  serverInfo?: ServerInfo;
}): McpServerCard {
  const serverInfo = options.serverInfo ?? DEFAULT_SERVER_INFO;
  const origin = options.origin.replace(/\/$/, '');

  return {
    $schema: 'https://modelcontextprotocol.io/schemas/server-card/v1.0',
    version: '1.0',
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: {
      name: serverInfo.name,
      version: serverInfo.version,
      description:
        'OpenRoom facilitated interactions and tutoring sessions. Prepare and save typed outlines, ' +
        'manage contexts and decks, start sessions, control them live, and read aggregate results.',
      homepage: origin,
    },
    transport: {
      type: 'streamable-http',
      endpoint: `${origin}/api/mcp`,
    },
    // The preview resource is additive; text-only clients can ignore it.
    capabilities: {
      tools: true,
      resources: true,
      prompts: false,
    },
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
    authentication: {
      required: true,
      schemes: ['bearer', 'oauth2'],
    },
  };
}
