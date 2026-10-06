import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@openroom/stage-src': path.resolve(root, '../stage/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'renderer-src/**/*.test.{ts,tsx}'],
  },
});
