/**
 * The largest live audience a session admits without the space owner's paid
 * `largeSessions` capability. Captured when the session is created, so a lapse
 * mid-session never removes anyone. Self-hosted deployments hold the capability.
 */
export const FREE_SESSION_PARTICIPANT_LIMIT = 50;
