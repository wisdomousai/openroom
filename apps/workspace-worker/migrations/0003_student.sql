-- Terminology: "context" (the tutoring entity) becomes "student". Hard break; the old names are not kept.
-- Tables: contexts -> students, context_learners -> student_learners, context_access_links ->
-- student_access_links, space_contexts -> space_students. Columns: context_id -> student_id (in
-- decks, sessions, session_records, learner_submissions, learner_practice_attempts, learner_srs,
-- student_learners, student_access_links, space_students) and contexts.context_json -> students.student_json.
-- Stored values: item_tags.item_type 'context' -> 'student' (the CHECK constraint forces a table
-- rebuild), deletion_intents.resource_type 'context' -> 'student', and the pinned-item kind
-- "context" -> "student" inside users.prefs. The JSON inside students.student_json keeps its keys
-- (level, goals, notes, ...); no key there carries the old name.
-- Old indexes are dropped first: SQLite cannot rewrite the partial index on contexts during RENAME.
DROP INDEX `context_access_links_token_hash_unique`;--> statement-breakpoint
DROP INDEX `idx_context_access`;--> statement-breakpoint
DROP INDEX `idx_context_learners_context`;--> statement-breakpoint
DROP INDEX `idx_contexts_space`;--> statement-breakpoint
DROP INDEX `idx_contexts_one_live_per_space`;--> statement-breakpoint
DROP INDEX `idx_decks_context`;--> statement-breakpoint
DROP INDEX `idx_learner_practice_attempts_context`;--> statement-breakpoint
DROP INDEX `idx_learner_srs_context`;--> statement-breakpoint
DROP INDEX `idx_learner_submissions_context`;--> statement-breakpoint
DROP INDEX `idx_session_records_context`;--> statement-breakpoint
DROP INDEX `idx_sessions_context`;--> statement-breakpoint
DROP INDEX `idx_space_contexts_context`;--> statement-breakpoint
ALTER TABLE `contexts` RENAME TO `students`;--> statement-breakpoint
ALTER TABLE `context_learners` RENAME TO `student_learners`;--> statement-breakpoint
ALTER TABLE `context_access_links` RENAME TO `student_access_links`;--> statement-breakpoint
ALTER TABLE `space_contexts` RENAME TO `space_students`;--> statement-breakpoint
ALTER TABLE `students` RENAME COLUMN `context_json` TO `student_json`;--> statement-breakpoint
ALTER TABLE `space_students` RENAME COLUMN `context_id` TO `student_id`;--> statement-breakpoint
ALTER TABLE `student_learners` RENAME COLUMN `context_id` TO `student_id`;--> statement-breakpoint
ALTER TABLE `student_access_links` RENAME COLUMN `context_id` TO `student_id`;--> statement-breakpoint
ALTER TABLE `decks` RENAME COLUMN `context_id` TO `student_id`;--> statement-breakpoint
ALTER TABLE `sessions` RENAME COLUMN `context_id` TO `student_id`;--> statement-breakpoint
ALTER TABLE `session_records` RENAME COLUMN `context_id` TO `student_id`;--> statement-breakpoint
ALTER TABLE `learner_submissions` RENAME COLUMN `context_id` TO `student_id`;--> statement-breakpoint
ALTER TABLE `learner_practice_attempts` RENAME COLUMN `context_id` TO `student_id`;--> statement-breakpoint
ALTER TABLE `learner_srs` RENAME COLUMN `context_id` TO `student_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `student_access_links_token_hash_unique` ON `student_access_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_student_access` ON `student_access_links` (`student_id`,"created_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_student_learners_student` ON `student_learners` (`student_id`);--> statement-breakpoint
CREATE INDEX `idx_students_space` ON `students` (`space_id`,`deleted_at`,"updated_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_students_one_live_per_space` ON `students` (`space_id`) WHERE "students"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_decks_student` ON `decks` (`student_id`,`deleted_at`,"updated_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_learner_practice_attempts_student` ON `learner_practice_attempts` (`student_id`);--> statement-breakpoint
CREATE INDEX `idx_learner_srs_student` ON `learner_srs` (`student_id`,`last_grade`);--> statement-breakpoint
CREATE INDEX `idx_learner_submissions_student` ON `learner_submissions` (`student_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_session_records_student` ON `session_records` (`student_id`,"updated_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_sessions_student` ON `sessions` (`student_id`,"created_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_space_students_student` ON `space_students` (`student_id`);--> statement-breakpoint
CREATE TABLE `__new_item_tags` (
	`space_id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "item_tags_item_type_check" CHECK("item_type" IN ('deck', 'session', 'record', 'student'))
);
--> statement-breakpoint
INSERT INTO `__new_item_tags`(`space_id`, `item_type`, `item_id`, `tag`, `created_at`, `created_by`) SELECT `space_id`, CASE WHEN `item_type` = 'context' THEN 'student' ELSE `item_type` END, `item_id`, `tag`, `created_at`, `created_by` FROM `item_tags`;--> statement-breakpoint
DROP TABLE `item_tags`;--> statement-breakpoint
ALTER TABLE `__new_item_tags` RENAME TO `item_tags`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_item_tags_unique` ON `item_tags` (`space_id`,`item_type`,`item_id`,`tag`);--> statement-breakpoint
CREATE INDEX `idx_item_tags_space` ON `item_tags` (`space_id`,`tag`);--> statement-breakpoint
CREATE INDEX `idx_item_tags_item` ON `item_tags` (`item_type`,`item_id`);--> statement-breakpoint
UPDATE `deletion_intents` SET `resource_type` = 'student' WHERE `resource_type` = 'context';--> statement-breakpoint
UPDATE `users` SET `prefs` = REPLACE(`prefs`, '"kind":"context"', '"kind":"student"') WHERE `prefs` LIKE '%"kind":"context"%';
