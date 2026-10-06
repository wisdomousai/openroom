import { VOICE_TRASH_DAYS } from '@openroom/schema';

/** Prepare an isolated restored database. Never run against the source database. */
export function recoveryPreparation(now: number): string[] {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid recovery time');
  return [
    'DELETE FROM desktop_auth_tickets',
    'DELETE FROM auth_sessions',
    'DELETE FROM oauth_codes',
    'DELETE FROM deletion_intents',
    `UPDATE api_tokens SET revoked_at=COALESCE(revoked_at,${now})`,
    `UPDATE oauth_connections SET revoked_at=COALESCE(revoked_at,${now})`,
    `UPDATE context_access_links SET revoked_at=COALESCE(revoked_at,${now})`,
    `UPDATE space_invites SET revoked_at=COALESCE(revoked_at,${now}) WHERE accepted_at IS NULL`,
    // Membership may have been removed after the backup. Owners re-share after recovery.
    'DELETE FROM space_members WHERE user_id NOT IN (SELECT owner_user_id FROM spaces WHERE spaces.id=space_members.space_id)',
    // A recovery uses a fresh live-object namespace and a new TOKEN_SECRET.
    "UPDATE sessions SET status='completed' WHERE status='live'",
    'UPDATE live_sessions SET ended=1,collaboration_enabled=0',
    // Provider IDs and uncertain create markers survive; access is rebuilt from Paddle.
    "UPDATE users SET entitlements='{}'",
    'DELETE FROM billing_subscriptions',
    'DELETE FROM billing_events',
    'DELETE FROM billing_pending_events',
    'DELETE FROM billing_sync',
    'DELETE FROM billing_account_sync',
    'UPDATE billing_checkouts SET claim=NULL,lease_until=0',
    // Expired bytes are excluded from the bundle; preserve submissions and feedback.
    `UPDATE learner_audio SET object_key=NULL WHERE expires_at<=${now} OR removed_at<=${now - VOICE_TRASH_DAYS * 86_400_000}`,
    `DELETE FROM session_archives WHERE expires_at<=${now}`,
  ];
}

/** Only durable, currently retained objects. Live-session uploads belong to the live object. */
export function recoveryMediaInventory(now: number): string {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid recovery time');
  return `SELECT key AS object_key, size AS byte_length, NULL AS retained_until, NULL AS expected_sha256 FROM media_assets
UNION ALL SELECT object_key, byte_length, MIN(expires_at,COALESCE(removed_at+${VOICE_TRASH_DAYS * 86_400_000},expires_at)), sha256 FROM learner_audio
  WHERE object_key IS NOT NULL AND expires_at>${now} AND (removed_at IS NULL OR removed_at>${now - VOICE_TRASH_DAYS * 86_400_000})
UNION ALL SELECT r2_key, NULL AS byte_length, expires_at, NULL AS expected_sha256 FROM session_archives WHERE expires_at>${now}`;
}
