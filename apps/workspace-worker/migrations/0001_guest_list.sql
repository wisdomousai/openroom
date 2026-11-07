-- Terminology: "roster" becomes "guest list". Hard break; the old names are not kept.
-- Tables: session_rosters -> guest_lists, roster_seats -> guest_links. Stored values:
-- identityMode "roster" -> "guest-list" in outlines, drafts and frozen session outlines;
-- entitlement key "roster" -> "guestList" in users.entitlements.
ALTER TABLE `session_rosters` RENAME TO `guest_lists`;--> statement-breakpoint
ALTER TABLE `roster_seats` RENAME TO `guest_links`;--> statement-breakpoint
DROP INDEX `roster_seats_token_hash_unique`;--> statement-breakpoint
DROP INDEX `idx_roster_seats_session`;--> statement-breakpoint
CREATE UNIQUE INDEX `guest_links_token_hash_unique` ON `guest_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_guest_links_session` ON `guest_links` (`session_code`,`revoked_at`);--> statement-breakpoint
UPDATE `deck_versions` SET `content_json` = REPLACE(REPLACE(`content_json`, '"identityMode":"roster"', '"identityMode":"guest-list"'), '"identityMode": "roster"', '"identityMode": "guest-list"') WHERE `content_json` LIKE '%"roster"%';--> statement-breakpoint
UPDATE `sessions` SET `source_outline_json` = REPLACE(REPLACE(`source_outline_json`, '"identityMode":"roster"', '"identityMode":"guest-list"'), '"identityMode": "roster"', '"identityMode": "guest-list"') WHERE `source_outline_json` LIKE '%"roster"%';--> statement-breakpoint
UPDATE `deck_drafts` SET `content_yaml` = REPLACE(REPLACE(REPLACE(REPLACE(`content_yaml`, 'identityMode: roster', 'identityMode: guest-list'), 'identityMode: "roster"', 'identityMode: "guest-list"'), 'identityMode: ''roster''', 'identityMode: ''guest-list'''), '"identityMode": "roster"', '"identityMode": "guest-list"') WHERE `content_yaml` LIKE '%roster%';--> statement-breakpoint
UPDATE `users` SET `entitlements` = REPLACE(`entitlements`, '"roster"', '"guestList"') WHERE `entitlements` LIKE '%"roster"%';
