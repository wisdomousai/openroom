/**
 * WebMCP tools for OpenRoom (https://webmachinelearning.github.io/webmcp/).
 *
 * Agents discover these via navigator.modelContext / document.modelContext after
 * loading the page. No-ops on browsers without WebMCP.
 */
(function registerOpenRoomWebMcp() {
  'use strict';

  // Spec surface is document.modelContext; Chrome early preview and scanners
  // also look for navigator.modelContext.registerTool(...).
  var docMc =
    typeof document !== 'undefined' && document.modelContext
      ? document.modelContext
      : null;
  var navMc =
    typeof navigator !== 'undefined' && navigator.modelContext
      ? navigator.modelContext
      : null;

  if (!navMc && docMc) {
    try {
      Object.defineProperty(navigator, 'modelContext', {
        configurable: true,
        enumerable: true,
        get: function () {
          return docMc;
        },
      });
      navMc = navigator.modelContext;
    } catch (_) {
      /* ignore — some environments forbid redefining navigator props */
    }
  }

  var modelContext = navMc || docMc;
  if (!modelContext || typeof modelContext.registerTool !== 'function') {
    return;
  }

  var controller = new AbortController();
  var options = { signal: controller.signal };
  var origin = window.location.origin;
  var joinOrigin = origin.indexOf('openroom.app') !== -1 ? 'https://join.openroom.app' : origin + '/join';

  function textResult(text, structured) {
    return {
      content: [{ type: 'text', text: text }],
      structuredContent: structured || undefined,
    };
  }

  function go(pathOrUrl) {
    var url = pathOrUrl.indexOf('http') === 0 ? pathOrUrl : origin + pathOrUrl;
    window.location.assign(url);
    return textResult('Navigating to ' + url, { url: url });
  }

  // Prefer the navigator.modelContext.registerTool form so static scanners and
  // agent tooling that search page scripts for that call find a match.
  function register(tool) {
    if (navigator.modelContext && typeof navigator.modelContext.registerTool === 'function') {
      return navigator.modelContext.registerTool(tool, options);
    }
    return modelContext.registerTool(tool, options);
  }

  var tools = [
    {
      name: 'join_session',
      title: 'Join a session',
      description:
        'Open the participant join screen for an OpenRoom live session. ' +
        'Pass the 8-character session code shown on the host stage or host console.',
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '8-character session code (letters and digits).',
            minLength: 4,
            maxLength: 16,
          },
        },
        required: ['code'],
        additionalProperties: false,
      },
      execute: async function (input) {
        var raw = input && input.code != null ? String(input.code) : '';
        var code = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (code.length < 4) {
          throw new Error('Provide a valid session code (about 8 characters).');
        }
        var url = joinOrigin + '/?code=' + encodeURIComponent(code);
        return go(url);
      },
    },
    {
      name: 'open_host_console',
      title: 'Open host console',
      description:
        'Open the OpenRoom host console to build decks and start live polls, quizzes, and Q&A. ' +
        'Hosts sign in with Google (or demo auth in local/dev).',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async function () {
        return go('/host/');
      },
    },
    {
      name: 'open_documentation',
      title: 'Open documentation',
      description:
        'Open OpenRoom human documentation (how to start sessions, join, API overview).',
      inputSchema: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            description: 'Optional path under /docs/, default index.',
            enum: ['', 'index'],
          },
        },
        additionalProperties: false,
      },
      execute: async function () {
        return go('/docs/');
      },
    },
    {
      name: 'get_agent_discovery',
      title: 'List agent discovery endpoints',
      description:
        'Return URLs agents use to discover OpenRoom: llms.txt, MCP server card, ' +
        'A2A agent card, OAuth protected resource metadata, auth.md, and agent skills index.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async function () {
        var links = {
          site: origin + '/',
          llmsTxt: origin + '/llms.txt',
          llmsFullTxt: origin + '/llms-full.txt',
          authMd: origin + '/auth.md',
          openapi: origin + '/openapi.json',
          apiCatalog: origin + '/.well-known/api-catalog',
          mcpServerCard: origin + '/.well-known/mcp/server-card.json',
          mcpEndpoint: origin + '/api/mcp',
          agentCard: origin + '/.well-known/agent-card.json',
          a2aEndpoint: origin + '/api/a2a',
          oauthProtectedResource: origin + '/.well-known/oauth-protected-resource',
          oauthAuthorizationServer: origin + '/.well-known/oauth-authorization-server',
          agentSkills: origin + '/.well-known/agent-skills/index.json',
          hostConsole: origin + '/host/',
          join: joinOrigin + '/',
        };
        return textResult(JSON.stringify(links, null, 2), links);
      },
    },
    {
      name: 'get_site_summary',
      title: 'Get site summary (llms.txt)',
      description:
        'Fetch the LLM-oriented site summary from /llms.txt (what OpenRoom is, how agents and hosts use it).',
      inputSchema: {
        type: 'object',
        properties: {
          full: {
            type: 'boolean',
            description: 'If true, fetch /llms-full.txt instead of /llms.txt.',
            default: false,
          },
        },
        additionalProperties: false,
      },
      execute: async function (input) {
        var full = !!(input && input.full);
        var path = full ? '/llms-full.txt' : '/llms.txt';
        var res = await fetch(origin + path, {
          headers: { Accept: 'text/plain, text/markdown, */*' },
        });
        if (!res.ok) {
          throw new Error('Failed to fetch ' + path + ' (' + res.status + ')');
        }
        var body = await res.text();
        return textResult(body, { path: path, bytes: body.length });
      },
    },
    {
      name: 'open_sign_in',
      title: 'Sign in as host',
      description: 'Start Google sign-in for OpenRoom hosts (creates account on first visit).',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async function () {
        return go('/api/auth/google');
      },
    },
  ];

  // Fire-and-forget registration; WebMCP returns a Promise per tool.
  for (var i = 0; i < tools.length; i++) {
    try {
      var maybePromise = register(tools[i]);
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(function () {
          /* tool rejected or unsupported field — ignore */
        });
      }
    } catch (_) {
      /* older stubs may throw synchronously */
    }
  }

  // Expose abort for tests / SPA navigations that tear down the marketing page.
  window.__openroomWebMcpAbort = function () {
    controller.abort();
  };
})();
