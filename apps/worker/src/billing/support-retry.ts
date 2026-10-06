/** Operator-only SQL preparation. No public route and no provider or database calls. */
export function prepareBillingRetry(input: unknown, now = Date.now()): { sql: string; values: (string | number)[]; supportCase: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected one billing support case.');
  const value = input as Record<string, unknown>;
  const common = ['kind', 'environment', 'userId', 'checkoutId', 'attemptedAt', 'confirmedAt', 'supportCase', 'conclusion'];
  const fields = [...common, ...(value.kind === 'customer' ? ['customerReference'] : ['customerId', 'priceId'])];
  if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => value[key] === undefined)) throw new Error('Use only the documented support-case fields; omit emails, credentials and provider payloads.');
  if (!['customer', 'transaction'].includes(String(value.kind)) || !['sandbox', 'live'].includes(String(value.environment))) throw new Error('Specify the exact write kind and Paddle environment.');
  if (value.conclusion !== 'not-created') throw new Error('An inconclusive provider result cannot authorize another create attempt.');
  if (!Number.isSafeInteger(value.attemptedAt) || !Number.isSafeInteger(value.confirmedAt)
    || Number(value.attemptedAt) <= 0 || Number(value.confirmedAt) < Number(value.attemptedAt) || Number(value.confirmedAt) > now) throw new Error('Provider confirmation must refer to this attempted write and cannot be in the future.');
  const string = (key: string, pattern: RegExp): string => {
    const text = value[key];
    if (typeof text !== 'string' || !pattern.test(text)) throw new Error(`Invalid ${key}.`);
    return text;
  };
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const environment = String(value.environment), userId = string('userId', /^[A-Za-z0-9_-]{1,128}$/);
  const checkoutId = string('checkoutId', uuid), supportCase = string('supportCase', /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/);
  const values: (string | number)[] = [environment, userId, checkoutId, Number(value.attemptedAt)];
  const idle = "lease_until <= CAST(strftime('%s','now') AS INTEGER) * 1000";
  if (value.kind === 'customer') {
    values.push(string('customerReference', uuid));
    return { supportCase, values, sql: `UPDATE billing_customer_intents SET attempted_at=NULL
WHERE environment=?1 AND user_id=?2 AND attempted_at=?4 AND reference=?5
AND NOT EXISTS (SELECT 1 FROM billing_customers WHERE environment=?1 AND user_id=?2)
AND EXISTS (SELECT 1 FROM billing_checkouts WHERE environment=?1 AND user_id=?2 AND id=?3
  AND closed_at IS NULL AND transaction_id IS NULL AND attempted_at IS NULL AND ${idle})
RETURNING 1 AS retry_enabled` };
  }
  values.push(string('customerId', /^ctm_[a-z0-9]{26}$/), string('priceId', /^pri_[a-z0-9]{26}$/));
  return { supportCase, values, sql: `UPDATE billing_checkouts SET attempted_at=NULL
WHERE environment=?1 AND user_id=?2 AND id=?3 AND attempted_at=?4 AND price_id=?6
AND closed_at IS NULL AND transaction_id IS NULL AND ${idle}
AND EXISTS (SELECT 1 FROM billing_customers WHERE environment=?1 AND user_id=?2 AND customer_id=?5)
RETURNING 1 AS retry_enabled` };
}

/** Standalone, reviewable SQL; it never creates a purchase or changes paid access. */
export function billingRetrySql(input: unknown, now = Date.now()): string {
  const prepared = prepareBillingRetry(input, now);
  const sql = prepared.sql.replace(/\?(\d+)/g, (_, index: string) => {
    const value = prepared.values[Number(index) - 1]!;
    return typeof value === 'number' ? String(value) : `'${value.replaceAll("'", "''")}'`;
  });
  return `-- Paddle support case: ${prepared.supportCase}\n-- Apply only to the case's verified D1 environment. Expect exactly one changed row.\n${sql};\n`;
}
