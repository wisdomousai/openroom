export const CLIENT_ID = 'openroom-powerpoint';
export interface Connection { token: string; id: string; expiresAt: number }
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function authorizationRequest(origin: string) {
  const verifier = random(), state = random();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const redirectUri = `${origin}/office/callback.html`;
  return { verifier, state, redirectUri, url: `${origin}/api/mcp/authorize?${new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256' })}` };
}

/** Treat dialog messages as untrusted. Codes travel only with exact origin and state. */
export function authorizationCode(event: { message?: string; origin?: string }, origin: string, state: string): string | null {
  if (event.origin !== origin || typeof event.message !== 'string' || event.message.length > 2048) return null;
  try {
    const value: unknown = JSON.parse(event.message);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    return item.type === 'openroom.oauth' && item.state === state && typeof item.code === 'string' && /^orcode_[A-Za-z0-9_-]{43}$/.test(item.code) ? item.code : null;
  } catch { return null; }
}

export async function signIn(office: typeof Office, origin = location.origin): Promise<Connection> {
  if (!office.context.requirements.isSetSupported('DialogApi', '1.1') || !office.context.requirements.isSetSupported('DialogOrigin', '1.1')) throw new Error('This PowerPoint version cannot verify sign-in messages. Update Office or use OpenRoom in your browser.');
  const flow = await authorizationRequest(origin);
  const code = await new Promise<string>((resolve, reject) => {
    let dialog: Office.Dialog | undefined, finished = false;
    const finish = (value?: string, error?: string) => {
      if (finished) return; finished = true; clearTimeout(timer); dialog?.close();
      if (value) resolve(value); else reject(new Error(error ?? 'Sign-in was closed. Try again when you are ready.'));
    };
    const timer = setTimeout(() => finish(undefined, 'Sign-in timed out. Please try again.'), 5 * 60 * 1000);
    office.context.ui.displayDialogAsync(flow.url, { height: 70, width: 45, displayInIframe: false }, (result) => {
      if (result.status !== office.AsyncResultStatus.Succeeded) { finish(undefined, 'PowerPoint could not open sign-in. Allow the dialog and try again.'); return; }
      dialog = result.value;
      if (finished) { dialog.close(); return; }
      dialog.addEventHandler(office.EventType.DialogMessageReceived, (event) => {
        if (!('message' in event)) return;
        const code = authorizationCode(event, origin, flow.state);
        if (code) finish(code);
      });
      dialog.addEventHandler(office.EventType.DialogEventReceived, () => finish());
    });
  });
  const response = await fetch(`${origin}/api/mcp/token`, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', client_id: CLIENT_ID, redirect_uri: flow.redirectUri, code, code_verifier: flow.verifier }) });
  const result = await response.json() as { access_token?: string; connection_id?: string; expires_in?: number };
  if (!response.ok || typeof result.access_token !== 'string' || !/^orauth_[A-Za-z0-9_-]{43}$/.test(result.access_token) || typeof result.connection_id !== 'string' || typeof result.expires_in !== 'number') throw new Error('Sign-in could not be completed. Please try again.');
  // Kept only in this task-pane runtime. Never write credentials to Office settings or tags.
  return { token: result.access_token, id: result.connection_id, expiresAt: Date.now() + result.expires_in * 1000 };
}

export async function disconnect(connection: Connection): Promise<void> {
  const response = await fetch('/api/mcp/revoke', { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: connection.token, client_id: CLIENT_ID }) });
  if (!response.ok) throw new Error('Could not revoke access. Check your connection and try again.');
}
