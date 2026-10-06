import { ApiError, request } from '../api/client';

export interface BillingStatus {
  available: boolean;
  /** No billing on this deployment: every capability is included. */
  selfHosted?: boolean;
  environment?: 'sandbox' | 'live';
  canManage: boolean;
  syncState?: 'attention' | 'checked' | 'pending';
  subscriptions: { id: string; name: string; status: string; hasAccess: boolean; scheduledStop: boolean }[];
  pendingCheckout: { id: string; priceId: string; name: string } | null;
}
export interface BillingPlan { priceId: string; name: string; capabilities: string[]; amount: string; currency: string; interval: 'day' | 'week' | 'month' | 'year'; frequency: number; hasTrial: boolean }
export interface CheckoutDetails { transactionId: string; status: string; subscriptionId: string | null; environment: 'sandbox' | 'live'; clientToken: string }
export const billingKey = ['settings', 'billing'] as const;
export const getBilling = () => request<BillingStatus>('/api/my/billing');
export const getPlans = () => request<{ plans: BillingPlan[] }>('/api/my/billing/plans');
export const startCheckout = (priceId: string) => request<{ checkoutUrl: string; attemptId: string }>('/api/my/billing/checkout', { method: 'POST', mutating: true, body: JSON.stringify({ priceId }) });
export const cancelCheckout = (attemptId: string) => request('/api/my/billing/checkout', { method: 'DELETE', mutating: true, body: JSON.stringify({ attemptId }) });
export const syncBilling = () => request<{ state: string; checkoutIssue: string | null }>('/api/my/billing/sync', { method: 'POST', mutating: true, body: '{}' });
export const openPortal = () => request<{ portalUrl: string }>('/api/my/billing/portal', { method: 'POST', mutating: true, body: '{}' });
export const getCheckout = (transactionId: string) => request<CheckoutDetails>(`/api/my/billing/checkout?transactionId=${encodeURIComponent(transactionId)}`);

export function billingMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sign in to the account that started this checkout, then try again.';
    switch (error.message) {
      case 'billing-not-configured': return 'Paid plans are not available yet.';
      case 'billing-sync-busy':
      case 'billing-checkout-busy': return 'Another billing request is in progress. Wait a moment, then try again.';
      case 'billing-sync-budget-exhausted': return 'This billing check needs more time. Try Refresh billing again.';
      case 'billing-checkout-pending': return 'Paddle has not confirmed this checkout yet. Try again to check the same request.';
      case 'billing-subscription-exists': return 'You already have a subscription. Use Manage billing to review it.';
      case 'billing-checkout-in-progress': return 'Finish or cancel your current checkout before choosing another plan.';
      case 'billing-payment-processing': return 'Paddle is processing this payment. Refresh billing to check your access.';
      case 'billing-checkout-canceled': return 'This checkout was canceled. Refresh billing to choose a plan again.';
      case 'billing-customer-conflict': return 'Your billing account needs review before checkout can continue. Contact OpenRoom support.';
      case 'billing-transaction-unavailable': return 'This checkout is unavailable for the signed-in account.';
      case 'billing-price-unavailable': return 'This plan is no longer available. Refresh the plans and choose again.';
    }
  }
  return 'Billing could not be reached. Please try again.';
}

export function planPrice(plan: BillingPlan): string {
  const format = new Intl.NumberFormat(undefined, { style: 'currency', currency: plan.currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  const amount = format.format(Number(plan.amount) / 10 ** digits);
  return `${amount} / ${plan.frequency === 1 ? plan.interval : `${plan.frequency} ${plan.interval}s`}`;
}
export function capabilityLabel(capability: string): string {
  switch (capability) {
    case 'team': return 'Shared spaces and collaboration';
    case 'continuity': return 'Homework and Notes';
    case 'keep': return 'Saved session archives';
    case 'rawExport': return 'Named response exports';
    case 'branding': return 'Shared brand kits';
    case 'connectors': return 'Connected workflows';
    default: return 'Named session invites';
  }
}
export function subscriptionLabel(status: string): string {
  switch (status) {
    case 'active': return 'Active subscription';
    case 'trialing': return 'Trial subscription';
    case 'past_due': return 'Payment needs attention';
    case 'paused': return 'Subscription paused';
    case 'canceled': return 'Subscription ended';
    default: return 'Subscription confirmation pending';
  }
}
