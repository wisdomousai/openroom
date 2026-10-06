import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * The stage is served from `/stage/` by the worker's static asset handler and
 * collected from `dist/` — both must stay exactly as they are.
 *
 * The ambient WebGL layer is loaded with a dynamic `import()` so three.js and
 * @react-three/fiber land in their own chunk. A projector-theme session, a
 * reduced-motion projector or a machine without WebGL never fetches it.
 */
export default defineConfig({
  base: '/stage/',
  plugins: [tailwindcss()],
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
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
