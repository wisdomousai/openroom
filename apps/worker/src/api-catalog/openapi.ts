import { jsonHeaders } from './headers';

/**
 * The paid `continuity` capability (Notes, links, learner work, identified
 * sessions), read from the space owner (or the personal owner outside a space).
 * A deployment without billing holds every capability.
 */
const CONTINUITY_REQUIRED = { '403': { description: 'continuity-required: the space owner lacks the continuity capability. Data is retained; trash, restore and permanent deletion stay available.' } };

function recapOperations(account: boolean) {
  const parameters = [{ name: 'sessionCode', in: 'path', required: true, schema: { type: 'string' } }];
  const security = account ? [{ SessionCookie: [] }, { UserBearer: [] }] : [{ BearerAuth: [] }];
  const name = account ? 'Account' : 'Host';
  return {
    get: { operationId: `get${name}RecapCandidates`, summary: `Choose recap content (${account ? 'current account/space access' : 'host capability'})`, parameters, security, responses: { '200': { description: 'Revision, title, identity-free results, visible discussion and Q&A candidates. Nothing is selected.' }, '401': { description: 'Authentication required' }, '403': { description: 'Host access required' }, '404': { description: 'Session unavailable' }, '410': { description: 'Source responses purged' } } },
    post: { operationId: `prepare${name}Recap`, summary: 'Prepare selected recap JSON without saving or publishing', parameters, security: account ? [{ SessionCookie: [], CsrfHeader: [] }, { UserBearer: [] }] : security,
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['revision', 'title', 'resultIds', 'discussionIds', 'questionIds', 'discussion', 'followUp'], properties: {
        revision: { type: 'integer', minimum: 0 }, title: { type: 'string', minLength: 1, maxLength: 160 }, resultIds: { type: 'array', items: { type: 'string' }, maxItems: 200 }, discussionIds: { type: 'array', items: { type: 'string' }, maxItems: 200 }, questionIds: { type: 'array', items: { type: 'string' }, maxItems: 200 }, discussion: { type: 'string', maxLength: 10000 }, followUp: { type: 'string', maxLength: 10000 },
      } } } } }, responses: { '200': { description: 'Only selected results, discussion points, questions, authored summary and follow-up; excludes source ids and private teaching data' }, '401': { description: 'Authentication required' }, '403': { description: 'Host access or CSRF header required' }, '404': { description: 'Session unavailable' }, '409': { description: 'recap-source-changed; fetch and reselect' }, '410': { description: 'Source responses purged' }, '422': { description: 'Invalid, unavailable, empty or oversized selection' } },
    },
  };
}

function billingOperations() {
  const read = [{ UserBearer: [] }, { SessionCookie: [] }];
  const write = [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }];
  const errors = { '401': { description: 'Account authentication required' }, '403': { description: 'CSRF required for cookie writes' }, '404': { description: 'Owned billing resource unavailable' }, '409': { description: 'Checkout busy, changed, processing or an existing subscription; re-read account billing' }, '422': { description: 'Invalid body or unavailable approved price' }, '503': { description: 'Billing unconfigured, provider unavailable or an uncertain write awaiting recovery' } };
  const body = (key: string) => ({ required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: [key], properties: { [key]: { type: 'string' } } } } } });
  return {
    '/api/my/billing': { get: { operationId: 'getBilling', summary: 'Read current account subscription access and pending checkout', security: read, responses: { '200': { description: 'Availability, environment, subscription access, pendingCheckout and canManage; no payment details' }, ...errors } } },
    '/api/my/billing/plans': { get: { operationId: 'getBillingPlans', summary: 'Configured recurring plans with current Paddle prices', security: read, responses: { '200': { description: 'Plans: priceId, name, capabilities, amount in currency minor units, currency, interval, frequency, hasTrial' }, ...errors } } },
    '/api/my/billing/checkout': {
      get: { operationId: 'getCheckout', summary: 'Verify transaction ownership before opening or checking a payment', security: read, parameters: [{ name: 'transactionId', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Owned transactionId, status, subscriptionId, environment and public clientToken; never grants access' }, ...errors } },
      post: { operationId: 'startCheckout', summary: 'Start or recover one account-owned checkout', security: write, requestBody: body('priceId'), responses: { '200': { description: 'checkoutUrl and attemptId. The user reviews and completes payment in the browser.' }, ...errors } },
      delete: { operationId: 'cancelCheckout', summary: 'Cancel the current unpaid checkout; paid transactions cannot be canceled here', security: write, requestBody: body('attemptId'), responses: { '200': { description: 'Canceled' }, ...errors } },
    },
    '/api/my/billing/sync': { post: { operationId: 'syncBilling', summary: 'Reconcile this account with Paddle and recover uncertain writes without creating a purchase; at most once per minute', security: write, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } }, responses: { '200': { description: 'updated or recent, plus any safe checkoutIssue code' }, ...errors } } },
    '/api/my/billing/portal': { post: { operationId: 'createBillingPortal', summary: 'Create a temporary authenticated Paddle portal link for the current account', security: write, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } }, responses: { '200': { description: 'portalUrl; private, expiring, do not cache or store' }, ...errors } } },
  };
}

