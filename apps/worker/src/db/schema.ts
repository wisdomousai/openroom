/**
 * D1 control-plane schema — the single source of truth.
 *
 * Every file under `apps/worker/migrations/` is GENERATED from this module by
 * drizzle-kit. Never handwrite SQL there. To change the schema:
 *
 *   1. edit this file
 *   2. `bun run db:generate` (drizzle-kit generate)
 *   3. commit the emitted `migrations/*.sql` and `migrations/meta/`
 *
 * Drizzle is used for schema definition and migration generation ONLY. The
 * worker's runtime keeps using raw `env.DB.prepare()` statements; nothing here
 * is imported by request-handling code.
 *
 * Deck/Session vocabulary throughout.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  createdAt: integer('created_at').notNull(),
  // Manual development grants for accounts not managed by Paddle. Once linked,
  // normalized billing records are the sole paid-access source.
  entitlements: text('entitlements').notNull().default('{}'),
  prefs: text('prefs').notNull().default('{}'),
});

// Customer ownership is established by authenticated checkout, never by webhook metadata.
export const billingCustomers = sqliteTable('billing_customers', {
  environment: text('environment').notNull(),
  customerId: text('customer_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.customerId] }),
  uniqueIndex('uidx_billing_customers_user').on(table.environment, table.userId),
  check('billing_customers_environment_check', sql`${table.environment} IN ('sandbox','live')`),
]);

export const billingCustomerIntents = sqliteTable('billing_customer_intents', {
  environment: text('environment').notNull(),
  userId: text('user_id').notNull().references(() => users.id),
  reference: text('reference').notNull(),
  email: text('email').notNull(),
  attemptedAt: integer('attempted_at'),
}, (table) => [primaryKey({ columns: [table.environment, table.userId] })]);

export const billingCheckouts = sqliteTable('billing_checkouts', {
  id: text('id').primaryKey(),
  environment: text('environment').notNull(),
  userId: text('user_id').notNull().references(() => users.id),
  priceId: text('price_id').notNull(),
  transactionId: text('transaction_id'),
  attemptedAt: integer('attempted_at'),
  createdAt: integer('created_at').notNull(),
  closedAt: integer('closed_at'),
  leaseUntil: integer('lease_until').notNull().default(0),
  claim: text('claim'),
}, (table) => [
  uniqueIndex('uidx_billing_checkout_open').on(table.environment, table.userId).where(sql`${table.closedAt} IS NULL`),
  uniqueIndex('uidx_billing_checkout_transaction').on(table.environment, table.transactionId),
]);

export const billingSubscriptions = sqliteTable('billing_subscriptions', {
  environment: text('environment').notNull(),
  id: text('id').notNull(),
  customerId: text('customer_id').notNull(),
  status: text('status').notNull(),
  priceIds: text('price_ids').notNull(),
  periodEnd: integer('period_end'),
  scheduledEnd: integer('scheduled_end'),
  eventId: text('event_id').notNull(),
  stateOrder: text('state_order').notNull(),
  stateRank: integer('state_rank').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.id] }),
  foreignKey({ columns: [table.environment, table.customerId], foreignColumns: [billingCustomers.environment, billingCustomers.customerId] }),
  index('idx_billing_subscriptions_customer').on(table.environment, table.customerId),
  check('billing_subscriptions_status_check', sql`${table.status} IN ('active','trialing','past_due','paused','canceled')`),
]);

/** Minimal verified billing observations from signed events or authenticated API reads. */
export const billingEvents = sqliteTable('billing_events', {
  environment: text('environment').notNull(),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  occurredAt: integer('occurred_at').notNull(),
  eventOrder: text('event_order').notNull(),
  stateOrder: text('state_order'),
  source: text('source').notNull(),
  receivedAt: integer('received_at').notNull(),
  payloadHash: text('payload_hash').notNull(),
  claim: text('claim').notNull(),
  subscriptionId: text('subscription_id'),
  subscriptionStatus: text('subscription_status'),
  outcome: text('outcome').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.eventId] }),
  index('idx_billing_events_subscription').on(table.environment, table.subscriptionId, table.stateOrder),
]);

