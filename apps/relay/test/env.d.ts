/**
 * Types for the `env` object exposed by `cloudflare:test`. Only what the
 * relay tests touch.
 */
declare namespace Cloudflare {
  interface Env {
    SESSIONS: DurableObjectNamespace;
    ASSETS: Fetcher;
    TOKEN_SECRET: string;
    RELAY_KEY?: string;
    JOIN_ORIGIN?: string;
  }
}