function sharingOperations() {
  const read = [{ UserBearer: [] }, { SessionCookie: [] }], write = [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }];
  const parameters = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string' } });
  const errors = { '400': { description: 'Invalid fields or protected owner' }, '401': { description: 'Account authentication required' }, '403': { description: 'Current role, owner-paid access or CSRF required' }, '404': { description: 'Space or invitation inaccessible' }, '409': { description: 'Invitation already accepted/revoked or member already present' } };
  const roleBody = { required: true, content: { 'application/json': { schema: { type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['editor', 'presenter'] } } } } } };
  return {
    '/api/my/spaces': {
      get: { operationId: 'listSpaces', summary: 'List spaces the authenticated account can open', security: read, responses: { '200': { description: 'Owned and shared spaces with effective roles' }, ...errors } },
      post: { operationId: 'createSpace', summary: 'Create a space owned by the authenticated account', security: write, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, experience: { type: 'string', enum: ['tutoring', 'classroom', 'training'] } } } } } }, responses: { '201': { description: 'Space created' }, ...errors } },
    },
    '/api/my/spaces/{spaceId}/members': { get: { operationId: 'listSpaceMembers', summary: 'Read current members; owners also receive pending invitations', security: read, parameters: [parameters('spaceId')], responses: { '200': { description: 'Current role and members; invitations for owner only' }, ...errors } } },
    '/api/my/spaces/{spaceId}/members/{userId}': {
      patch: { operationId: 'changeSpaceMemberRole', summary: 'Owner changes an existing member role; the owner cannot be demoted', security: write, parameters: [parameters('spaceId'), parameters('userId')], requestBody: roleBody, responses: { '200': { description: 'Role changed' }, ...errors } },
      delete: { operationId: 'removeSpaceMember', summary: 'Owner removes a member; retained credentials do not preserve access', security: write, parameters: [parameters('spaceId'), parameters('userId')], responses: { '200': { description: 'Member removed' }, ...errors } },
    },
    '/api/my/spaces/{spaceId}/invites': { post: { operationId: 'inviteSpaceMember', summary: 'Owner invites an explicitly chosen email under current paid collaboration access', security: write, parameters: [parameters('spaceId')], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'role'], properties: { email: { type: 'string' }, role: { type: 'string', enum: ['editor', 'presenter'] } } } } } }, responses: { '201': { description: 'Pending invitation created' }, ...errors } } },
    '/api/my/invites': { get: { operationId: 'listAccountInvitations', summary: 'Pending space invitations addressed to the current account', security: read, responses: { '200': { description: 'Pending invitations' }, ...errors } } },
    '/api/my/invites/{inviteId}': { delete: { operationId: 'revokeSpaceInvitation', summary: 'Owner revokes a pending invitation', security: write, parameters: [parameters('inviteId')], responses: { '200': { description: 'Invitation revoked' }, ...errors } } },
    '/api/my/invites/{inviteId}/accept': { post: { operationId: 'acceptSpaceInvitation', summary: 'Accept an invitation addressed to the account; current owner collaboration access is required', security: write, parameters: [parameters('inviteId')], responses: { '200': { description: 'Membership granted' }, ...errors } } },
  };
}

