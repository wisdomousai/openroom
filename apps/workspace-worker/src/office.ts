import type { Env } from './index';

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** Same-origin deployment manifest. Public document references need document-write permission. */
export function officeManifest(origin: string): string {
  const base = xml(origin);
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xsi:type="TaskPaneApp">
  <Id>a4d615bd-34ea-4d56-a147-460e24624b40</Id>
  <Version>1.0.1.0</Version>
  <ProviderName>OpenRoom</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="OpenRoom for PowerPoint" />
  <Description DefaultValue="Embed any OpenRoom slide in your presentation." />
  <IconUrl DefaultValue="${base}/office/icon-32.png" />
  <HighResolutionIconUrl DefaultValue="${base}/office/icon-64.png" />
  <SupportUrl DefaultValue="${base}/docs/" />
  <Hosts><Host Name="Presentation" /></Hosts>
  <Requirements><Sets DefaultMinVersion="1.1"><Set Name="PowerPointApi" MinVersion="1.5" /><Set Name="DialogApi" MinVersion="1.1" /></Sets></Requirements>
  <DefaultSettings><SourceLocation DefaultValue="${base}/office/taskpane.html" /></DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Requirements><bt:Sets DefaultMinVersion="1.1"><bt:Set Name="PowerPointApi" MinVersion="1.5" /><bt:Set Name="DialogApi" MinVersion="1.1" /><bt:Set Name="AddinCommands" MinVersion="1.1" /></bt:Sets></Requirements>
    <Hosts>
      <Host xsi:type="Presentation">
        <DesktopFormFactor>
          <FunctionFile resid="OpenRoom.Pane.Url" />
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="OpenRoom.Group">
                <Label resid="OpenRoom.Label" />
                <Icon><bt:Image size="16" resid="OpenRoom.Icon32" /><bt:Image size="32" resid="OpenRoom.Icon32" /><bt:Image size="80" resid="OpenRoom.Icon64" /></Icon>
                <Control xsi:type="Button" id="OpenRoom.OpenPane">
                  <Label resid="OpenRoom.Label" />
                  <Supertip><Title resid="OpenRoom.Label" /><Description resid="OpenRoom.Tooltip" /></Supertip>
                  <Icon><bt:Image size="16" resid="OpenRoom.Icon32" /><bt:Image size="32" resid="OpenRoom.Icon32" /><bt:Image size="80" resid="OpenRoom.Icon64" /></Icon>
                  <Action xsi:type="ShowTaskpane"><TaskpaneId>OpenRoom.Pane</TaskpaneId><SourceLocation resid="OpenRoom.Pane.Url" /></Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images><bt:Image id="OpenRoom.Icon32" DefaultValue="${base}/office/icon-32.png" /><bt:Image id="OpenRoom.Icon64" DefaultValue="${base}/office/icon-64.png" /></bt:Images>
      <bt:Urls><bt:Url id="OpenRoom.Pane.Url" DefaultValue="${base}/office/taskpane.html" /></bt:Urls>
      <bt:ShortStrings><bt:String id="OpenRoom.Label" DefaultValue="OpenRoom" /></bt:ShortStrings>
      <bt:LongStrings><bt:String id="OpenRoom.Tooltip" DefaultValue="Choose an OpenRoom slide, rehearse, or start audience participation." /></bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>`;
}

/** Separate ContentApp: Office does not combine content and task-pane runtimes in one manifest. */
export function officeContentManifest(origin: string): string {
  const base = xml(origin);
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="ContentApp">
  <Id>f765119e-b940-4b85-81a7-4b4d855b9d68</Id>
  <Version>1.0.1.0</Version>
  <ProviderName>OpenRoom</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="OpenRoom Slide" />
  <Description DefaultValue="Embed any OpenRoom slide, including content, media, exercises, and live questions." />
  <IconUrl DefaultValue="${base}/office/icon-32.png" />
  <HighResolutionIconUrl DefaultValue="${base}/office/icon-64.png" />
  <SupportUrl DefaultValue="${base}/docs/" />
  <Hosts><Host Name="Presentation" /></Hosts>
  <Requirements><Sets DefaultMinVersion="1.1"><Set Name="PowerPointApi" MinVersion="1.5" /><Set Name="Settings" MinVersion="1.1" /><Set Name="DialogApi" MinVersion="1.1" /></Sets></Requirements>
  <DefaultSettings><SourceLocation DefaultValue="${base}/office/content.html" /><RequestedWidth>960</RequestedWidth><RequestedHeight>540</RequestedHeight></DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <AllowSnapshot>false</AllowSnapshot>
</OfficeApp>`;
}

/** Office embedding is allowed only on its dedicated app, never on account/learner chrome. */
export function officeAssetHeaders(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers);
  headers.delete('x-frame-options');
  headers.set('content-security-policy', "default-src 'self'; script-src 'self' https://appsforoffice.microsoft.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self'; frame-src 'self' https:; frame-ancestors 'self' https://*.officeapps.live.com https://*.office.com https://*.cloud.microsoft https://*.sharepoint.com https://onedrive.live.com; base-uri 'none'; form-action 'self'; object-src 'none'");
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('permissions-policy', 'geolocation=(), microphone=(), camera=()');
  if (!pathname.includes('/assets/')) headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function serveOffice(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === '/office/manifest.xml') return new Response(officeManifest(url.origin), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  if (url.pathname === '/office/content-manifest.xml') return new Response(officeContentManifest(url.origin), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  // ASSETS canonicalizes *.html to extensionless URLs. Fetch that form internally,
  // so its redirect cannot drop the OAuth query before callback.js reads it.
  const path = url.pathname === '/office/' || url.pathname === '/office' ? '/office/taskpane' : /^\/office\/(taskpane|callback|display|content)\.html$/.test(url.pathname) ? url.pathname.slice(0, -5) : url.pathname;
  // Query parameters carry the dialog code only to the browser; the asset store does not need them.
  return officeAssetHeaders(await env.ASSETS.fetch(new Request(new URL(path, url.origin), request)), path);
}
