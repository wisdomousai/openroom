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
  it('loads a minimal function file, not a hidden copy of the task pane', () => {
    const xml = officeManifest('https://preview.example');
    expect(xml).toContain('<FunctionFile resid="OpenRoom.Commands.Url" />');
    expect(xml).toContain('<bt:Url id="OpenRoom.Commands.Url" DefaultValue="https://preview.example/office/commands.html" />');
  });
  it('names and draws the two add-ins differently in the Add-ins menu', () => {
    const pane = officeManifest('https://preview.example'), content = officeContentManifest('https://preview.example');
    const name = (xml: string) => /<DisplayName DefaultValue="([^"]+)"/.exec(xml)?.[1];
    const icon = (xml: string) => /<IconUrl DefaultValue="([^"]+)"/.exec(xml)?.[1];
    expect(name(pane)).toBe('OpenRoom'); expect(name(content)).toBe('OpenRoom Slide');
    expect(icon(pane)).not.toBe(icon(content));
  });
  it('gives the embedded display its own manifest and disables response snapshots in the saved file', () => {
    const content = officeContentManifest('https://preview.example');
    expect(content).toContain('xsi:type="ContentApp"');
    expect(content).toContain('DefaultValue="https://preview.example/office/content.html"');
    expect(content).toContain('<AllowSnapshot>false</AllowSnapshot>');
    expect(/<Id>([^<]+)<\/Id>/.exec(content)?.[1]).not.toBe(/<Id>([^<]+)<\/Id>/.exec(officeManifest('https://preview.example'))?.[1]);
  });
  it('keeps the content add-in version that embedded slides reference', () => {
    // Saved slides store this version; PowerPoint for Mac refuses a sideloaded add-in whose version differs.
    expect(/<Version>([^<]+)<\/Version>/.exec(officeContentManifest('https://preview.example'))?.[1]).toBe('1.0.2.0');
  });
});
