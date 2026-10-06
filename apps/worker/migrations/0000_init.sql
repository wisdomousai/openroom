CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_tokens_user` ON `api_tokens` (`user_id`,"created_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_api_tokens_hash` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_user` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_expires` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `billing_account_sync` (
	`environment` text NOT NULL,
	`user_id` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`claim` text,
	`checked_at` integer,
	`next_at` integer DEFAULT 0 NOT NULL,
	`error` text,
	PRIMARY KEY(`environment`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_billing_account_sync_due` ON `billing_account_sync` (`environment`,`next_at`);--> statement-breakpoint
CREATE TABLE `billing_checkouts` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`user_id` text NOT NULL,
	`price_id` text NOT NULL,
	`transaction_id` text,
	`attempted_at` integer,
	`created_at` integer NOT NULL,
	`closed_at` integer,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`claim` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_billing_checkout_open` ON `billing_checkouts` (`environment`,`user_id`) WHERE "billing_checkouts"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_billing_checkout_transaction` ON `billing_checkouts` (`environment`,`transaction_id`);--> statement-breakpoint
CREATE TABLE `billing_customer_intents` (
	`environment` text NOT NULL,
	`user_id` text NOT NULL,
	`reference` text NOT NULL,
	`email` text NOT NULL,
	`attempted_at` integer,
	PRIMARY KEY(`environment`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `billing_customers` (
	`environment` text NOT NULL,
	`customer_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`environment`, `customer_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "billing_customers_environment_check" CHECK("billing_customers"."environment" IN ('sandbox','live'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_billing_customers_user` ON `billing_customers` (`environment`,`user_id`);--> statement-breakpoint
CREATE TABLE `billing_events` (
	`environment` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`event_order` text NOT NULL,
	`state_order` text,
	`source` text NOT NULL,
	`received_at` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`claim` text NOT NULL,
	`subscription_id` text,
	`subscription_status` text,
	`outcome` text NOT NULL,
	PRIMARY KEY(`environment`, `event_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_billing_events_subscription` ON `billing_events` (`environment`,`subscription_id`,`state_order`);--> statement-breakpoint
CREATE TABLE `billing_pending_events` (
	`environment` text NOT NULL,
	`event_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`event_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`source` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`environment`, `event_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_billing_pending_customer` ON `billing_pending_events` (`environment`,`customer_id`);--> statement-breakpoint
CREATE TABLE `billing_subscriptions` (
	`environment` text NOT NULL,
	`id` text NOT NULL,
	`customer_id` text NOT NULL,
	`status` text NOT NULL,
	`price_ids` text NOT NULL,
	`period_end` integer,
	`scheduled_end` integer,
	`event_id` text NOT NULL,
	`state_order` text NOT NULL,
	`state_rank` integer NOT NULL,
	PRIMARY KEY(`environment`, `id`),
	FOREIGN KEY (`environment`,`customer_id`) REFERENCES `billing_customers`(`environment`,`customer_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "billing_subscriptions_status_check" CHECK("billing_subscriptions"."status" IN ('active','trialing','past_due','paused','canceled'))
);
--> statement-breakpoint
CREATE INDEX `idx_billing_subscriptions_customer` ON `billing_subscriptions` (`environment`,`customer_id`);--> statement-breakpoint
CREATE TABLE `billing_sync` (
	`environment` text PRIMARY KEY NOT NULL,
	`cursor` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`claim` text,
	`checked_at` integer,
	`last_success_at` integer,
	`caught_up_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `brand_kits` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`design_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_brand_kits_space` ON `brand_kits` (`space_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `context_access_links` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`learner_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`context_id`) REFERENCES `contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`learner_id`) REFERENCES `context_learners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `context_access_links_token_hash_unique` ON `context_access_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_context_access` ON `context_access_links` (`context_id`,"created_at" DESC);--> statement-breakpoint
CREATE TABLE `context_learners` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`context_id`) REFERENCES `contexts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_context_learners_context` ON `context_learners` (`context_id`);--> statement-breakpoint
CREATE TABLE `contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`created_by` text NOT NULL,
	`kind` text DEFAULT 'person' NOT NULL,
	`display_name` text NOT NULL,
	`context_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`next_note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_contexts_space` ON `contexts` (`space_id`,`deleted_at`,"updated_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contexts_one_live_per_space` ON `contexts` (`space_id`) WHERE "contexts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `deck_drafts` (
	`deck_id` text PRIMARY KEY NOT NULL,
	`base_version` integer NOT NULL,
	`content_yaml` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `deck_file_links` (
	`file_id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deck_file_links_deck_id_unique` ON `deck_file_links` (`deck_id`);--> statement-breakpoint
CREATE TABLE `deck_file_locations` (
	`file_id` text NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`device_name` text NOT NULL,
	`path` text NOT NULL,
	`local_revision` integer NOT NULL,
	`content_hash` text NOT NULL,
	`synced_version` integer NOT NULL,
	`synced_hash` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`file_id`, `user_id`, `device_id`),
	FOREIGN KEY (`file_id`) REFERENCES `deck_file_links`(`file_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_deck_file_locations_user` ON `deck_file_locations` (`user_id`,"last_seen_at" DESC);--> statement-breakpoint
CREATE TABLE `deck_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`version` integer NOT NULL,
	`content_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`content_hash` text,
	`source_kind` text DEFAULT 'api' NOT NULL,
	`source_file_id` text,
	`source_local_revision` integer,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_deck_versions` ON `deck_versions` (`deck_id`,"version" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX `deck_versions_deck_id_version_unique` ON `deck_versions` (`deck_id`,`version`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`folder_id` text,
	`context_id` text,
	`created_by` text NOT NULL,
	`title` text NOT NULL,
	`shape` text DEFAULT 'tutoring' NOT NULL,
	`current_version` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_id`) REFERENCES `contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_decks_space` ON `decks` (`space_id`,`deleted_at`,"updated_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_decks_folder` ON `decks` (`folder_id`,"updated_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_decks_context` ON `decks` (`context_id`,`deleted_at`,"updated_at" DESC);--> statement-breakpoint
CREATE TABLE `deletion_intents` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`resource_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_deletion_intents_user` ON `deletion_intents` (`user_id`,"expires_at" DESC);--> statement-breakpoint
CREATE TABLE `desktop_auth_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_folders_space` ON `folders` (`space_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_folders_space_trash` ON `folders` (`space_id`,`deleted_at`,`parent_id`);--> statement-breakpoint
CREATE TABLE `item_tags` (
	`space_id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "item_tags_item_type_check" CHECK("item_tags"."item_type" IN ('deck', 'session', 'record', 'context'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_item_tags_unique` ON `item_tags` (`space_id`,`item_type`,`item_id`,`tag`);--> statement-breakpoint
CREATE INDEX `idx_item_tags_space` ON `item_tags` (`space_id`,`tag`);--> statement-breakpoint
CREATE INDEX `idx_item_tags_item` ON `item_tags` (`item_type`,`item_id`);--> statement-breakpoint
CREATE TABLE `learner_audio` (
	`submission_id` text PRIMARY KEY NOT NULL,
	`object_key` text,
	`sha256` text NOT NULL,
	`byte_length` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`submission_id`) REFERENCES `learner_submissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_learner_audio_expiry` ON `learner_audio` (`expires_at`);--> statement-breakpoint
CREATE TABLE `learner_auth_attempts` (
	`client_hash` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`failures` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_learner_auth_attempts_window` ON `learner_auth_attempts` (`window_start`);--> statement-breakpoint
CREATE TABLE `learner_feedback` (
	`submission_id` text PRIMARY KEY NOT NULL,
	`draft_json` text NOT NULL,
	`published_json` text,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `learner_submissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `learner_practice_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`context_id` text NOT NULL,
	`session_id` text NOT NULL,
	`item_id` text NOT NULL,
	`task_json` text NOT NULL,
	`task_hash` text NOT NULL,
	`answer_json` text NOT NULL,
	`grade` text NOT NULL,
	`assessment` text NOT NULL,
	`assignment_revision` integer NOT NULL,
	`srs_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `context_learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_learner_practice_attempts_context` ON `learner_practice_attempts` (`context_id`);--> statement-breakpoint
CREATE INDEX `idx_learner_practice_attempts_session` ON `learner_practice_attempts` (`session_id`);--> statement-breakpoint
CREATE TABLE `learner_srs` (
	`learner_id` text NOT NULL,
	`context_id` text NOT NULL,
	`item_id` text NOT NULL,
	`task_hash` text NOT NULL,
	`version` integer NOT NULL,
	`last_attempt_id` text NOT NULL,
	`ease` real NOT NULL,
	`interval_days` integer NOT NULL,
	`reps` integer NOT NULL,
	`lapses` integer NOT NULL,
	`due_at` integer NOT NULL,
	`last_grade` text,
	`last_answer` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`learner_id`, `item_id`),
	FOREIGN KEY (`learner_id`) REFERENCES `context_learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_attempt_id`) REFERENCES `learner_practice_attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_learner_srs_due` ON `learner_srs` (`learner_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_learner_srs_context` ON `learner_srs` (`context_id`,`last_grade`);--> statement-breakpoint
CREATE TABLE `learner_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`context_id` text NOT NULL,
	`session_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_json` text NOT NULL,
	`assignment_revision` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `context_learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_learner_submissions_context` ON `learner_submissions` (`context_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_learner_submissions_task` ON `learner_submissions` (`learner_id`,`session_id`,`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `live_sessions` (
	`code` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`title` text,
	`created_at` integer NOT NULL,
	`ended` integer DEFAULT 0 NOT NULL,
	`collaboration_enabled` integer DEFAULT 0 NOT NULL,
	`deck_id` text,
	`deck_version` integer,
	`session_id` text,
	`space_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_live_sessions_user` ON `live_sessions` (`user_id`,"created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_live_sessions_session` ON `live_sessions` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_live_sessions_deck` ON `live_sessions` (`deck_id`,"created_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_live_sessions_space` ON `live_sessions` (`space_id`,"created_at" DESC);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`key` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`name` text NOT NULL,
	`alt` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_media_assets_space` ON `media_assets` (`space_id`,"created_at" DESC);--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`challenge` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_codes_expiry` ON `oauth_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_connections_token_hash_unique` ON `oauth_connections` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_oauth_connections_user` ON `oauth_connections` (`user_id`);--> statement-breakpoint
CREATE TABLE `roster_seats` (
	`id` text PRIMARY KEY NOT NULL,
	`session_code` text NOT NULL,
	`display_name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`redeemed_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`session_code`) REFERENCES `session_rosters`(`session_code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roster_seats_token_hash_unique` ON `roster_seats` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_roster_seats_session` ON `roster_seats` (`session_code`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `session_archives` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_code` text NOT NULL,
	`r2_key` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_session_archives_user` ON `session_archives` (`user_id`,"created_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_session_archives_code` ON `session_archives` (`session_code`,"created_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_session_archives_expiry` ON `session_archives` (`expires_at`);--> statement-breakpoint
CREATE TABLE `session_records` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`context_id` text,
	`session_code` text,
	`deck_version` integer NOT NULL,
	`outcomes_json` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`homework_json` text DEFAULT '[]' NOT NULL,
	`homework_audience_json` text DEFAULT '{}' NOT NULL,
	`homework_revision` integer DEFAULT 1 NOT NULL,
	`artifacts_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`next_note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_id`) REFERENCES `contexts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_records_session_id_unique` ON `session_records` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_session_records_context` ON `session_records` (`context_id`,"updated_at" DESC);--> statement-breakpoint
CREATE TABLE `session_rosters` (
	`session_code` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`folder_id` text,
	`deck_id` text NOT NULL,
	`deck_version` integer DEFAULT 0 NOT NULL,
	`context_id` text,
	`created_by` text NOT NULL,
	`title` text NOT NULL,
	`shape` text DEFAULT 'tutoring' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`source_outline_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_id`) REFERENCES `contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_space` ON `sessions` (`space_id`,`deleted_at`,"updated_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_sessions_folder` ON `sessions` (`folder_id`,"updated_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_sessions_deck` ON `sessions` (`deck_id`,`deleted_at`,"updated_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_sessions_context` ON `sessions` (`context_id`,"created_at" DESC);--> statement-breakpoint
CREATE TABLE `space_contexts` (
	`space_id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_id`) REFERENCES `contexts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_space_contexts_context` ON `space_contexts` (`context_id`);--> statement-breakpoint
CREATE TABLE `space_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	`revoked_at` integer,
	CONSTRAINT "space_invites_role_check" CHECK("space_invites"."role" IN ('editor', 'presenter'))
);
--> statement-breakpoint
CREATE INDEX `idx_space_invites_space` ON `space_invites` (`space_id`,"created_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_space_invites_email` ON `space_invites` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_space_invites_pending` ON `space_invites` (`space_id`,`email`) WHERE "space_invites"."accepted_at" IS NULL AND "space_invites"."revoked_at" IS NULL;--> statement-breakpoint
CREATE TABLE `space_members` (
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`space_id`, `user_id`),
	CONSTRAINT "space_members_role_check" CHECK("space_members"."role" IN ('owner', 'editor', 'presenter'))
);
--> statement-breakpoint
CREATE INDEX `idx_space_members_user` ON `space_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_spaces_owner` ON `spaces` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`created_at` integer NOT NULL,
	`entitlements` text DEFAULT '{}' NOT NULL,
	`prefs` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);