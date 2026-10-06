import { describe, expect, it } from 'vitest';
import { planPrice, type BillingPlan } from './api';

describe('plan price display', () => {
  it('uses the currency minor unit for zero, two and three decimal currencies', () => {
    for (const [currency, amount, expected] of [['JPY', '2400', 2400], ['CHF', '2400', 24], ['KWD', '2400', 2.4]] as const) {
      const plan: BillingPlan = { priceId: 'fixture', name: 'Plan', capabilities: [], currency, amount, interval: 'month', frequency: 3, hasTrial: false };
      expect(planPrice(plan)).toBe(`${new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(expected)} / 3 months`);
    }
  });
});