export function openapiDocument(origin: string): unknown {
  return {
    openapi: '3.1.0',
    info: {
      title: 'OpenRoom API',
      version: '0.2.0',
      description:
        'Business control plane for tutor-delivered sessions plus the live classroom runtime. Original school documents stay in the external preparation agent; OpenRoom stores typed outlines and presentation contexts (person, group, class, event).',
      contact: { url: origin },
    },
    servers: [{ url: origin }],
    paths: {
      ...billingOperations(),
      '/api/presentations/start': {
        post: {
          operationId: 'startPresentation', summary: 'Start or recover one frozen PowerPoint activity composition',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', additionalProperties: false, required: ['requestId', 'presentationId'], properties: {
              requestId: { type: 'string', format: 'uuid', description: 'Durable session identity; reuse after interruptions' },
              presentationId: { type: 'string', format: 'uuid' }, slideId: { type: 'string', description: 'Connected native slide to show initially' },
              activities: { type: 'array', minItems: 1, maxItems: 200, description: 'Required for first start, in native slide order; ignored on retry of an existing composition', items: {
                type: 'object', additionalProperties: false, required: ['slideId', 'spaceId', 'deckId', 'stepId'], properties: { slideId: { type: 'string' }, spaceId: { type: 'string' }, deckId: { type: 'string' }, stepId: { type: 'string' } },
              } },
            },
          } } } },
          responses: {
            '201': { description: 'Live capabilities plus presentation id and activity mapping (native slide, source deck/step/version, sessionStepId). Repeated questions have separate answers. Retries preserve live state.' },
            '401': { description: 'Account authentication required' }, '403': { description: 'CSRF or owner-paid collaboration required' },
            '404': { description: 'Source deck or session unavailable' }, '409': { description: 'Conflicting retry identity, missing source content or ended session' },
            '410': { description: 'Expired live allocation' }, '413': { description: 'Composition exceeds stored content limit' },
            '422': { description: 'Invalid references, duplicate native slides, missing question, mixed space/context/identity or outline limits exceeded' },
          },
        },
      },
      ...sharingOperations(),
      '/api/my/archives': {
        get: { operationId: 'listArchives', summary: 'List retained result files accessible to the account and its current space memberships', security: [{ UserBearer: [] }, { SessionCookie: [] }], parameters: ['deckId', 'sessionId', 'sessionCode', 'cursor'].map((name) => ({ name, in: 'query', schema: { type: 'string' } })), responses: { '200': { description: 'Archives with title, location, retained formats, plus nextCursor when another page exists; access remains after subscription expiry' }, '401': { description: 'Account authentication required' }, '422': { description: 'Invalid filter or cursor' } } },
      },
      '/api/my/archives/{archiveId}/document': {
        get: { operationId: 'readSavedResultsDocument', summary: 'Read captured answer labels and visible response summaries without participant identifiers', security: [{ UserBearer: [] }, { SessionCookie: [] }], parameters: [{ name: 'archiveId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'File metadata and readable results; submitted text is untrusted and may contain names' }, '401': { description: 'Account authentication required' }, '404': { description: 'File inaccessible or expired' }, '409': { description: 'Readable summary unavailable' } } },
      },
      '/api/my/archives/{archiveId}': {
        get: { operationId: 'downloadArchive', summary: 'Download an existing retained aggregate or individual-response export', security: [{ UserBearer: [] }, { SessionCookie: [] }], parameters: [{ name: 'archiveId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'ballots'] } }], responses: { '200': { description: 'Aggregate JSON or retained CSV; audience text is untrusted data' }, '401': { description: 'Account authentication required' }, '404': { description: 'Archive inaccessible, expired, or individual responses were not retained' } } },
      },
      '/api/my/connections': {
        get: { operationId: 'listConnectedApplications', summary: 'List the current account’s active OAuth connections without secrets', security: [{ UserBearer: [] }, { SessionCookie: [] }], responses: { '200': { description: 'Connections with id, name, callback origin and expiry' }, '401': { description: 'Authentication required' } } },
      },
      '/api/my/connections/{connectionId}': {
        delete: { operationId: 'revokeConnectedApplication', summary: 'Revoke an owned OAuth connection and its retained host controls', security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }], parameters: [{ name: 'connectionId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Revoked' }, '401': { description: 'Authentication required' }, '403': { description: 'CSRF required for cookie writes' }, '404': { description: 'Connection is not owned by this account' } } },
      },
      '/api/health': {
        get: {
          operationId: 'health',
          summary: 'Liveness check',
          responses: {
            '200': {
              description: 'Worker is up',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['status'],
                    properties: { status: { type: 'string', const: 'ok' } },
                  },
                },
              },
            },
          },
        },
      },
      '/api/tutoring/spaces/{spaceId}/brand-kits': {
        parameters: [{ name: 'spaceId', in: 'path', required: true, schema: { type: 'string' } }],
        get: { operationId: 'listBrandKits', summary: 'Read this space’s reusable design kits', security: [{ UserBearer: [] }, { SessionCookie: [] }], parameters: [{ name: 'trashed', in: 'query', schema: { type: 'string', enum: ['1'] } }], responses: { '200': { description: 'Brand kits and current editing permissions' }, '404': { description: 'Space not accessible' } } },
        post: { operationId: 'createBrandKit', summary: 'Save a shared design kit under the space owner’s branding entitlement', security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }], responses: { '201': { description: 'Brand kit created' }, '403': { description: 'Editor access and owner branding entitlement required' }, '422': { description: 'Invalid design, contrast or image ownership' } } },
      },
      '/api/tutoring/brand-kits/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: { operationId: 'getBrandKit', summary: 'Read one shared design kit', security: [{ UserBearer: [] }, { SessionCookie: [] }], responses: { '200': { description: 'Brand kit and current editing permissions' }, '404': { description: 'Kit not accessible' } } },
        patch: { operationId: 'updateBrandKit', summary: 'Update a kit without changing designs already copied into decks', security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }], responses: { '200': { description: 'Brand kit saved' }, '403': { description: 'Editor access and owner branding entitlement required' }, '409': { description: 'Stale revision or kit in trash' }, '422': { description: 'Invalid design, contrast or image ownership' } } },
        delete: { operationId: 'trashBrandKit', summary: 'Move a kit to recoverable trash', security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }], responses: { '200': { description: 'Kit moved to trash' }, '403': { description: 'Editor access required' } } },
      },
      '/api/tutoring/brand-kits/{id}/restore': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        post: { operationId: 'restoreBrandKit', summary: 'Restore a trashed brand kit', security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }], responses: { '200': { description: 'Brand kit restored' }, '403': { description: 'Editor access required' } } },
      },
      '/api/my/sessions/{code}/facilitate': {
        post: {
          operationId: 'facilitateSession',
          security: [{ SessionCookie: [], CsrfHeader: [] }, { UserBearer: [] }],
          summary: 'Join a live session through current account and space access',
          description: 'Uses account authentication, with CSRF for cookie writes. Joining does not take presentation control. Shared access uses the space owner’s team entitlement.',
          parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Session capabilities and current facilitator authority' },
            '401': { description: 'Account authentication required' },
            '403': { description: 'CSRF missing or session unavailable' },
            '404': { description: 'Session not accessible' },
          },
        },
      },
      '/api/join': {
        post: {
          operationId: 'joinSession',
          summary: 'Join a session with an 8-character code',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code'],
                  properties: {
                    code: { type: 'string' },
                    recoveryHandle: {
                      type: 'string',
                      description:
                        'Existing session-local handle used to recover a pseudonymous participant',
                    },
                    contextLink: {
                      type: 'string',
                      description:
                        'Context access link (orlnk_…) for an identified session. The session must ' +
                        'already be started by its host; a session still in the lobby answers ' +
                        '409 session-not-started. Creating an identified session requires the continuity ' +
                        'capability; joining one already running does not recheck it.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Joined',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['sessionCode', 'participantToken', 'participantId'],
                    properties: {
                      sessionCode: { type: 'string' },
                      participantToken: { type: 'string' },
                      participantId: { type: 'string' },
                      identityMode: { type: 'string' },
                      handle: { type: 'string' },
                    },
                  },
                },
              },
            },
            '400': { description: 'Missing session code or invalid recovery handle' },
            '404': { description: 'Unknown session or recovery handle' },
            '403': {
              description:
                'Identified session joined without a context link (context-link-required), or a ' +
                'link that is invalid, revoked, expired, or issued for a different context ' +
                '(context-link-invalid)',
            },
            '409': {
              description:
                'Handle recovery is unavailable for this session, a context link was offered to a ' +
                'session that is not identified (identified-join-unavailable), or the identified ' +
                'session has not been started yet (session-not-started)',
            },
            '429': { description: 'Too many failed recovery attempts' },
          },
        },
      },
      '/api/sessions/{sessionCode}/state': {
        get: {
          operationId: 'getSessionState',
          summary: 'Role-scoped session snapshot',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'sessionCode', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'role',
              in: 'query',
              required: true,
              schema: { type: 'string', enum: ['participant', 'stage', 'host'] },
            },
            {
              name: 'afterRevision',
              in: 'query',
              required: false,
              schema: { type: 'integer' },
              description: 'Return 304 when the session revision has not advanced past this value',
            },
          ],
          responses: {
            '200': { description: 'Snapshot including revision' },
            '304': { description: 'Unchanged since afterRevision' },
          },
        },
      },
      '/api/sessions/{sessionCode}/assets/{resourceId}': {
        put: {
          operationId: 'uploadSessionAsset',
          summary: 'Upload an embedded resource before starting a session',
          description: 'Ephemeral bytes stored with the session Durable Object. Max 20 MiB per resource and 50 MiB per session.',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'sessionCode', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'resourceId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/pdf': { schema: { type: 'string', format: 'binary' } },
              'image/*': { schema: { type: 'string', format: 'binary' } },
            },
          },
          responses: {
            '201': { description: 'Resource stored' },
            '409': { description: 'Session has already started' },
            '413': { description: 'Resource or session asset limit exceeded' },
          },
        },
        get: {
          operationId: 'readSessionAsset',
          summary: 'Read an ephemeral session resource',
          security: [],
          parameters: [
            { name: 'sessionCode', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'resourceId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { description: 'The bytes' },
            '206': { description: 'A single byte range' },
            '404': { description: 'Not found' },
          },
        },
        head: {
          operationId: 'headSessionAsset',
          summary: 'Read ephemeral session resource metadata',
          security: [],
          parameters: [
            { name: 'sessionCode', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'resourceId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { '200': { description: 'Resource metadata' }, '404': { description: 'Not found' } },
        },
      },
      '/api/sessions/{sessionCode}/commands': {
        post: {
          operationId: 'applyCommand',
          summary: 'Apply a command envelope (actor derived from the bearer token)',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'sessionCode', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['idempotencyKey', 'command'],
                  properties: {
                    idempotencyKey: { type: 'string' },
                    expectedRevision: { type: 'integer' },
                    command: {
                      type: 'object',
                      additionalProperties: true,
                      description:
                        'Domain command, e.g. { command: "interaction.open", interactionId: "…" }',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Applied',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean', const: true },
                      revision: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '409': { description: 'Revision conflict (E_REVISION_CONFLICT)' },
            '422': { description: 'Domain validation error' },
          },
        },
      },
      '/api/sessions/{sessionCode}/recap': recapOperations(false),
      '/api/my/sessions/{sessionCode}/recap': recapOperations(true),
      '/api/sessions/{sessionCode}/export': {
        get: {
          operationId: 'exportResults',
          summary: 'Export results (host token)',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'sessionCode', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'format',
              in: 'query',
              required: true,
              schema: { type: 'string', enum: ['csv', 'json', 'ballots'] },
              description:
                'json and csv are aggregates (free). ballots is the per-person file and requires rawExport or a roster session.',
            },
          ],
          responses: {
            '200': { description: 'Export body' },
            '403': { description: 'raw-export-required (ballots without entitlement)' },
            '410': { description: 'Ballots purged (ballots format only)' },
          },
        },
      },
      '/api/tutoring/contexts': {
        get: {
          operationId: 'listContexts',
          summary: 'List active or trashed presentation contexts',
          description:
            'Contexts answer who an outline is for: person, group, class, event, or other. '
            + 'Contexts need no paid capability. nextNote appears only while the space owner holds continuity.',
          security: [{ UserBearer: [] }, { SessionCookie: [] }],
          parameters: [
            { name: 'trash', in: 'query', schema: { type: 'string', enum: ['0', '1'] } },
            { name: 'spaceId', in: 'query', schema: { type: 'string' } },
            {
              name: 'kind',
              in: 'query',
              schema: { type: 'string', enum: ['person', 'group', 'class', 'event', 'other'] },
            },
          ],
          responses: { '200': { description: 'Context summaries' } },
        },
        post: {
          operationId: 'createContext',
          summary: 'Create a presentation context with curated notes',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['displayName'],
                  properties: {
                    displayName: { type: 'string' },
                    kind: {
                      type: 'string',
                      enum: ['person', 'group', 'class', 'event', 'other'],
                      description: 'Defaults to person',
                    },
                    spaceId: { type: 'string' },
                    context: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Context created' } },
        },
      },
      '/api/tutoring/contexts/{contextId}/returned': {
        get: {
          operationId: 'getContextReturned',
          summary: 'Writing and missed practice for this Card — no dates, no scores',
          security: [{ UserBearer: [] }, { SessionCookie: [] }],
          parameters: [{ name: 'contextId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Pickup pack' }, '403': { description: 'forbidden (presenter cannot read returned work) or continuity-required' } },
        },
      },
      '/api/tutoring/contexts/{contextId}': {
        get: {
          operationId: 'getContext',
          summary: 'Read a context and curated notes',
          security: [{ UserBearer: [] }, { SessionCookie: [] }],
          parameters: [{ name: 'contextId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Context detail' }, '404': { description: 'Not found' } },
        },
        patch: {
          operationId: 'updateContext',
          summary: 'Update context name, kind, or curated notes',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'contextId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Context updated' } },
        },
        delete: {
          operationId: 'trashContext',
          summary: 'Move a context to recoverable trash',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'contextId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Moved to trash; recoverable' } },
        },
      },
      '/api/tutoring/contexts/{contextId}/restore': {
        post: {
          operationId: 'restoreContext',
          summary: 'Restore a context from trash',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'contextId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Restored' } },
        },
      },
      '/api/tutoring/contexts/{contextId}/permanent-deletion': {
        post: {
          operationId: 'requestContextPurge',
          summary: 'Request a short-lived browser confirmation URL',
          description: 'The purge cannot be completed through this API, MCP, or CLI. A signed-in user must open and confirm the returned URL.',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'contextId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '202': { description: 'Browser confirmation required' } },
        },
      },

      '/api/decks': {
        get: {
          operationId: 'listDecks',
          summary: 'List decks (reusable content) in the space, optionally by space or folder',
          security: [{ UserBearer: [] }, { SessionCookie: [] }],
          parameters: [
            { name: 'trash', in: 'query', schema: { type: 'string', enum: ['0', '1'] } },
            { name: 'spaceId', in: 'query', schema: { type: 'string' } },
            { name: 'folderId', in: 'query', schema: { type: 'string' }, description: 'Folder id, or root for unfiled' },
          ],
          responses: { '200': { description: 'Deck summaries' } },
        },
        post: {
          operationId: 'createDeck',
          summary: 'Create a deck, optionally with its first typed content version',
          description:
            'The content contains derived outline material only. Original source documents remain in the external agent. Writes exactly one resource; pass createSession to also create a draft session in the same folder.',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', description: 'Falls back to the content title, then "Untitled"' },
                    shape: {
                      type: 'string',
                      enum: ['tutoring', 'lecture', 'meeting', 'event', 'interaction', 'other'],
                      description: 'Defaults to tutoring',
                    },
                    contextId: { type: 'string', description: 'Presentation context this deck is for' },
                    spaceId: { type: 'string', description: 'Workspace space; ignored when contextId or folderId resolves one' },
                    folderId: { type: 'string', description: 'Must belong to the same space' },
                    content: {
                      type: 'object',
                      additionalProperties: true,
                      description: 'Optional Outline v1; stored as immutable version 1',
                    },
                    metadata: { type: 'object', additionalProperties: true },
                    createSession: {
                      type: 'boolean',
                      description: 'Opt-in: also create a draft session of this deck',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Deck created (session included only when createSession was set)' },
            '404': { description: 'context or folder not found in this space' },
            '422': { description: 'Invalid Outline v1' },
          },
        },
      },
      '/api/decks/{deckId}': {
        get: {
          operationId: 'getDeck',
          summary: 'Read deck metadata and a content version',
          description: 'Returns { deck, spaceName, folderName, contentVersion, content }.',
          security: [{ UserBearer: [] }, { SessionCookie: [] }],
          parameters: [
            { name: 'deckId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'version', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'Deck and content' } },
        },
        patch: {
          operationId: 'updateDeck',
          summary: 'Update deck title, shape, location, or context default',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'deckId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    shape: { type: 'string', enum: ['tutoring', 'lecture', 'meeting', 'event', 'interaction', 'other'] },
                    contextId: { type: 'string', description: 'Required when changing context; omission keeps the current link' },
                    folderId: { type: ['string', 'null'], description: 'Must belong to the same space; null moves to root' },
                    metadata: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Deck updated' },
            '404': { description: 'context or folder not found in this space' },
            '409': { description: 'resource-in-trash' },
          },
        },
        delete: {
          operationId: 'trashDeck',
          summary: 'Move deck to trash',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'deckId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Trashed' } },
        },
      },
      '/api/decks/{deckId}/versions': {
        get: { operationId: 'listDeckVersions', summary: 'List immutable content versions', security: [{ UserBearer: [] }, { SessionCookie: [] }], parameters: [{ name: 'deckId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Versions' } } },
        post: {
          operationId: 'createDeckVersion',
          summary: 'Save content with optimistic baseVersion',
          description: 'Identical content returns { unchanged: true } and no new version.',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'deckId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['baseVersion', 'content'],
                  properties: {
                    baseVersion: { type: 'integer', description: 'Must equal the current version' },
                    content: { type: 'object', additionalProperties: true, description: 'Outline v1' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Version created' },
            '400': { description: 'base-version-required' },
            '409': { description: 'version-conflict or resource-in-trash' },
            '422': { description: 'invalid-content' },
          },
        },
      },
      '/api/decks/{deckId}/draft': {
        get: {
          operationId: 'getDeckDraft',
          summary: 'Read the rolling working draft (unsaved editor text)',
          description:
            'A draft is working text, not content: the source may not parse. 404 when there is no draft.',
          security: [{ UserBearer: [] }, { SessionCookie: [] }],
          parameters: [{ name: 'deckId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: '{ source, baseVersion, updatedAt, updatedBy }' },
            '404': { description: 'No draft for this deck' },
          },
        },
        put: {
          operationId: 'putDeckDraft',
          summary: 'Auto-save the working draft (no validation)',
          description:
            'Upserts the one draft row for this deck. Deliberately unvalidated so a half-typed outline still saves; creating a version clears the draft.',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'deckId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['source', 'baseVersion'],
                  properties: {
                    source: { type: 'string', description: 'Editor YAML, as typed (may be invalid)' },
                    baseVersion: { type: 'integer', description: 'Version this working text branched from' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: '{ savedAt }' },
            '400': { description: 'source-required or base-version-required' },
            '409': { description: 'resource-in-trash' },
            '413': { description: 'draft-too-large' },
          },
        },
        delete: {
          operationId: 'discardDeckDraft',
          summary: 'Discard the working draft',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'deckId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'Discarded' } },
        },
      },
      '/api/decks/{deckId}/restore': {
        post: { operationId: 'restoreDeck', summary: 'Restore deck from trash', security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }], parameters: [{ name: 'deckId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Restored' } } },
      },
      '/api/decks/{deckId}/permanent-deletion': {
        post: { operationId: 'requestDeckPurge', summary: 'Browser confirmation URL for permanent delete', security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }], parameters: [{ name: 'deckId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '202': { description: 'Confirmation required' } } },
      },
      '/api/sessions': {
        get: {
          operationId: 'listSessions',
          summary: 'List sessions; filter by deck, context, space, or folder',
          security: [{ UserBearer: [] }, { SessionCookie: [] }],
          parameters: [
            { name: 'trash', in: 'query', schema: { type: 'string', enum: ['0', '1'] } },
            { name: 'deckId', in: 'query', schema: { type: 'string' } },
            { name: 'contextId', in: 'query', schema: { type: 'string' } },
            { name: 'spaceId', in: 'query', schema: { type: 'string' } },
            { name: 'folderId', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Session summaries' } },
        },
        post: {
          operationId: 'createSession',
          summary: 'Create a session — durable from a deck, or live from an outline',
          description:
            'The body shape selects which kind is created. A `deckId` body files a '
            + 'durable session against a deck and answers `{ session }`. An `outline` '
            + 'body starts a live session immediately and answers the join code '
            + 'and the host/stage token pair.',
          security: [{ AdminKey: [] }, { UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  oneOf: [
                    { required: ['deckId'] },
                    { required: ['outline'] },
                  ],
                  properties: {
                    deckId: { type: 'string', description: 'Durable session: the deck it delivers' },
                    contextId: { type: 'string', description: 'Defaults to the deck context when omitted' },
                    deckVersion: { type: 'integer', description: 'Pin a version; defaults to the current one' },
                    title: { type: 'string', description: 'Falls back to the deck title' },
                    shape: { type: 'string', enum: ['tutoring', 'lecture', 'meeting', 'event', 'interaction', 'other'] },
                    folderId: { type: 'string', description: 'Must belong to the same space' },
                    outline: {
                      description: 'Live session: structured outline; embedded resources use resourceId references',
                      type: 'object',
                      additionalProperties: true,
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Session created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      session: { type: 'object', additionalProperties: true, description: 'Durable session summary' },
                      sessionCode: { type: 'string' },
                      code: { type: 'string' },
                      hostToken: { type: 'string' },
                      stageToken: { type: 'string' },
                      joinUrl: { type: 'string', format: 'uri' },
                    },
                  },
                },
              },
            },
            '403': { description: 'team-required, roster-required (identityMode roster) or continuity-required (identityMode identified), from the space owner or the creating account' },
            '404': { description: 'deck, context, or folder not found' },
            '422': { description: 'invalid-deck-version or status-server-owned' },
          },
        },
      },
      '/api/sessions/{sessionId}': {
        get: { operationId: 'getSession', summary: 'Read a session', security: [{ UserBearer: [] }, { SessionCookie: [] }], parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Session plus canEdit from current space role and trash state; writes recheck access independently' } } },
        patch: {
          operationId: 'updateSession',
          summary: 'Update session title, location, or context',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    contextId: { type: 'string', description: 'Required when changing context; omission keeps the current link' },
                    folderId: { type: ['string', 'null'], description: 'Must belong to the same space; null moves to root' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Updated' },
            '404': { description: 'context or folder not found in this space' },
            '409': { description: 'resource-in-trash' },
            '422': { description: 'status-server-owned or invalid-status' },
          },
        },
        delete: { operationId: 'trashSession', summary: 'Trash a session', security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }], parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Trashed' } } },
      },
      '/api/sessions/{sessionId}/launch': {
        post: {
          operationId: 'launchSession',
          summary: 'Launch a live session from this session',
          description: 'Copies the validated content into the session runtime and marks the session live.',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    version: { type: 'integer', description: 'Deck version; defaults to the version pinned on the session, else latest' },
                    start: { type: 'boolean', description: 'true starts the session immediately (session becomes live)' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Session created' },
            '403': { description: 'team-required, roster-required or continuity-required (identified sessions), from the space owner' },
            '409': { description: 'session-already-live or deck-content-not-found' },
          },
        },
      },
      '/api/sessions/{sessionId}/record': {
        get: { operationId: 'getSessionRecord', summary: 'Post-session outcomes record (Notes); requires the space owner’s continuity capability', security: [{ UserBearer: [] }, { SessionCookie: [] }], parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Record' }, ...CONTINUITY_REQUIRED } },
        put: {
          operationId: 'putSessionRecord',
          summary: 'Write compact outcomes (not a transcript; never per-participant ballots)',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    outcomes: { type: 'array', items: {}, maxItems: 50 },
                    notes: { type: 'string' },
                    nextNote: { type: 'string', description: 'Sticky on the Card: start here next time. Empty clears it.' },
                    homework: { type: 'array', items: {}, maxItems: 50 },
                    artifacts: { type: 'array', items: {}, maxItems: 50 },
                    sessionCode: { type: 'string' },
                    deckVersion: { type: 'integer', description: 'Must exist on the deck; defaults to the session version' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Saved' },
            ...CONTINUITY_REQUIRED,
            '409': { description: 'resource-in-trash' },
            '422': { description: 'record-arrays-too-large or invalid-deck-version' },
          },
        },
      },
      '/api/sessions/{sessionId}/restore': {
        post: { operationId: 'restoreSession', summary: 'Restore session from trash', security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }], parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Restored' } } },
      },
      '/api/sessions/{sessionId}/permanent-deletion': {
        post: { operationId: 'requestSessionPurge', summary: 'Browser confirmation URL', security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }], parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '202': { description: 'Confirmation required' } } },
      },
      '/api/tutoring/spaces/{spaceId}/assets': {
        get: {
          operationId: 'listSpaceAssets',
          summary: 'List uploaded media in a space',
          security: [{ UserBearer: [] }, { SessionCookie: [] }],
          parameters: [
            { name: 'spaceId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'query', in: 'query', required: false, schema: { type: 'string' }, description: 'Filters on file name and stored alt text' },
          ],
          responses: { '200': { description: 'Assets' }, '404': { description: 'Not a space you can open' } },
        },
        post: {
          operationId: 'uploadSpaceAsset',
          summary: 'Upload a picture, PDF, or video (raw bytes)',
          description:
            'The request body is the file bytes and Content-Type is the real media type (image/*, application/pdf, or video/mp4). Name and default alt text ride in the query string. Max 20 MiB. Requires the editor role. The returned `url` is a public, unguessable path.',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [
            { name: 'spaceId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'name', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'alt', in: 'query', required: false, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'image/*': { schema: { type: 'string', format: 'binary' } },
              'application/pdf': { schema: { type: 'string', format: 'binary' } },
              'video/mp4': { schema: { type: 'string', format: 'binary' } },
            },
          },
          responses: {
            '201': { description: 'Asset stored' },
            '403': { description: 'forbidden — presenter role cannot upload' },
            '413': { description: 'asset-too-large' },
            '415': { description: 'unsupported-media-type' },
          },
        },
      },
      '/api/tutoring/assets/{assetId}': {
        delete: {
          operationId: 'deleteAsset',
          summary: 'Delete an uploaded asset (bytes and index row)',
          security: [{ UserBearer: [] }, { SessionCookie: [], CsrfHeader: [] }],
          parameters: [{ name: 'assetId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
        },
      },
      '/api/assets/{assetId}': {
        get: {
          operationId: 'readAsset',
          summary: 'Read uploaded media (public)',
          description:
            'Unauthenticated on purpose: the asset id is a random UUID and acts as the capability, so the stage and participant surfaces can render the picture without a session. Immutable caching, ETag, and range requests are supported.',
          security: [],
          parameters: [{ name: 'assetId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'The bytes' },
            '206': { description: 'Partial content' },
            '304': { description: 'Not modified' },
            '404': { description: 'Not found' },
          },
        },
      },
      '/api/mcp': {
        post: {
          operationId: 'mcp',
          summary: 'Stateless MCP endpoint (Streamable HTTP, JSON only)',
          description:
            'JSON-RPC tools: outline_validate, session_create, session_status, session_results, openroom_api, deck_get, deck_preview, deck_save_version, deck_draft_put, deck_start, and session_command. deck_preview adds an optional read-only MCP Apps resource while retaining JSON text fallback. Permanent deletion confirmation is never exposed.',
          security: [{ BearerAuth: [] }],
          responses: {
            '200': { description: 'JSON-RPC response' },
            '401': { description: 'Missing or invalid bearer; WWW-Authenticate advertises OAuth metadata' },
          },
        },
      },
      '/api/a2a': {
        post: {
          operationId: 'a2a',
          summary: 'A2A JSON-RPC endpoint (Agent2Agent protocol)',
          description:
            'Discover via /.well-known/agent-card.json. Supports message/send; skills mirror MCP tools.',
          security: [{ BearerAuth: [] }],
          responses: {
            '200': { description: 'JSON-RPC response (Task or Message)' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        AdminKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-openroom-admin',
          description: 'Deployment admin key (ops override for session creation)',
        },
        SessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'or_session',
          description: 'Signed-in host session',
        },
        CsrfHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'x-openroom-csrf',
          description: 'Required with a host session on mutating control-plane routes',
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Session capability token, personal API token (orpat_…), MCP access token, or ADMIN_KEY',
        },
        UserBearer: {
          type: 'http',
          scheme: 'bearer',
          description: 'User-scoped personal API token (orpat_…) or OAuth access token',
        },
      },
    },
  };
}

export function openapiRoute(origin: string, method: string): Response {
  if (method === 'HEAD') {
    return new Response(null, { status: 200, headers: jsonHeaders() });
  }
  if (method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
      status: 405,
      headers: { ...jsonHeaders(), allow: 'GET, HEAD' },
    });
  }
  return new Response(JSON.stringify(openapiDocument(origin)), {
    status: 200,
    headers: jsonHeaders(),
  });
}
