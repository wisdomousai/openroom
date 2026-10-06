import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  base: '/office/',
  esbuild: { jsx: 'automatic' },
  plugins: [tailwindcss()],
  build: { rollupOptions: { input: { taskpane: resolve(root, 'taskpane.html'), callback: resolve(root, 'callback.html'), display: resolve(root, 'display.html'), content: resolve(root, 'content.html') },
    onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning); },
    output: { manualChunks(id) { if (id.includes('node_modules/three')) return 'three'; } },
  } },
});
