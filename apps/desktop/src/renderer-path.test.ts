import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeRendererPath } from './renderer-path.js';

const root = resolve('/opt/openroom/renderer');

describe('safeRendererPath', () => {
  it('serves files inside the core and workspace bundles', () => {
    expect(safeRendererPath(root, '/core/index.html')).toBe(join(root, 'core', 'index.html'));
    expect(safeRendererPath(root, '/core/assets/main-1a2b.js')).toBe(join(root, 'core', 'assets', 'main-1a2b.js'));
    expect(safeRendererPath(root, '/host/index.html')).toBe(join(root, 'host', 'index.html'));
  });

  it('refuses the renderer root, its other entries and bundle directories themselves', () => {
    expect(safeRendererPath(root, '/')).toBeNull();
    expect(safeRendererPath(root, '/index.html')).toBeNull();
    expect(safeRendererPath(root, '/stage/index.html')).toBeNull();
    expect(safeRendererPath(root, '/core')).toBeNull();
    expect(safeRendererPath(root, '/corex/index.html')).toBeNull();
  });

  it('refuses paths that climb out of a bundle', () => {
    expect(safeRendererPath(root, '/core/../../main.js')).toBeNull();
    expect(safeRendererPath(root, '/core/%2e%2e/%2e%2e/main.js')).toBeNull();
    expect(safeRendererPath(root, '/host/..%2f..%2fpackage.json')).toBeNull();
    expect(safeRendererPath(root, '/core/../host/index.html')).toBe(join(root, 'host', 'index.html'));
  });

  it('refuses malformed escapes', () => {
    expect(safeRendererPath(root, '/core/%E0%A4%A')).toBeNull();
  });
});
