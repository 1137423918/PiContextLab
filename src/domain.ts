import { createHash } from 'node:crypto';
import { arr, compile, int, obj, oneOf, str, type Static } from '@earendil-works/pi-schema';

export const POLICY = 'retail-gbp-v1';
export const metricSchema = oneOf(['net_sales', 'gross_sales', 'returns', 'sales_orders', 'identified_customers', 'avg_order_value']);
export type Metric = Static<typeof metricSchema>;
export const periodSchema = obj({ start: str(), end: str() });
export type Period = Static<typeof periodSchema>;
export const comparisonSchema = obj({ metric: metricSchema, baseline: periodSchema, current: periodSchema, basis: oneOf(['equal_days', 'calendar_month']) });
export type Comparison = Static<typeof comparisonSchema>;
export function explicitComparison(question:string):Comparison|null {
  const dates=[...question.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(m=>m[0]);
  const metrics=(['net_sales','gross_sales','returns','sales_orders','identified_customers','avg_order_value'] as const).filter(metric=>new RegExp(`\\b${metric}\\b`).test(question));
  const basis=question.includes('calendar_month')?'calendar_month':question.includes('equal_days')?'equal_days':null;
  if(dates.length!==4||metrics.length!==1||!basis)return null;
  return {metric:metrics[0]!,baseline:{start:dates[0]!,end:dates[1]!},current:{start:dates[2]!,end:dates[3]!},basis};
}
export const breakdownSchema = obj({ comparison: comparisonSchema, dimension: oneOf(['country', 'stock_code']), limit: int({ minimum: 1, maximum: 20 }) });
export const submitSchema = obj({ title: str({ minLength: 1, maxLength: 160 }), evidence_ids: arr(str(), { minItems: 1, maxItems: 20 }), interpretation: str({ maxLength: 3000 }), hypotheses: arr(str({ maxLength: 500 }), { maxItems: 8 }) });
export type Submission = Static<typeof submitSchema>;
export function parse<T extends object>(schema: T, input: unknown): Static<T> {
  const validator = compile(schema);
  if (!validator.check(input)) throw new Error(`Invalid input: ${JSON.stringify(validator.errors(input))}`);
  return input;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => [k,canonical(v)]));
  return value;
}
export function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export function fixed(value: string): bigint {
  if (!/^-?\d+(\.\d{1,4})?$/.test(value)) throw new Error(`Invalid fixed decimal: ${value}`);
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
  return (BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))) * (negative ? -1n : 1n);
}
export function decimal(value: bigint): string {
  const v = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${v / 10000n}.${String(v % 10000n).padStart(4, '0')}`;
}
export function ratio(numerator: bigint, denominator: bigint): string | null {
  if (denominator === 0n) return null;
  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  return decimal(sign * ((n + d / 2n) / d));
}
function day(value: string): number {
  if (!/^\d{4}-\d\d-\d\d$/.test(value)) throw new Error('Date must be YYYY-MM-DD');
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date');
  return time;
}
export function validateComparison(c: Comparison, min: string, max: string): void {
  const periods = [c.baseline, c.current];
  const lengths = periods.map(p => {
    const start = day(p.start), end = day(p.end);
    if (end <= start || (end - start) / 86400000 > 366) throw new Error('Period must contain 1–366 days');
    // The last observed date is conservatively incomplete. A dataset cannot prove an absent date is complete.
    if (p.start < min.slice(0, 10) || p.end > max.slice(0, 10)) throw new Error('Incomplete coverage: choose complete observed dates; end is exclusive');
    return end - start;
  });
  if (c.baseline.end > c.current.start) throw new Error('Periods must be ordered and disjoint');
  if (c.basis === 'equal_days' && lengths[0] !== lengths[1]) throw new Error('Equal-day comparison requires equal durations');
  if (c.basis === 'calendar_month') for (const p of periods) {
    const d = new Date(day(p.start)); d.setUTCMonth(d.getUTCMonth() + 1);
    if (!p.start.endsWith('-01') || p.end !== d.toISOString().slice(0, 10)) throw new Error('Calendar-month comparison requires two complete calendar months');
  }
}
export const catalog = {
  policy: POLICY, currency: 'GBP', time: 'Source local wall time; no timezone inferred',
  grain: 'invoice line; orders use distinct invoice_no; customers use nonempty customer_id',
  eligibility: 'unit_price > 0; exclude cancellation invoices with nonnegative quantity; preserve duplicate source lines',
  net_sales: 'Signed eligible quantity × unit_price; not cash collected',
  gross_sales: 'Eligible positive-quantity sales, excluding cancellation invoices',
  returns: 'Absolute amount of eligible negative-quantity lines, including cancellations',
  sales_orders: 'Distinct invoices with eligible positive sales',
  identified_customers: 'Distinct known customers with eligible positive sales; unknown customers still contribute revenue',
  avg_order_value: 'Gross sales / distinct sales orders; four-decimal half-away-from-zero rounding',
  caveat: 'Bookkeeping and return adjustments remain in source; contribution is descriptive, not causal',
} as const;
