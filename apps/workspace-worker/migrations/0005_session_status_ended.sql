-- Session status vocabulary: draft, live, ended (apps/workspace-worker/src/delivery/session-status.ts).
-- Recovery used to write 'completed' for sessions that were live; that is 'ended'.
UPDATE `sessions` SET `status` = 'ended' WHERE `status` = 'completed';
--> statement-breakpoint
-- A session whose live session has ended is ended, including one that was started
-- outside the launch (left 'draft') and a lobby ended without a start.
UPDATE `sessions` SET `status` = 'ended'
 WHERE `status` IN ('draft', 'live')
   AND EXISTS (SELECT 1 FROM `live_sessions` l WHERE l.`session_id` = `sessions`.`id` AND l.`ended` = 1);
