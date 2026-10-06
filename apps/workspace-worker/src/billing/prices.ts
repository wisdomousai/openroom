import { paddleId, record } from './paddle';
import { paddleList, type PaddleConfig } from './provider';

export async function availablePlans(config: PaddleConfig) {
  const data = await paddleList(config, '/prices', { id: Object.keys(config.catalog.prices).join(','), status: 'active' });
  return data.flatMap((price) => {
    if (!paddleId(price.id, 'pri') || !config.catalog.prices[price.id] || price.status !== 'active' || !record(price.unit_price) || !record(price.billing_cycle) || !record(price.quantity)) return [];
    const money = price.unit_price, cycle = price.billing_cycle;
    if (typeof money.amount !== 'string' || !/^\d{1,15}$/.test(money.amount) || typeof money.currency_code !== 'string' || !/^[A-Z]{3}$/.test(money.currency_code)
      || !Number.isSafeInteger(price.quantity.minimum) || !Number.isSafeInteger(price.quantity.maximum)
      || !['day', 'week', 'month', 'year'].includes(String(cycle.interval)) || !Number.isSafeInteger(cycle.frequency) || Number(cycle.frequency) < 1 || Number(price.quantity.minimum) > 1 || Number(price.quantity.maximum) < 1) return [];
    const plan = config.catalog.prices[price.id]!;
    return [{ priceId: price.id, name: plan.name, capabilities: plan.capabilities, amount: money.amount, currency: money.currency_code,
      interval: cycle.interval, frequency: cycle.frequency, hasTrial: record(price.trial_period) }];
  });
}