/** Normalized verified events await account linking; no raw customer or payment fields. */
export const billingPendingEvents = sqliteTable('billing_pending_events', {
  environment: text('environment').notNull(),
  eventId: text('event_id').notNull(),
  customerId: text('customer_id').notNull(),
  eventJson: text('event_json').notNull(),
  payloadHash: text('payload_hash').notNull(),
  source: text('source').notNull(),
  receivedAt: integer('received_at').notNull(),
}, (table) => [primaryKey({ columns: [table.environment, table.eventId] }), index('idx_billing_pending_customer').on(table.environment, table.customerId)]);

/** Persisted cursor and lease; a stopped invocation resumes without guessing what ran. */
export const billingSync = sqliteTable('billing_sync', {
  environment: text('environment').primaryKey(),
  cursor: text('cursor'),
  leaseUntil: integer('lease_until').notNull().default(0),
  claim: text('claim'),
  checkedAt: integer('checked_at'),
  lastSuccessAt: integer('last_success_at'),
  caughtUpAt: integer('caught_up_at'),
  error: text('error'),
});
export const billingAccountSync = sqliteTable('billing_account_sync', {
  environment: text('environment').notNull(),
  userId: text('user_id').notNull().references(() => users.id),
  leaseUntil: integer('lease_until').notNull().default(0),
  claim: text('claim'),
  checkedAt: integer('checked_at'),
  nextAt: integer('next_at').notNull().default(0),
  error: text('error'),
}, (table) => [primaryKey({ columns: [table.environment, table.userId] }), index('idx_billing_account_sync_due').on(table.environment, table.nextAt)]);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    index('idx_auth_sessions_user').on(table.userId),
    index('idx_auth_sessions_expires').on(table.expiresAt),
  ],
);

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    tokenPrefix: text('token_prefix').notNull(),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
  },
  (table) => [
    index('idx_api_tokens_user').on(table.userId, sql`${table.createdAt} DESC`),
    index('idx_api_tokens_hash').on(table.tokenHash),
  ],
);

export const desktopAuthTickets = sqliteTable('desktop_auth_tickets', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const oauthCodes = sqliteTable('oauth_codes', {
  codeHash: text('code_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  clientId: text('client_id').notNull(),
  clientName: text('client_name').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  challenge: text('challenge').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [index('idx_oauth_codes_expiry').on(table.expiresAt)]);

export const oauthConnections = sqliteTable('oauth_connections', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  clientId: text('client_id').notNull(),
  clientName: text('client_name').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
}, (table) => [index('idx_oauth_connections_user').on(table.userId)]);

export const deletionIntents = sqliteTable(
  'deletion_intents',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    resourceName: text('resource_name').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (table) => [
    index('idx_deletion_intents_user').on(table.userId, sql`${table.expiresAt} DESC`),
  ],
);

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

export const spaces = sqliteTable(
  'spaces',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull().default(0),
    settings: text('settings').notNull().default('{}'),
  },
  (table) => [index('idx_spaces_owner').on(table.ownerUserId)],
);

/** Shared design presets. Applying a kit copies its resolved design into a deck. */
export const brandKits = sqliteTable('brand_kits', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id),
  name: text('name').notNull(),
  designJson: text('design_json').notNull(),
  revision: integer('revision').notNull().default(1),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => [index('idx_brand_kits_space').on(table.spaceId, table.deletedAt)]);

export const spaceMembers = sqliteTable(
  'space_members',
  {
    spaceId: text('space_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    invitedBy: text('invited_by'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.userId] }),
    check('space_members_role_check', sql`${table.role} IN ('owner', 'editor', 'presenter')`),
    index('idx_space_members_user').on(table.userId),
  ],
);

export const spaceInvites = sqliteTable(
  'space_invites',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    invitedBy: text('invited_by').notNull(),
    createdAt: integer('created_at').notNull(),
    acceptedAt: integer('accepted_at'),
    acceptedBy: text('accepted_by'),
    revokedAt: integer('revoked_at'),
  },
  (table) => [
    check('space_invites_role_check', sql`${table.role} IN ('editor', 'presenter')`),
    index('idx_space_invites_space').on(table.spaceId, sql`${table.createdAt} DESC`),
    index('idx_space_invites_email').on(table.email),
    uniqueIndex('idx_space_invites_pending')
      .on(table.spaceId, table.email)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
  ],
);

