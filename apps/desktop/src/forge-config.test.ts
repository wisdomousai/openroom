import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { createForgeConfig } = createRequire(import.meta.url)('../scripts/forge-config.cjs');
const macRelease = {
  OPENROOM_DESKTOP_RELEASE: '1',
  OPENROOM_MAC_SIGN_IDENTITY: 'Developer ID Application: Test Only (TEST)',
  OPENROOM_APPLE_API_KEY: '/temporary/test-only.p8',
  OPENROOM_APPLE_API_KEY_ID: 'TEST',
  OPENROOM_APPLE_API_ISSUER: 'test-only',
};

describe('Desktop package signing', () => {
  it('allows a local Mac package without release credentials but requires every release credential', () => {
    expect(createForgeConfig({}, 'darwin').packagerConfig.osxSign.identity).toBe('-');
    for (const key of Object.keys(macRelease).filter((key) => key !== 'OPENROOM_DESKTOP_RELEASE')) {
      expect(() => createForgeConfig({ ...macRelease, [key]: '' }, 'darwin')).toThrow(key);
    }
    expect(() => createForgeConfig({ ...macRelease, OPENROOM_MAC_SIGN_IDENTITY: '-' }, 'darwin')).toThrow('Developer ID Application');
    expect(() => createForgeConfig({ ...macRelease, OPENROOM_APPLE_API_KEY: './test.p8' }, 'darwin')).toThrow('absolute file path');
    expect(() => createForgeConfig(macRelease, 'linux')).toThrow('macOS or Windows');
  });

  it('uses Developer ID plus notarization for a Mac release, and certificate signing for Windows', () => {
    const mac = createForgeConfig(macRelease, 'darwin').packagerConfig;
    expect(mac.osxSign.identity).toBe(macRelease.OPENROOM_MAC_SIGN_IDENTITY);
    expect(mac.osxNotarize).toEqual({ appleApiKey: macRelease.OPENROOM_APPLE_API_KEY, appleApiKeyId: 'TEST', appleApiIssuer: 'test-only' });
    const win = { OPENROOM_DESKTOP_RELEASE: '1', OPENROOM_WINDOWS_CERTIFICATE_FILE: '/temporary/test.pfx', OPENROOM_WINDOWS_CERTIFICATE_PASSWORD: 'test-only' };
    expect(() => createForgeConfig({ ...win, OPENROOM_WINDOWS_CERTIFICATE_PASSWORD: '' }, 'win32')).toThrow('OPENROOM_WINDOWS_CERTIFICATE_PASSWORD');
    expect(createForgeConfig(win, 'win32').makers[1].config).toMatchObject({ certificateFile: win.OPENROOM_WINDOWS_CERTIFICATE_FILE, certificatePassword: win.OPENROOM_WINDOWS_CERTIFICATE_PASSWORD });
  });

  it('keeps the bundled agent runtimes in Unix and Windows package paths', () => {
    const { ignore, asar } = createForgeConfig({}, 'win32').packagerConfig;
    expect(asar.unpack).toBe('**/node_modules/{@anthropic-ai,@openai}/**');
    for (const path of ['/node_modules', '/node_modules/@openai', '/node_modules/@openai/codex/vendor/codex', '\\node_modules\\@anthropic-ai\\claude-agent-sdk\\cli.js']) expect(ignore(path)).toBe(false);
    for (const path of ['/node_modules/unused-library/index.js', '\\node_modules\\unused-library\\index.js']) expect(ignore(path)).toBe(true);
  });
});
