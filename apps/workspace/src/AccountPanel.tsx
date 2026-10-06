import { useForm } from '@tanstack/react-form';
import { useCallback, useState } from 'react';
import { demoLogin, logout, signInUrl } from './api';
import { desktopBridge } from './desktop-bridge';
import { useDevLoginOnly } from './lib/local-auth';
import type { AuthSession } from './useAuth';
import { Button } from '@openroom/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@openroom/ui/components/card';
import { Input } from '@openroom/ui/components/input';
import { Label } from '@openroom/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@openroom/ui/components/select';

/** Shared password for every static demo account (dev only). */
const DEMO_PASSWORD = 'demo';

function DemoSignInForm({
  accounts,
  session,
}: {
  accounts: NonNullable<AuthSession['authStatus']>['accounts'];
  session: AuthSession;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      username: accounts[0]?.username ?? '',
      password: DEMO_PASSWORD,
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await demoLogin(value.username.trim(), value.password);
        await session.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Sign-in failed');
      }
    },
  });

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
      <form.Field name="username" validators={{ onChange: ({ value }) => value.trim() === '' ? 'Enter a username.' : undefined }}>
        {(field) => (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="demo-account">Demo account</Label>
              <Select value={field.state.value} onValueChange={(value) => { field.handleChange(value); setError(null); }}>
                <SelectTrigger id="demo-account" className="w-full"><SelectValue placeholder="Pick an account" /></SelectTrigger>
                <SelectContent>{accounts.map((account) => <SelectItem key={account.username} value={account.username}>{account.name} · {account.email}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="demo-username">Username</Label>
              <Input id="demo-username" autoComplete="username" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} aria-invalid={field.state.meta.errors.length > 0} />
              {field.state.meta.errors[0] ? <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p> : null}
            </div>
          </>
        )}
      </form.Field>
      <form.Field name="password" validators={{ onChange: ({ value }) => value === '' ? 'Enter a password.' : undefined }}>
        {(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="demo-password">Password</Label><Input id="demo-password" type="password" autoComplete="current-password" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} aria-invalid={field.state.meta.errors.length > 0} />{field.state.meta.errors[0] ? <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p> : null}</div>}
      </form.Field>
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : <p className="text-xs text-muted-foreground">Dev only: password for every demo account is <code className="rounded bg-muted px-1 py-0.5 text-foreground">demo</code>.</p>}
      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>{([canSubmit, isSubmitting]) => <Button type="submit" disabled={!canSubmit || isSubmitting} className="w-fit">{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>}</form.Subscribe>
    </form>
  );
}

/** Sign-in / signed-in identity card. */
export function AccountPanel({ session }: { session: AuthSession }) {
  const [busy, setBusy] = useState(false);

  const accounts = session.authStatus?.accounts ?? [];

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await logout();
    } catch {
      /* the cookie is cleared server-side or was already invalid */
    } finally {
      setBusy(false);
      session.clear();
    }
  }, [session]);

  if (session.user === undefined) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Checking your account…</p>
        </CardContent>
      </Card>
    );
  }

  if (session.user === null) {
    const status = session.authStatus;
    if (status === null) {
      return (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Checking your account…</p>
          </CardContent>
        </Card>
      );
    }

    const devLoginOnly = useDevLoginOnly(window.location.hostname, desktopBridge() !== null);
    if (!session.canSignIn && !devLoginOnly) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Sign-in is not configured on this deployment. Ask the deployment operator to enable
              a sign-in method.
            </p>
          </CardContent>
        </Card>
      );
    }

    const showDemo = status.demo;
    const showGoogle = status.google && !devLoginOnly;

    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {showDemo
              ? showGoogle ? 'Choose a sign-in method.' : 'Sign in with a demo account.'
              : showGoogle ? 'Sign in with Google.' : 'Demo sign-in is not enabled.'}
          </p>

          {showDemo ? <DemoSignInForm accounts={accounts} session={session} /> : null}

          {devLoginOnly && !showDemo ? (
            <p className="text-xs text-muted-foreground">
              Local Desktop uses demo accounts. Set <code className="rounded bg-muted px-1 py-0.5">DEMO_AUTH=1</code> in{' '}
              <code className="rounded bg-muted px-1 py-0.5">apps/workspace-worker/.dev.vars</code> and restart.
            </p>
          ) : null}

          {showGoogle ? (
            <div className={showDemo ? 'flex flex-col gap-2 border-t border-border pt-3' : ''}>
              {showDemo ? (
                <p className="text-xs text-muted-foreground">Or use Google on this deployment:</p>
              ) : null}
              {desktopBridge() !== null ? (
                <Button
                  className="w-fit"
                  variant={showDemo ? 'outline' : 'default'}
                  onClick={() => void desktopBridge()?.openSignIn()}
                >
                  Sign in with Google
                </Button>
              ) : (
                <Button asChild className="w-fit" variant={showDemo ? 'outline' : 'default'}>
                  <a href={signInUrl()}>Sign in with Google</a>
                </Button>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <div className="text-sm font-medium">{session.user.name ?? session.user.email}</div>
          <div className="text-xs text-muted-foreground">{session.user.email}</div>
        </div>
        <Button variant="outline" size="sm" className="w-fit" onClick={() => void signOut()} disabled={busy}>
          {busy ? 'Signing out…' : 'Sign out'}
        </Button>
      </CardContent>
    </Card>
  );
}
