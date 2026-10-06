import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: '/host/',
  plugins: [tailwindcss()],
  // No @vitejs/plugin-react: esbuild's automatic JSX runtime is enough for a
  // build-and-test pipeline (fast refresh is a dev-only nicety we skip).
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    // LiveHost embeds the projector StageView from apps/stage (exact surface).
    alias: {
      '@': path.resolve(root, 'src'),
      // LiveHost embeds the projector StageView from apps/stage (exact surface).
      '@openroom/stage-src': path.resolve(root, '../stage/src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { host: path.resolve(root, "index.html"), checkout: path.resolve(root, "checkout.html") },
      // Radix / lucide ship Next.js "use client" directives; Vite ignores them.
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
