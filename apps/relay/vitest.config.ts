/**
 * Relay tests run inside workerd via @cloudflare/vitest-pool-workers, with the
 * relay as the main worker so `runInDurableObject` reaches SessionDO.
 */
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TOKEN_SECRET: 'test-secret',
          RELAY_KEY: 'test-relay-key',
        },
      },
    }),
  ],
});
