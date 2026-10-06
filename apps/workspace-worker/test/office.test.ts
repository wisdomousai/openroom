import { describe, expect, it } from 'vitest';
import { officeAssetHeaders, officeManifest, officeContentManifest } from '../src/office';

describe('Office app delivery', () => {
  it('replaces the asset frame denial with a bounded Office policy while keeping credentials out of caches', () => {
    const source = new Response('callback', { headers: { 'content-security-policy': "frame-ancestors 'none'", 'x-frame-options': 'DENY', 'cache-control': 'public, max-age=600' } });
    const result = officeAssetHeaders(source, '/office/callback.html');
    expect(result.headers.has('x-frame-options')).toBe(false);
    expect(result.headers.get('content-security-policy')).toContain('https://*.officeapps.live.com');
    expect(result.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(result.headers.get('content-security-policy')).toContain('script-src \'self\' https://appsforoffice.microsoft.com;');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');
    expect(source.headers.get('x-frame-options')).toBe('DENY');
  });
  it('keeps the manifest and callback app on the current deployment origin', () => {
    const xml = officeManifest('https://preview.example');
    expect(xml).toContain('DefaultValue="https://preview.example/office/taskpane.html"');
    expect(xml).toContain('<Host Name="Presentation" />');
    expect(xml).toContain('<Set Name="PowerPointApi" MinVersion="1.5" />');
  });
  it('gives the embedded display its own manifest and disables response snapshots in the saved file', () => {
    const content = officeContentManifest('https://preview.example');
    expect(content).toContain('xsi:type="ContentApp"');
    expect(content).toContain('DefaultValue="https://preview.example/office/content.html"');
    expect(content).toContain('<AllowSnapshot>false</AllowSnapshot>');
    expect(/<Id>([^<]+)<\/Id>/.exec(content)?.[1]).not.toBe(/<Id>([^<]+)<\/Id>/.exec(officeManifest('https://preview.example'))?.[1]);
  });
});
