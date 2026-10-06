/**
 * "Share with this student" — the tutor's half of the context access link.
 *
 * Two surfaces, deliberately separate (AGENTS.md CRUD invariant): the context
 * detail page lists existing links and offers a *button*; the mint form, which
 * has an option to choose, lives at its own `/links/new` route. That route is
 * also the only place the raw token ever exists in the browser, held in React
 * state for one screen — leaving the page destroys it, and nothing writes it to
 * storage, the URL, a query cache, or a toast.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Link2, Plus } from 'lucide-react';

import {
  ApiError,
  listContextLinks,
  listContextLearners,
  getContext,
  mintContextLink,
  revokeContextLink,
  type ContextLinkSummary,
  type MintedContextLink,
} from '../../api';
import { ConfirmActionDialog } from '../../components/ManagementTable';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  learnerLinkUrl,
  linkState,
  linkStateLabel,
  liveLinkCount,
  MAX_LINKS_PER_CONTEXT,
} from '../../lib/context-links';
import { to } from '../../destinations';
import { PageHeading, formatDate, messageOf } from './shared';
import { CONTINUITY_REQUIRED, ContinuityLock, isContinuityRequired } from '../../components/ContinuityLock';

const LINKS_KEY = (contextId: string) => ['contexts', contextId, 'links'] as const;

/**
 * Real messages for the two failures a tutor can actually hit, rather than
 * "Request failed (HTTP 429)".
 */
function mintErrorMessage(cause: unknown): string {
  if (isContinuityRequired(cause)) return CONTINUITY_REQUIRED;
  if (cause instanceof ApiError) {
    if (cause.status === 429) {
      return `This context already has ${MAX_LINKS_PER_CONTEXT} active links. Revoke one you no longer need, then make a new one.`;
    }
    if (cause.status === 403) {
      return 'You can run sessions in this space but not change its library, so you cannot create a student link. Ask an editor or the owner of this space.';
    }
    if (cause.status === 409) {
      return 'This context is in the trash. Restore it before sharing anything.';
    }
  }
  return messageOf(cause, 'Could not create the link');
}

function revokeErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 403) {
    return 'You need editor access in this space to revoke a student link.';
  }
  return messageOf(cause, 'Could not revoke the link');
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="grid gap-1">
    <Button
      type="button"
      onClick={async () => {
        setFailed(false);
        try {
          if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch { setFailed(true); }
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
    {failed ? <p role="alert" className="text-xs text-destructive">Select the link above and copy it manually.</p> : null}
    </div>
  );
}

/**
 * The list + one button. Rendered on the context detail page only for editors
 * and owners — a presenter cannot mint, so showing them the control would be a
 * button that exists to fail.
 */
export function ContextLinksCard({
  contextId,
}: {
  contextId: string;
}) {
  const queryClient = useQueryClient();
  const [pendingRevoke, setPendingRevoke] = useState<ContextLinkSummary | null>(null);
  const linksQuery = useQuery({ queryKey: LINKS_KEY(contextId), queryFn: () => listContextLinks(contextId) });
  const revokeMutation = useMutation({
    mutationFn: (linkId: string) => revokeContextLink(contextId, linkId),
    onSuccess: async () => {
      setPendingRevoke(null);
      await queryClient.invalidateQueries({ queryKey: LINKS_KEY(contextId) });
    },
  });

  const links = linksQuery.data ?? null;
  const now = Date.now();
  const live = links === null ? 0 : liveLinkCount(links, now);
  const atCap = live >= MAX_LINKS_PER_CONTEXT;
  const error = revokeMutation.error
    ? revokeErrorMessage(revokeMutation.error)
    : linksQuery.error
      ? messageOf(linksQuery.error, 'Could not load links')
      : null;

  if (isContinuityRequired(linksQuery.error)) return <ContinuityLock />;
  return (
    <Card>
      <CardHeader><CardTitle>Learner access links</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {links === null ? (
          <p className="text-sm text-muted-foreground" role="status">Loading links…</p>
        ) : links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No link yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {links.map((link) => {
              const state = linkState(link, now);
              return (
                <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="font-medium">{link.displayName}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      <code>{link.tokenPrefix}…</code>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Created {formatDate(link.createdAt)}
                      {state === 'revoked'
                        ? ` · revoked ${formatDate(link.revokedAt)}`
                        : link.expiresAt === null
                          ? ' · no end date'
                          : `${state === 'expired' ? ' · expired ' : ' · works until '}${formatDate(link.expiresAt)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={state === 'active' ? 'default' : 'muted'}>{linkStateLabel(state)}</Badge>
                    {state === 'active' ? (
                      <Button variant="outline" size="sm" className="text-destructive" onClick={() => setPendingRevoke(link)}>
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          {atCap ? (
            <>
              <Button type="button" disabled><Plus /> Create link</Button>
              <p className="text-xs text-muted-foreground">
                {MAX_LINKS_PER_CONTEXT} links already work in this context. Revoke one before making another.
              </p>
            </>
          ) : (
            <Button asChild>
              <Link {...to.studentLinkNew(contextId)}><Plus /> Create link</Link>
            </Button>
          )}
        </div>
      </CardContent>
      <ConfirmActionDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => { if (!open && !revokeMutation.isPending) setPendingRevoke(null); }}
        title="Revoke link"
        description={pendingRevoke ? `The link starting ${pendingRevoke.tokenPrefix}… stops working immediately. Anyone still holding it sees nothing.` : ''}
        confirmLabel="Revoke link"
        busy={revokeMutation.isPending}
        onConfirm={() => { if (pendingRevoke) revokeMutation.mutate(pendingRevoke.id); }}
      />
    </Card>
  );
}

const EXPIRY_OPTIONS: { value: string; label: string }[] = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '365 days' },
];

/** `#/tutor/contexts/:id/links/new` — the mint form and the single reveal. */
export function ContextLinkNewPage({ contextId }: { contextId: string }) {
  const queryClient = useQueryClient();
  const [expiresInDays, setExpiresInDays] = useState('180');
  const [displayName, setDisplayName] = useState('');
  const [learnerChoice, setLearnerChoice] = useState<string | null>(null);
  const learnersQuery = useQuery({ queryKey: ['contexts', contextId, 'learners'], queryFn: () => listContextLearners(contextId) });
  const contextQuery = useQuery({ queryKey: ['contexts', contextId], queryFn: () => getContext(contextId) });
  const selectedLearner = learnerChoice ?? (contextQuery.data?.kind === 'person' ? 'person' : learnersQuery.data?.length === 0 ? 'new' : '');
  const ready = contextQuery.isSuccess && learnersQuery.isSuccess;
  const [minted, setMinted] = useState<MintedContextLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const backTo = to.student(contextId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await mintContextLink(contextId, {
        expiresInDays: Number(expiresInDays),
        ...(selectedLearner === 'person' ? {} : selectedLearner === 'new' ? { displayName: displayName.trim() } : { learnerId: selectedLearner }),
      });
      setMinted(created);
      await queryClient.invalidateQueries({ queryKey: LINKS_KEY(contextId) });
      await queryClient.invalidateQueries({ queryKey: ['contexts', contextId, 'learners'] });
    } catch (cause) {
      setError(mintErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (isContinuityRequired(learnersQuery.error)) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <PageHeading title="Create a learner link" />
        <ContinuityLock />
        <Button asChild variant="outline" className="w-fit"><Link {...backTo}>Cancel</Link></Button>
      </div>
    );
  }

  if (minted) {
    // Built from the live location so the copied URL is exactly the one this
    // deployment's `#/learn` route reads.
    const url = learnerLinkUrl(window.location.origin, window.location.pathname, minted.token);
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <PageHeading
          title="Copy this link now"
          description="Shown once. A new link is required after leaving this page."
        />
        <Card>
          <CardHeader><CardTitle className="text-base"><Link2 /> {minted.displayName}&rsquo;s link</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <code className="break-all rounded-md border border-border bg-muted/40 p-3 text-xs">{url}</code>
            <div className="flex flex-wrap gap-2">
              <CopyButton label="Copy link" value={url} />
              <Button asChild variant="outline"><Link {...backTo}>Done</Link></Button>
            </div>
            {minted.expiresAt === null ? null : (
              <p className="text-xs text-muted-foreground">Works until {formatDate(minted.expiresAt)}.</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <PageHeading title="Create a learner link" description="Choose the same person when replacing a link. Their writing and practice stay with them." />
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Card>
          <CardContent className="flex flex-col gap-5 p-6">
            {!ready ? <p role={contextQuery.isError || learnersQuery.isError ? 'alert' : 'status'} className="text-sm text-muted-foreground">
              {contextQuery.isError || learnersQuery.isError ? 'Could not load learners. Reload this page to try again.' : 'Loading learners…'}
            </p> : null}
            {ready && ((learnersQuery.data?.length ?? 0) > 0 || contextQuery.data?.kind === 'person') ? <div className="grid gap-2">
              <Label>Learner</Label>
              <Select value={selectedLearner} onValueChange={setLearnerChoice}>
                <SelectTrigger aria-label="Learner"><SelectValue placeholder="Choose a learner" /></SelectTrigger>
                <SelectContent>
                  {contextQuery.data?.kind === 'person' ? <SelectItem value="person">{contextQuery.data.displayName}</SelectItem> : null}
                  {learnersQuery.data?.filter((person) => contextQuery.data?.kind !== 'person' || person.id !== `person-${contextId}`).map((person) => <SelectItem key={person.id} value={person.id}>{person.displayName}</SelectItem>)}
                  <SelectItem value="new">New learner</SelectItem>
                </SelectContent>
              </Select>
            </div> : null}
            {ready && selectedLearner === 'new' ? <div className="flex flex-col gap-2">
              <Label htmlFor="link-name">Display name</Label>
              <Input id="link-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Léa" maxLength={200} required />
            </div> : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="link-expiry">Expires</Label>
              <Select value={expiresInDays} onValueChange={setExpiresInDays}>
                <SelectTrigger id="link-expiry" aria-label="Expires"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {error === CONTINUITY_REQUIRED ? <ContinuityLock /> : error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || !ready || selectedLearner === ''}>{busy ? 'Creating…' : 'Create link'}</Button>
              <Button asChild type="button" variant="outline"><Link {...backTo}>Cancel</Link></Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
