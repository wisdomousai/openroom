import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { billingKey, billingMessage, cancelCheckout, capabilityLabel, getBilling, getPlans, openPortal, planPrice, startCheckout, subscriptionLabel, syncBilling } from '../billing/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { to } from '../destinations';
import type { AuthSession } from '../useAuth';
import { PageHeading } from './tutor/shared';

export function BillingPage({ session }: { session: AuthSession }) {
  const client = useQueryClient();
  const status = useQuery({ queryKey: billingKey, queryFn: getBilling, enabled: Boolean(session.user) });
  const plans = useQuery({ queryKey: [...billingKey, 'plans'], queryFn: getPlans, enabled: Boolean(session.user && status.data?.available) });
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: billingKey }), session.refresh()]); };
  const checkout = useMutation({ gcTime: 0, mutationFn: startCheckout, onSettled: refresh });
  const cancel = useMutation({ mutationFn: cancelCheckout, onSuccess: () => checkout.reset(), onSettled: refresh });
  const portal = useMutation({ gcTime: 0, mutationFn: openPortal });
  const sync = useMutation({ mutationFn: syncBilling, onSettled: refresh });
  const busy = checkout.isPending || cancel.isPending || portal.isPending || sync.isPending;
  const data = status.data;
  const existing = data?.subscriptions.some((sub) => ['active', 'trialing', 'past_due', 'paused'].includes(sub.status));
  const error = checkout.error ?? cancel.error ?? portal.error ?? sync.error;
  return <div className="mx-auto flex max-w-4xl flex-col gap-6">
    <PageHeading title="Billing" description="Your plan, payment details and invoices." action={<Button asChild variant="outline"><Link {...to.settings()}>Settings</Link></Button>} />
    {session.user === undefined ? <p role="status">Loading account…</p> : !session.user ? <p>Sign in from <Link className="underline" {...to.settings()}>Settings</Link> to manage billing.</p> : <>
      {status.isPending ? <p role="status">Loading billing…</p> : null}
      {status.error ? <div role="alert"><p>{billingMessage(status.error)}</p><Button variant="outline" onClick={() => void status.refetch()}>Retry billing</Button></div> : null}
      {data && !data.available ? <p className="text-muted-foreground">{data.selfHosted ? 'Billing is off on this deployment. Every capability is included.' : 'Paid plans are not available yet.'}</p> : null}
      {data?.available ? <>
        {data.environment === 'sandbox' ? <p className="rounded-lg border border-dashed p-3 text-sm">Sandbox billing · Test payments only</p> : null}
        <Card><CardHeader><CardTitle>Your subscription</CardTitle></CardHeader><CardContent className="space-y-4">
          {data.subscriptions.length ? data.subscriptions.map((sub) => <div key={sub.id} className="space-y-1"><p className="font-medium">{sub.name}</p><p className="text-sm">{subscriptionLabel(sub.status)}</p><p className="text-sm text-muted-foreground">{sub.hasAccess ? 'Paid features are available.' : 'This subscription currently provides no paid access.'}{sub.scheduledStop ? ' A change is scheduled in Paddle. Review it in Manage billing.' : ''}</p></div>) : <p className="text-sm text-muted-foreground">No confirmed subscription. Starting checkout does not change your access.</p>}
          <div className="flex flex-wrap gap-2">
            {data.canManage ? <Button variant="outline" disabled={busy} onClick={() => { portal.reset(); portal.mutate(); }}>{portal.isPending ? 'Preparing billing link…' : 'Manage billing'}</Button> : null}
            <Button variant="ghost" disabled={busy || status.isFetching} onClick={() => { sync.reset(); sync.mutate(); }}>{sync.isPending ? 'Checking with Paddle…' : 'Refresh billing'}</Button>
          </div>
          {data.syncState === 'attention' ? <p role="status" className="text-sm text-muted-foreground">Part of your billing update is still pending. Try Refresh billing again. If this continues, contact OpenRoom support.</p> : null}
          {portal.data ? <p><a className="font-medium underline underline-offset-4" href={portal.data.portalUrl} target="_blank" rel="noreferrer">Open secure billing portal ↗</a><span className="mt-1 block text-xs text-muted-foreground">This link expires. Use Manage billing to get a new one.</span></p> : null}
        </CardContent></Card>
        {data.pendingCheckout && !existing ? <Card><CardHeader><CardTitle>Continue your checkout</CardTitle></CardHeader><CardContent className="space-y-3"><p>{data.pendingCheckout.name}</p><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => { checkout.reset(); cancel.reset(); checkout.mutate(data.pendingCheckout!.priceId); }}>Continue checkout</Button><Button variant="outline" disabled={busy} onClick={() => { checkout.reset(); cancel.reset(); cancel.mutate(data.pendingCheckout!.id); }}>Cancel unfinished checkout</Button></div></CardContent></Card> : null}
        {checkout.data && data.pendingCheckout?.id === checkout.data.attemptId && !existing ? <div role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-5"><p className="mb-3 text-sm">Your secure checkout is ready. Review the price and terms in Paddle before paying.</p><Button asChild><a href={checkout.data.checkoutUrl} target="_blank" rel="noreferrer">Continue to secure checkout ↗</a></Button></div> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{billingMessage(error)}</p> : null}
        {!existing && !data.pendingCheckout ? <section aria-label="Available plans" className="space-y-4">
          <h2 className="font-display text-xl font-semibold">Choose a plan</h2>
          <p className="text-sm text-muted-foreground">Final taxes, trial terms and renewal details are shown in Paddle before you confirm.</p>
          {plans.isPending ? <p role="status">Loading plans…</p> : null}
          {plans.error ? <div role="alert"><p>{billingMessage(plans.error)}</p><Button variant="outline" onClick={() => void plans.refetch()}>Retry plans</Button></div> : null}
          {plans.data?.plans.length === 0 ? <p>No plans are available for checkout.</p> : null}
          <div className="grid gap-4 md:grid-cols-2">{plans.data?.plans.map((plan) => <Card key={plan.priceId} className="flex flex-col"><CardHeader><CardTitle>{plan.name}</CardTitle><p className="pt-2 text-2xl font-semibold tracking-tight">{planPrice(plan)}</p>{plan.hasTrial ? <p className="text-sm text-muted-foreground">Trial available; review its terms at checkout.</p> : null}</CardHeader><CardContent className="flex flex-1 flex-col gap-5"><ul className="flex-1 list-disc space-y-2 pl-5 text-sm">{plan.capabilities.map((capability) => <li key={capability}>{capabilityLabel(capability)}</li>)}</ul><Button disabled={busy} onClick={() => { checkout.reset(); cancel.reset(); checkout.mutate(plan.priceId); }}>{checkout.isPending && checkout.variables === plan.priceId ? 'Preparing checkout…' : `Choose ${plan.name}`}</Button></CardContent></Card>)}</div>
        </section> : null}
      </> : null}
    </>}
  </div>;
}
