const { posix, win32 } = require('node:path');

/** Shared by the workspace and staged app. Credential values are read at build time only. */
function createForgeConfig(env = process.env, platform = process.platform) {
  const release = env.OPENROOM_DESKTOP_RELEASE === '1';
  if (release && !['darwin', 'win32'].includes(platform)) throw new Error('Desktop releases must be built on macOS or Windows.');
  const required = release
    ? platform === 'darwin'
      ? ['OPENROOM_MAC_SIGN_IDENTITY', 'OPENROOM_APPLE_API_KEY', 'OPENROOM_APPLE_API_KEY_ID', 'OPENROOM_APPLE_API_ISSUER']
      : ['OPENROOM_WINDOWS_CERTIFICATE_FILE', 'OPENROOM_WINDOWS_CERTIFICATE_PASSWORD']
    : [];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Desktop release configuration missing: ${missing.join(', ')}`);
  if (release && platform === 'darwin' && !env.OPENROOM_MAC_SIGN_IDENTITY.startsWith('Developer ID Application: ')) {
    throw new Error('Desktop macOS releases require a Developer ID Application signing identity.');
  }
  if (release) {
    const key = platform === 'darwin' ? 'OPENROOM_APPLE_API_KEY' : 'OPENROOM_WINDOWS_CERTIFICATE_FILE';
    if (!(platform === 'darwin' ? posix : win32).isAbsolute(env[key])) throw new Error(`${key} must be an absolute file path.`);
  }

  return {
    packagerConfig: {
      // Agent runtimes spawn real executables; they cannot live inside the asar.
      asar: { unpack: '**/node_modules/{@anthropic-ai,@openai}/**' },
      prune: false,
      ignore: (path) => path.includes('node_modules') && !/node_modules(\/(@anthropic-ai|@openai)(\/.*)?)?$/.test(path.replaceAll('\\', '/')),
      appBundleId: 'app.openroom.desktop',
      appCategoryType: 'public.app-category.education',
      protocols: [{ name: 'OpenRoom', schemes: ['openroom'] }],
      extendInfo: {
        CFBundleDocumentTypes: [{
          CFBundleTypeName: 'OpenRoom deck',
          CFBundleTypeRole: 'Editor',
          LSHandlerRank: 'Owner',
          CFBundleTypeExtensions: ['openroom'],
        }],
      },
      ...(platform === 'darwin' ? {
        osxSign: { identity: env.OPENROOM_MAC_SIGN_IDENTITY || '-' },
        ...(release ? { osxNotarize: {
          appleApiKey: env.OPENROOM_APPLE_API_KEY,
          appleApiKeyId: env.OPENROOM_APPLE_API_KEY_ID,
          appleApiIssuer: env.OPENROOM_APPLE_API_ISSUER,
        } } : {}),
      } : {}),
    },
    makers: [
      { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
      { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: {
        name: 'OpenRoom',
        authors: 'OpenRoom',
        description: 'OpenRoom desktop client',
        certificateFile: env.OPENROOM_WINDOWS_CERTIFICATE_FILE,
        certificatePassword: env.OPENROOM_WINDOWS_CERTIFICATE_PASSWORD,
      } },
    ],
  };
}

module.exports = { createForgeConfig };
