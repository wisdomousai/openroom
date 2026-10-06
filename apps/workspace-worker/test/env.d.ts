/**
 * Types for the `env` object exposed by `cloudflare:test`.
 *
 * The pool declares `export const env: Cloudflare.Env`, and `Cloudflare.Env` is
 * an empty interface unless the project fills it in (normally via
 * `wrangler types`). We declare only what the tests actually touch.
 */
declare namespace Cloudflare {
  interface Env {
    SESSIONS: DurableObjectNamespace;
    RELAY: Fetcher;
    ASSETS: Fetcher;
    DB: D1Database;
    MEDIA: R2Bucket;
    TOKEN_SECRET: string;
    ADMIN_KEY: string;
    DEMO_AUTH?: string;
    JOIN_ORIGIN?: string;
    PIXABAY_API_KEY?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    OPENAI_APPS_CHALLENGE?: string;
    PADDLE_ENVIRONMENT?: string;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
