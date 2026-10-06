/**
 * Vite/vitest inline-as-string import suffix, used by lifecycle.test.ts to pull
 * in `examples/seg-camp.yaml` at transform time (no filesystem access exists
 * inside the workerd runtime the tests execute in).
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
