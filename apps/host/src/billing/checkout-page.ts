import { ApiError } from '../api/client';
import { billingMessage, getBilling, getCheckout, syncBilling, type CheckoutDetails } from './api';
import './checkout-page.css';

type Paddle = {
  Environment: { set(value: 'sandbox'): void };
  Initialize(options: { token: string; eventCallback(event: { name: string }): void }): void;
  Checkout: { open(options: { transactionId: string; settings: { allowLogout: false; showAddTaxId: true; displayMode: 'overlay' } }): void };
};
declare global { interface Window { Paddle?: Paddle } }
const heading = document.querySelector<HTMLHeadingElement>('#heading')!;
const message = document.querySelector<HTMLParagraphElement>('#message')!;
const action = document.querySelector<HTMLButtonElement>('#action')!;
const url = new URL(location.href);
const transactionId = url.searchParams.get('_ptxn') ?? new URLSearchParams(url.hash.slice(1)).get('transaction') ?? '';
// Paddle automatically consumes _ptxn at Initialize. Remove it before loading the
// SDK so the account-checked transaction is opened exactly once by this page.
if (/^txn_[a-z0-9]{26}$/.test(transactionId)) history.replaceState(null, '', `${url.pathname}#transaction=${transactionId}`);
let loaded: Promise<Paddle> | null = null;
let initializedToken: string | null = null;
let confirming = false, busy = false, completed = false, alive = true;
window.addEventListener('pagehide', () => { alive = false; });
function show(title: string, text: string, button?: string) {
  if (!alive) return;
  heading.textContent = title; message.textContent = text;
  action.hidden = !button; action.textContent = button ?? 'Try again'; action.disabled = false;
}
function paddleScript(): Promise<Paddle> {
  if (window.Paddle) return Promise.resolve(window.Paddle);
  if (loaded) return loaded;
  loaded = new Promise<Paddle>((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js'; script.async = true;
    const timer = window.setTimeout(failed, 15_000);
    function failed() { window.clearTimeout(timer); script.remove(); loaded = null; reject(new Error('Checkout script unavailable')); }
    script.onerror = failed;
    script.onload = () => { window.clearTimeout(timer); if (window.Paddle) resolve(window.Paddle); else failed(); };
    document.head.append(script);
  });
  return loaded;
}
async function confirmPayment(first?: CheckoutDetails) {
  if (confirming) return;
  confirming = true;
  let requestedSync = false;
  show('Confirming your payment', 'Waiting for Paddle and the subscription update…');
  try {
    for (let attempt = 0; attempt < 10 && alive; attempt++) {
      const details = attempt === 0 && first ? first : await getCheckout(transactionId);
      if (details.status === 'canceled') { show('Checkout canceled', 'No payment can be made through this checkout. Choose a plan from Billing.'); return; }
      if (details.status === 'completed' && details.subscriptionId) {
        const billing = await getBilling();
        if (billing.subscriptions.some((sub) => sub.id === details.subscriptionId && sub.hasAccess)) {
          completed = true; show('Your subscription is ready', 'Paddle confirmed this payment and your paid features are available. Return to OpenRoom through Billing.'); return;
        }
        if (!requestedSync) { requestedSync = true; await syncBilling().catch(() => undefined); }
      }
      if (attempt < 9) await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    show('Confirmation is still pending', 'Your payment may still be processing. Check again or open Billing. You do not need to start another checkout.', 'Check confirmation');
  } catch (error) { show('Could not check confirmation', billingMessage(error), 'Check confirmation'); }
  finally { confirming = false; }
}
async function start() {
  if (busy || confirming || completed) return;
  if (!/^txn_[a-z0-9]{26}$/.test(transactionId)) { show('Checkout link unavailable', 'Open Billing and choose or continue a checkout.'); return; }
  busy = true; action.disabled = true;
  try {
    const details = await getCheckout(transactionId);
    if (['paid', 'completed', 'billed'].includes(details.status)) { await confirmPayment(details); return; }
    if (!['draft', 'ready'].includes(details.status)) { show('Checkout unavailable', 'This checkout can no longer accept payment. Open Billing to review your subscription.'); return; }
    show('Opening secure checkout', 'Review the price, billing details and terms in Paddle before confirming payment.');
    const paddle = await paddleScript();
    if (!initializedToken) {
      if (details.environment === 'sandbox') paddle.Environment.set('sandbox');
      paddle.Initialize({ token: details.clientToken, eventCallback(event) {
        if (event.name === 'checkout.completed') void confirmPayment();
        else if (!confirming && !completed && event.name === 'checkout.closed') show('Checkout is still open', 'You can continue this checkout or cancel it from Billing.', 'Continue payment');
        else if (!confirming && !completed && event.name === 'checkout.error') show('Payment needs attention', 'Check the details in Paddle, or try opening this checkout again.', 'Continue payment');
      } });
      initializedToken = details.clientToken;
    } else if (initializedToken !== details.clientToken) throw new Error('Billing environment changed; reload required');
    paddle.Checkout.open({ transactionId: details.transactionId, settings: { allowLogout: false, showAddTaxId: true, displayMode: 'overlay' } });
    show(details.environment === 'sandbox' ? 'Sandbox checkout' : 'Complete your checkout', 'Use the secure Paddle window to review and confirm your payment.', 'Continue payment');
  } catch (error) {
    show(error instanceof ApiError && error.status === 401 ? 'Sign in to continue' : 'Checkout could not open', billingMessage(error), 'Try again');
  } finally { busy = false; action.disabled = false; }
}
action.addEventListener('click', () => { void start(); });
void start();
