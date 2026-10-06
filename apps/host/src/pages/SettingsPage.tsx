import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { AccountPanel } from '../AccountPanel';
import { ConnectedApps } from '../components/ConnectedApps';
import {
  listApiTokens,
  mintApiToken,
  revokeApiToken,
  type ApiTokenSummary,
  type MintedApiToken,
} from '../api';
import {
  CollectionMeta,
  CollectionToolbar,
  ConfirmActionDialog,
  ManagementTable,
  RowActions,
} from '../components/ManagementTable';
import type { AuthSession } from '../useAuth';
import { Button } from '@openroom/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@openroom/ui/components/card';
import { DropdownMenuItem } from '@openroom/ui/components/dropdown-menu';
import { Input } from '@openroom/ui/components/input';
import { Label } from '@openroom/ui/components/label';
import { Link } from '@tanstack/react-router';

import { to } from '../destinations';
import { PageHeading, messageOf } from './tutor/shared';

function CopyButton({ label, value, disabled }: { label: string; value: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={() => {
        void navigator.clipboard?.writeText?.(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

function formatWhen(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

/** Install helpers + personal token management for MCP clients. */
function AgentAccessCard({ signedIn }: { signedIn: boolean }) {
  const origin = window.location.origin;
  const mcpUrl = `${origin}/api/mcp`;
  const [query, setQuery] = useState('');
  const [pendingRevoke, setPendingRevoke] = useState<ApiTokenSummary | null>(null);
  const queryClient = useQueryClient();
  const tokensQuery = useQuery({
    queryKey: ['settings', 'api-tokens'] as const,
    queryFn: listApiTokens,
    enabled: signedIn,
  });
  const tokens = tokensQuery.data ?? null;

  const visibleTokens = (tokens ?? []).filter((token) => {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${token.name} ${token.prefix}`.toLocaleLowerCase().includes(needle);
  });

  const revokeMutation = useMutation({
    mutationFn: revokeApiToken,
    onSuccess: async () => {
      setPendingRevoke(null);
      await queryClient.invalidateQueries({ queryKey: ['settings', 'api-tokens'] });
    },
  });
  const error = revokeMutation.error
    ? messageOf(revokeMutation.error, 'Could not revoke token')
    : tokensQuery.error
      ? messageOf(tokensQuery.error, 'Could not load tokens')
      : null;

  const claudeCodeCmd = `claude mcp add --transport http openroom ${mcpUrl} --header "Authorization: Bearer <TOKEN>"`;
  const authHeader = 'Authorization: Bearer <TOKEN>';

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Connect an agent (MCP)</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {signedIn ? (
          <div className="flex flex-col gap-3 rounded border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Personal API tokens</p>
                <p className="text-xs text-muted-foreground">The secret is shown once when you create a token.</p>
              </div>
              <Button asChild size="sm"><Link {...to.settingsTokenNew()}>Create token</Link></Button>
            </div>
            {tokens === null ? <p className="text-xs text-muted-foreground">Loading tokens…</p> : (
              <div className="flex flex-col gap-3">
                <CollectionToolbar value={query} onChange={setQuery} placeholder="Search tokens…" />
                <CollectionMeta count={visibleTokens.length} noun="token" />
                <ManagementTable
                  caption="Personal API tokens"
                  rows={visibleTokens}
                  columns={[
                    { key: 'name', header: 'Token', accessor: (token) => token.name, cell: (token) => <div><p className="font-medium">{token.name}</p><p className="text-xs text-muted-foreground"><code>{token.prefix}…</code> · created {formatWhen(token.createdAt)}</p></div> },
                    { key: 'last-used', header: 'Last used', accessor: (token) => token.lastUsedAt ?? 0, className: 'w-[12rem]', cell: (token) => <span className="text-sm text-muted-foreground">{token.lastUsedAt ? formatWhen(token.lastUsedAt) : 'Never'}</span> },
                    { key: 'actions', header: '', className: 'w-14 text-right', cell: (token) => <RowActions label={`Actions for ${token.name}`}><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setPendingRevoke(token)}>Revoke token</DropdownMenuItem></RowActions> },
                  ]}
                  empty={query ? 'No tokens match this search.' : 'No active tokens yet.'}
                />
              </div>
            )}
            {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
          </div>
        ) : <p className="text-xs text-muted-foreground">Sign in above to create a personal API token for agents and scripts.</p>}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2"><span className="text-sm">Claude Code</span><CopyButton label="Copy command" value={claudeCodeCmd} disabled={!signedIn} /></div>
          <div className="flex items-center justify-between gap-2"><span className="text-sm">Claude.ai / Desktop <span className="text-xs text-muted-foreground">(custom connector: URL + header)</span></span><span className="flex gap-2"><CopyButton label="Copy URL" value={mcpUrl} /><CopyButton label="Copy header" value={authHeader} disabled={!signedIn} /></span></div>
          <div className="flex items-center justify-between gap-2"><span className="text-sm">ChatGPT web <span className="text-xs text-muted-foreground">(OAuth: paste URL, approve while signed in)</span></span><CopyButton label="Copy URL" value={mcpUrl} /></div>
        </div>
      </CardContent>
      <ConfirmActionDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => { if (!open && !revokeMutation.isPending) setPendingRevoke(null); }}
        title="Revoke token"
        description={pendingRevoke ? `“${pendingRevoke.name}” will stop working immediately.` : ''}
        confirmLabel="Revoke token"
        busy={revokeMutation.isPending}
        onConfirm={() => { if (pendingRevoke) revokeMutation.mutate(pendingRevoke.id); }}
      />
    </Card>
  );
}

export function ApiTokenNewPage() {
  const [minted, setMinted] = useState<MintedApiToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mcpUrl = `${window.location.origin}/api/mcp`;
  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      if (value.name.trim() === '') return;
      setError(null);
      try {
        setMinted(await mintApiToken(value.name.trim()));
      } catch (cause) {
        setError(messageOf(cause, 'Could not create token'));
      }
    },
  });

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <PageHeading title="Create API token" description="Create a personal token for an agent, connector, or script. The secret is shown once." />
      {minted ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Token</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">This secret will not be shown again.</p>
            <code className="break-all rounded border border-border bg-muted/40 p-3 text-xs">{minted.token}</code>
            <div className="flex flex-wrap gap-2">
              <CopyButton label="Copy token" value={minted.token} />
              <CopyButton label="Copy Claude command" value={`claude mcp add --transport http openroom ${mcpUrl} --header "Authorization: Bearer ${minted.token}"`} />
              <CopyButton label="Copy header" value={`Authorization: Bearer ${minted.token}`} />
            </div>
            <Button asChild className="w-fit" variant="outline"><Link {...to.settings()}>Settings</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
          <Card>
            <CardContent className="flex flex-col gap-5 p-6">
              <form.Field name="name" validators={{ onChange: ({ value }) => value.trim() === '' ? 'Enter a label.' : undefined }}>
                {(field) => (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={field.name}>Label</Label>
                    <Input id={field.name} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} placeholder="Claude / agent" aria-invalid={field.state.meta.errors.length > 0} />
                    {field.state.meta.errors[0] ? <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p> : null}
                  </div>
                )}
              </form.Field>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <form.Subscribe selector={(state) => [state.canSubmit && state.values.name.trim() !== '', state.isSubmitting] as const}>
                {([canSubmit, isSubmitting]) => <div className="flex gap-2"><Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Creating…' : 'Create token'}</Button><Button asChild type="button" variant="outline"><Link {...to.settings()}>Cancel</Link></Button></div>}
              </form.Subscribe>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  );
}

interface Props {
  session: AuthSession;
}

export function SettingsPage({ session }: Props) {
  const signedIn = session.user !== null && session.user !== undefined;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
      </div>

      <AccountPanel session={session} />

      <Card><CardHeader><CardTitle className="text-base">Billing</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Choose a plan or manage your subscription, payment details and invoices.</p><Button asChild variant="outline"><Link {...to.billing()}>Open billing</Link></Button></CardContent></Card>
      <AgentAccessCard signedIn={signedIn} />
      <ConnectedApps signedIn={signedIn} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick links</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <a className="underline" href="/docs/" target="_blank" rel="noreferrer">
            Documentation
          </a>
          <Link className="underline" {...to.home()}>
            Home
          </Link>
          <Link className="underline" {...to.library()}>
            Library
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
