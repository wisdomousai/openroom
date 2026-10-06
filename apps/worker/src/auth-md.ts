/**
 * Auth.md agent-registration discovery (https://workos.com/auth-md).
 *
 * Serves the prose companion at GET /auth.md. Structured OAuth discovery stays
 * in mcp-oauth.ts (PRM + AS metadata); this document tells agents how to obtain
 * credentials for OpenRoom's MCP / HTTP surfaces without probing registration
 * POSTs during passive scans.
 */

const MD_HEADERS = {
  'content-type': 'text/markdown; charset=utf-8',
  'cache-control': 'public, max-age=300',
  'access-control-allow-origin': '*',
} as const;

/** Markdown body for GET /auth.md — origin-relative examples use the request host. */
export function authMdDocument(origin: string): string {
  const resource = `${origin}/api/mcp`;
  const prm = `${origin}/.well-known/oauth-protected-resource`;
  const register = `${origin}/api/mcp/register`;
  const authorize = `${origin}/api/mcp/authorize`;
  const token = `${origin}/api/mcp/token`;
  const mintPat = `${origin}/api/my/tokens`;
  const revokePat = `${origin}/api/my/tokens/{id}`;
  const host = `${origin}/host/`;
  const hostName = new URL(origin).host;

  return `# auth.md

You are an agent. This document tells you how to register a credential for **OpenRoom** — a live classroom interaction platform (polls, quizzes, scales, text walls, ranking, Q&A) exposed over MCP and HTTP. Follow the steps in order; do not skip ahead.

**Audience:** agents acting for a signed-in host (teacher / trainer) whose account has a verified email (Google OAuth, or demo auth in local/dev). There is no anonymous agent registration and no ID-JAG path today.

The resource server (MCP API) is ${resource}. The authorization server is ${origin} (same host).

## Step 1 — Discover

On a 401 from the MCP endpoint, read the \`WWW-Authenticate\` header:

\`\`\`http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="${prm}"
\`\`\`

Or fetch the conventional paths directly.

### 1a. Protected Resource Metadata

\`\`\`http
GET /.well-known/oauth-protected-resource
Host: ${hostName}
\`\`\`

Response:

\`\`\`json
{
  "resource": "${resource}",
  "resource_name": "OpenRoom",
  "authorization_servers": ["${origin}"],
  "scopes_supported": ["mcp"],
  "bearer_methods_supported": ["header"]
}
\`\`\`

### 1b. Authorization Server metadata

\`\`\`http
GET /.well-known/oauth-authorization-server
Host: ${hostName}
\`\`\`

Response includes \`issuer\` (must match the PRM authorization server), OAuth endpoints, and an \`agent_auth\` block:

\`\`\`json
{
  "issuer": "${origin}",
  "authorization_endpoint": "${authorize}",
  "token_endpoint": "${token}",
  "registration_endpoint": "${register}",
  "revocation_endpoint": "${origin}/api/mcp/revoke",
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["mcp"],
  "agent_auth": {
    "skill": "${origin}/auth.md",
    "register_uri": "${register}",
    "claim_uri": "${authorize}",
    "identity_types_supported": ["identity_assertion"],
    "identity_assertion": {
      "assertion_types_supported": ["verified_email"],
      "credential_types_supported": ["access_token", "api_key"]
    }
  }
}
\`\`\`

- \`register_uri\` — dynamic client registration (Step 3a).
- \`claim_uri\` — browser consent that binds the registration to a host with a verified email (Step 3b).
- \`identity_assertion\` / \`verified_email\` — credentials are issued only after an account holder approves (session or personal API token). Not ID-JAG; not anonymous.

## Step 2 — Pick a method

1. **OAuth client (ChatGPT connectors, Claude connectors, other OAuth-only agents)** → Method A (dynamic client registration + authorization code + PKCE). Preferred when the host can open a browser consent page.
2. **Personal API token (CLI, local agents, scripts)** → Method B. Requires a host session cookie; mint once in Settings or via POST ${mintPat}.

There is no anonymous pre-claim registration and no \`urn:ietf:params:oauth:token-type:id-jag\` path.

## Step 3 — Register

### Method A — OAuth (MCP front door)

#### 3a. Dynamic client registration

\`\`\`http
POST /api/mcp/register HTTP/1.1
Host: ${hostName}
Content-Type: application/json
\`\`\`

\`\`\`json
{
  "client_name": "Your agent",
  "redirect_uris": ["https://your-agent.example/oauth/callback"],
  "token_endpoint_auth_method": "none"
}
\`\`\`

Response (201):

\`\`\`json
{
  "client_id": "<signed-client-id>",
  "client_name": "Your agent",
  "redirect_uris": ["https://your-agent.example/oauth/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code"],
  "response_types": ["code"]
}
\`\`\`

#### 3b. Authorize (user consent / claim)

Send the host to:

\`\`\`http
GET /api/mcp/authorize?response_type=code&client_id=<client_id>&redirect_uri=<redirect_uri>&state=<state>&code_challenge=<S256>&code_challenge_method=S256
Host: ${hostName}
\`\`\`

The consent page accepts a signed-in OpenRoom session or a personal API token (\`orpat_…\`). The host reviews and submits the browser form; its consent proof is bound to the exact request and signed-in account. On approve it redirects with \`?code=…&state=…\`. Codes expire after ten minutes and can be redeemed once. Redirect URIs must match registration exactly, including loopback host and port.

#### 3c. Exchange the code

\`\`\`http
POST /api/mcp/token HTTP/1.1
Host: ${hostName}
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=<client_id>&code=<code>&redirect_uri=<redirect_uri>&code_verifier=<verifier>
\`\`\`

Response:

\`\`\`json
{
  "access_token": "<mcp-access-token>",
  "token_type": "Bearer",
  "expires_in": 2592000,
  "scope": "mcp",
  "connection_id": "<connection-id>"
}
\`\`\`

Credential type: \`access_token\` (Bearer, \`orauth_…\`). Lifetime: 30 days. Only its hash is stored server-side. The account's current permissions and entitlements apply. Re-run authorize + token when it expires or is revoked.

### Method B — Personal API token (\`api_key\`)

1. Host signs in at ${host} (Google OAuth verified email, or demo auth in local/dev).
2. Mint a token (Settings → Connect an agent, or HTTP):

\`\`\`http
POST /api/my/tokens HTTP/1.1
Host: ${hostName}
Content-Type: application/json
Cookie: <session>
X-CSRF-Token: <csrf>

{"name":"my-agent"}
\`\`\`

Response (201) returns the raw secret **once**:

\`\`\`json
{
  "id": "<token-id>",
  "name": "my-agent",
  "prefix": "orpat_…",
  "createdAt": 0,
  "token": "orpat_<id>_<secret>"
}
\`\`\`

Credential type: \`api_key\`. Format: \`orpat_…\`. Store it as a secret; only a SHA-256 hash is kept server-side. Max 10 active tokens per user. Revoke with DELETE ${revokePat} (session + CSRF).

## Step 4 — Use the credential

Present either credential as a Bearer token against the MCP resource:

\`\`\`http
POST /api/mcp HTTP/1.1
Host: ${hostName}
Authorization: Bearer <access_token-or-orpat>
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list"}
\`\`\`

Tools: \`outline_validate\`, \`session_create\`, \`session_status\`, \`session_results\`, \`openroom_api\`, and \`session_command\`. The tutoring API and live commands use the same application and Durable Object services as the browser. Permanent deletion only returns a short-lived confirmation URL; a signed-in browser must complete it.

Full agent skill index: ${origin}/.well-known/agent-skills/index.json (includes \`run-a-session\`). Site summary: ${origin}/llms.txt.

## Errors

| Status | Where | Meaning | What to do |
| ------ | ----- | ------- | ---------- |
| 401 | /api/mcp | Missing/invalid bearer | Discover via \`WWW-Authenticate\`, then Method A or B |
| 400 | /api/mcp/register | Invalid \`redirect_uris\` / metadata | Fix client metadata; HTTPS or loopback only |
| 400 | /api/mcp/token | \`invalid_grant\` / PKCE mismatch | Restart authorize with a fresh PKCE pair |
| 401 | /api/mcp/authorize (POST) | Credential rejected | Sign in, or use a valid \`orpat_…\` |
| 403 | /api/mcp/authorize (POST) | Consent proof changed or expired | Open authorization again and approve the fresh form |
| 401 | /api/my/tokens | No session | Sign in at ${host} first |
| 429 | any | Rate limited | Back off and retry |

## Revocation

- **Personal API token:** DELETE ${revokePat} while signed in (CSRF required). Immediate.
- **OAuth connection:** revoke in Settings → Connected applications, or DELETE ${origin}/api/my/connections/{id} using the owning account (cookie writes require CSRF). GET ${origin}/api/my/connections lists active connections without secrets. Revocation also disables host capabilities obtained through that connection.
- **OAuth token:** POST ${origin}/api/mcp/revoke with form fields \`token\` and \`client_id\`. Repeated or unknown tokens return success without disclosing whether a connection existed.
- **Sessions:** end with \`session.end\`; ballots purge 30 minutes after end; session deleted at 24 hours.

## Scope inventory

| Scope | Meaning |
| ----- | ------- |
| mcp | Validate outlines; manage tutoring records; create and control owned sessions; read owned-session status and aggregate results |

Do not probe POST /agent/auth or invent ID-JAG / anonymous registration — those endpoints are not offered. Public discovery documents are the source of truth: /auth.md, /.well-known/oauth-protected-resource, and /.well-known/oauth-authorization-server.
`;
}

export function authMdResponse(origin: string): Response {
  return new Response(authMdDocument(origin), { status: 200, headers: MD_HEADERS });
}