export const folders = sqliteTable(
  'folders',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (table) => [
    index('idx_folders_space').on(table.spaceId, table.sortOrder),
    index('idx_folders_space_trash').on(table.spaceId, table.deletedAt, table.parentId),
  ],
);

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

export const contexts = sqliteTable(
  'contexts',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull().default('person'),
    displayName: text('display_name').notNull(),
    contextJson: text('context_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
    nextNote: text('next_note').notNull().default(''),
  },
  (table) => [
    index('idx_contexts_space').on(table.spaceId, table.deletedAt, sql`${table.updatedAt} DESC`),
    // One live context per space.
    uniqueIndex('idx_contexts_one_live_per_space')
      .on(table.spaceId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const spaceContexts = sqliteTable(
  'space_contexts',
  {
    spaceId: text('space_id')
      .primaryKey()
      .references(() => spaces.id),
    contextId: text('context_id')
      .notNull()
      .references(() => contexts.id),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_space_contexts_context').on(table.contextId)],
);

/** Stable people within one context. Access links can be replaced independently. */
export const contextLearners = sqliteTable(
  'context_learners',
  {
    id: text('id').primaryKey(),
    contextId: text('context_id').notNull().references(() => contexts.id),
    displayName: text('display_name').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_context_learners_context').on(table.contextId)],
);

export const contextAccessLinks = sqliteTable(
  'context_access_links',
  {
    id: text('id').primaryKey(),
    contextId: text('context_id')
      .notNull()
      .references(() => contexts.id),
    learnerId: text('learner_id').notNull().references(() => contextLearners.id),
    tokenHash: text('token_hash').notNull().unique(),
    tokenPrefix: text('token_prefix').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at'),
    revokedAt: integer('revoked_at'),
  },
  (table) => [index('idx_context_access').on(table.contextId, sql`${table.createdAt} DESC`)],
);

// ---------------------------------------------------------------------------
// Decks (authoring)
// ---------------------------------------------------------------------------

export const decks = sqliteTable(
  'decks',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    folderId: text('folder_id').references(() => folders.id),
    contextId: text('context_id').references(() => contexts.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    shape: text('shape').notNull().default('tutoring'),
    currentVersion: integer('current_version').notNull().default(0),
    metadataJson: text('metadata_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (table) => [
    index('idx_decks_space').on(table.spaceId, table.deletedAt, sql`${table.updatedAt} DESC`),
    index('idx_decks_folder').on(table.folderId, sql`${table.updatedAt} DESC`),
    index('idx_decks_context').on(table.contextId, table.deletedAt, sql`${table.updatedAt} DESC`),
  ],
);

export const deckVersions = sqliteTable(
  'deck_versions',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id),
    version: integer('version').notNull(),
    contentJson: text('content_json').notNull(),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    contentHash: text('content_hash'),
    sourceKind: text('source_kind').notNull().default('api'),
    sourceFileId: text('source_file_id'),
    sourceLocalRevision: integer('source_local_revision'),
  },
  (table) => [
    unique('deck_versions_deck_id_version_unique').on(table.deckId, table.version),
    index('idx_deck_versions').on(table.deckId, sql`${table.version} DESC`),
  ],
);

export const deckDrafts = sqliteTable('deck_drafts', {
  deckId: text('deck_id')
    .primaryKey()
    .references(() => decks.id),
  baseVersion: integer('base_version').notNull(),
  contentYaml: text('content_yaml').notNull(),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by')
    .notNull()
    .references(() => users.id),
});

export const deckFileLinks = sqliteTable('deck_file_links', {
  fileId: text('file_id').primaryKey(),
  deckId: text('deck_id')
    .notNull()
    .unique()
    .references(() => decks.id, { onDelete: 'cascade' }),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at').notNull(),
});

export const deckFileLocations = sqliteTable(
  'deck_file_locations',
  {
    fileId: text('file_id')
      .notNull()
      .references(() => deckFileLinks.fileId, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: text('device_id').notNull(),
    deviceName: text('device_name').notNull(),
    path: text('path').notNull(),
    localRevision: integer('local_revision').notNull(),
    contentHash: text('content_hash').notNull(),
    syncedVersion: integer('synced_version').notNull(),
    syncedHash: text('synced_hash').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fileId, table.userId, table.deviceId] }),
    index('idx_deck_file_locations_user').on(table.userId, sql`${table.lastSeenAt} DESC`),
  ],
);

// ---------------------------------------------------------------------------
// Sessions (delivery)
// ---------------------------------------------------------------------------

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    folderId: text('folder_id').references(() => folders.id),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id),
    deckVersion: integer('deck_version').notNull().default(0),
    contextId: text('context_id').references(() => contexts.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    shape: text('shape').notNull().default('tutoring'),
    status: text('status').notNull().default('draft'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    // Frozen activity composition; never included in learner or session-list responses.
    sourceOutlineJson: text('source_outline_json'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (table) => [
    index('idx_sessions_space').on(table.spaceId, table.deletedAt, sql`${table.updatedAt} DESC`),
    index('idx_sessions_folder').on(table.folderId, sql`${table.updatedAt} DESC`),
    index('idx_sessions_deck').on(table.deckId, table.deletedAt, sql`${table.updatedAt} DESC`),
    index('idx_sessions_context').on(table.contextId, sql`${table.createdAt} DESC`),
  ],
);

export const sessionRecords = sqliteTable(
  'session_records',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .unique()
      .references(() => sessions.id),
    contextId: text('context_id').references(() => contexts.id),
    sessionCode: text('session_code'),
    deckVersion: integer('deck_version').notNull(),
    outcomesJson: text('outcomes_json').notNull().default('[]'),
    notes: text('notes').notNull().default(''),
    homeworkJson: text('homework_json').notNull().default('[]'),
    homeworkAudienceJson: text('homework_audience_json').notNull().default('{}'),
    homeworkRevision: integer('homework_revision').notNull().default(1),
    artifactsJson: text('artifacts_json').notNull().default('[]'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    nextNote: text('next_note').notNull().default(''),
  },
  (table) => [
    index('idx_session_records_context').on(table.contextId, sql`${table.updatedAt} DESC`),
  ],
);

// Live delivery: one row per join code.
export const liveSessions = sqliteTable(
  'live_sessions',
  {
    code: text('code').primaryKey(),
    userId: text('user_id'),
    title: text('title'),
    createdAt: integer('created_at').notNull(),
    ended: integer('ended').notNull().default(0),
    // Preserve collaboration already paid for when this session was created.
    collaborationEnabled: integer('collaboration_enabled').notNull().default(0),
    deckId: text('deck_id'),
    deckVersion: integer('deck_version'),
    sessionId: text('session_id'),
    spaceId: text('space_id'),
  },
  (table) => [
    index('idx_live_sessions_user').on(table.userId, sql`${table.createdAt} DESC`),
    uniqueIndex('uidx_live_sessions_session').on(table.sessionId),
    index('idx_live_sessions_deck').on(table.deckId, sql`${table.createdAt} DESC`),
    index('idx_live_sessions_space').on(table.spaceId, sql`${table.createdAt} DESC`),
  ],
);

export const sessionArchives = sqliteTable(
  'session_archives',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    sessionCode: text('session_code').notNull(),
    r2Key: text('r2_key').notNull(),
    kind: text('kind').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    index('idx_session_archives_user').on(table.userId, sql`${table.createdAt} DESC`),
    index('idx_session_archives_code').on(table.sessionCode, sql`${table.createdAt} DESC`),
    index('idx_session_archives_expiry').on(table.expiresAt),
  ],
);

export const sessionRosters = sqliteTable('session_rosters', {
  sessionCode: text('session_code').primaryKey(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at').notNull(),
});

export const rosterSeats = sqliteTable(
  'roster_seats',
  {
    id: text('id').primaryKey(),
    sessionCode: text('session_code')
      .notNull()
      .references(() => sessionRosters.sessionCode),
    displayName: text('display_name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: integer('created_at').notNull(),
    redeemedAt: integer('redeemed_at'),
    revokedAt: integer('revoked_at'),
  },
  (table) => [index('idx_roster_seats_session').on(table.sessionCode, table.revokedAt)],
);

// ---------------------------------------------------------------------------
// Tags and media
// ---------------------------------------------------------------------------

export const itemTags = sqliteTable(
  'item_tags',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    itemType: text('item_type').notNull(),
    itemId: text('item_id').notNull(),
    tag: text('tag').notNull(),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
  },
  (table) => [
    check(
      'item_tags_item_type_check',
      sql`${table.itemType} IN ('deck', 'session', 'record', 'context')`,
    ),
    uniqueIndex('idx_item_tags_unique').on(table.spaceId, table.itemType, table.itemId, table.tag),
    index('idx_item_tags_space').on(table.spaceId, table.tag),
    index('idx_item_tags_item').on(table.itemType, table.itemId),
  ],
);

export const mediaAssets = sqliteTable(
  'media_assets',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    key: text('key').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    name: text('name').notNull(),
    alt: text('alt'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_media_assets_space').on(table.spaceId, sql`${table.createdAt} DESC`)],
);

// ---------------------------------------------------------------------------
// Learner-facing state
// ---------------------------------------------------------------------------

export const learnerAuthAttempts = sqliteTable(
  'learner_auth_attempts',
  {
    clientHash: text('client_hash').primaryKey(),
    windowStart: integer('window_start').notNull(),
    failures: integer('failures').notNull(),
  },
  (table) => [index('idx_learner_auth_attempts_window').on(table.windowStart)],
);

export const learnerSubmissions = sqliteTable(
  'learner_submissions',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull().references(() => contextLearners.id),
    contextId: text('context_id').notNull(),
    sessionId: text('session_id').notNull().references(() => sessions.id),
    taskId: text('task_id').notNull(),
    taskJson: text('task_json').notNull(),
    assignmentRevision: integer('assignment_revision').notNull(),
    body: text('body').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_learner_submissions_context').on(table.contextId, table.createdAt),
    index('idx_learner_submissions_task').on(table.learnerId, table.sessionId, table.taskId, table.createdAt),
  ],
);

export const learnerFeedback = sqliteTable('learner_feedback', {
  submissionId: text('submission_id').primaryKey().references(() => learnerSubmissions.id),
  draftJson: text('draft_json').notNull(),
  publishedJson: text('published_json'),
  version: integer('version').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const learnerAudio = sqliteTable('learner_audio', {
  submissionId: text('submission_id').primaryKey().references(() => learnerSubmissions.id),
  objectKey: text('object_key'),
  sha256: text('sha256').notNull(),
  byteLength: integer('byte_length').notNull(),
  durationMs: integer('duration_ms').notNull(),
  expiresAt: integer('expires_at').notNull(),
  removedAt: integer('removed_at'),
}, (table) => [index('idx_learner_audio_expiry').on(table.expiresAt)]);

export const learnerPracticeAttempts = sqliteTable('learner_practice_attempts', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull().references(() => contextLearners.id),
  contextId: text('context_id').notNull(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  itemId: text('item_id').notNull(),
  taskJson: text('task_json').notNull(),
  taskHash: text('task_hash').notNull(),
  answerJson: text('answer_json').notNull(),
  grade: text('grade').notNull(),
  assessment: text('assessment').notNull(),
  assignmentRevision: integer('assignment_revision').notNull(),
  srsVersion: integer('srs_version').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_learner_practice_attempts_context').on(table.contextId), index('idx_learner_practice_attempts_session').on(table.sessionId)]);

export const learnerSrs = sqliteTable(
  'learner_srs',
  {
    learnerId: text('learner_id').notNull().references(() => contextLearners.id),
    contextId: text('context_id').notNull(),
    itemId: text('item_id').notNull(),
    taskHash: text('task_hash').notNull(),
    version: integer('version').notNull(),
    lastAttemptId: text('last_attempt_id').notNull().references(() => learnerPracticeAttempts.id),
    ease: real('ease').notNull(),
    intervalDays: integer('interval_days').notNull(),
    reps: integer('reps').notNull(),
    lapses: integer('lapses').notNull(),
    dueAt: integer('due_at').notNull(),
    lastGrade: text('last_grade'),
    lastAnswer: text('last_answer'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.learnerId, table.itemId] }),
    index('idx_learner_srs_due').on(table.learnerId, table.dueAt),
    index('idx_learner_srs_context').on(table.contextId, table.lastGrade),
  ],
);
