/**
 * Desktop's core renderer, built into renderer/core and served by the main
 * process as openroom://app/core/. The workspace bundle sits beside it in
 * renderer/host when the build has one (scripts/copy-workspace.mjs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: '/core/',
  plugins: [tailwindcss()],
  // No @vitejs/plugin-react: esbuild's automatic JSX runtime is enough.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      // The live console embeds the projector StageView from apps/stage (exact surface).
      '@openroom/stage-src': path.resolve(root, '../../stage/src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: path.resolve(root, '../renderer/core'),
    emptyOutDir: true,
    rollupOptions: {
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
});
