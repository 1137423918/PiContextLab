import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { catalog, decimal, fixed, hash, POLICY, ratio, validateComparison, type Comparison, type Metric } from './domain.js';

export interface Dataset { id: string; csv_sha256: string; rows: string; min_time: string; max_time: string; quality: Record<string, unknown>; source: unknown; }
export interface Evidence { id: string; dataset: string; policy: string; kind: string; request: unknown; sql: string; bindings: string[]; rows: Record<string, unknown>[]; result: unknown; result_sha256: string; }
const eligible = "unit_price > 0 AND NOT (starts_with(upper(invoice_no),'C') AND quantity >= 0)";
const sale = "quantity > 0 AND NOT starts_with(upper(invoice_no),'C')";
const amount = 'quantity::DECIMAL(18,0) * unit_price';
const expressions: Record<Metric, string> = {
  net_sales: `coalesce(sum(${amount}),0)::VARCHAR`,
  gross_sales: `coalesce(sum(CASE WHEN ${sale} THEN ${amount} ELSE 0 END),0)::VARCHAR`,
  returns: `coalesce(sum(CASE WHEN quantity < 0 THEN -(${amount}) ELSE 0 END),0)::VARCHAR`,
  sales_orders: `count(DISTINCT CASE WHEN ${sale} THEN invoice_no END)::VARCHAR`,
  identified_customers: `count(DISTINCT CASE WHEN ${sale} THEN customer_id END)::VARCHAR`,
  avg_order_value: `coalesce(sum(CASE WHEN ${sale} THEN ${amount} ELSE 0 END),0)::VARCHAR`,
};
async function fileHash(path: string): Promise<string> {
  const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk as Buffer); return h.digest('hex');
}
async function rows(c: DuckDBConnection, sql: string, params: string[] = []): Promise<Record<string, unknown>[]> {
  const result = await c.runAndReadAll(sql, params); try { return result.getRowObjectsJson(); } finally { result.closeSync(); }
}
export class Warehouse {
  constructor(readonly root: string) {}
  async ingest(csv: string, sourceManifest: string): Promise<Dataset> {
    csv = resolve(csv); const digest = await fileHash(csv); const id = `ds_${digest.slice(0, 24)}`;
    await mkdir(this.root, { recursive: true }); const dest = join(this.root, id);
    try { return JSON.parse(await readFile(join(dest, 'manifest.json'), 'utf8')) as Dataset; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const source: unknown = JSON.parse(await readFile(sourceManifest, 'utf8'));
    if (typeof source !== 'object' || source === null || !('csv_sha256' in source) || source.csv_sha256 !== digest) throw new Error('Source manifest must match CSV SHA256');
    const temp = `${dest}.import-${process.pid}`; await mkdir(temp);
    const db = await DuckDBInstance.create(join(temp, 'data.duckdb'), { threads: '2', async_threads: '2', memory_limit: '1GB' });
    const c = await db.connect();
    try {
      await c.run(`CREATE TEMP TABLE intake AS SELECT * FROM read_csv(?,header=true,all_varchar=true,strict_mode=true)`, [csv]);
      const invalid = (await rows(c, `SELECT count(*)::VARCHAR n FROM intake WHERE
        NOT coalesce(regexp_full_match(unit_price,'-?[0-9]+(\\.[0-9]{1,4})?'),false)
        OR NOT coalesce(regexp_full_match(quantity,'-?[0-9]+'),false)
        OR NOT coalesce(regexp_full_match(source_row,'[0-9]+'),false)
        OR nullif(trim(invoice_no),'') IS NULL OR nullif(trim(stock_code),'') IS NULL`))[0];
      if (invalid?.n !== '0') throw new Error('Invalid required fields or precision beyond four decimals; no rounding during intake');
      await c.run(`CREATE TABLE facts AS SELECT source_row::BIGINT source_row, invoice_no, stock_code, description,
        quantity::BIGINT quantity, invoice_time::TIMESTAMP invoice_time, unit_price::DECIMAL(18,4) unit_price,
        nullif(customer_id,'') customer_id, nullif(country,'') country FROM intake`);
      await c.run('DROP TABLE intake');
      const q = (await rows(c, `SELECT count(*)::VARCHAR rows, min(invoice_time)::VARCHAR min_time, max(invoice_time)::VARCHAR max_time,
        count(*) FILTER(WHERE customer_id IS NULL)::VARCHAR unknown_customers,
        count(*) FILTER(WHERE description IS NULL)::VARCHAR missing_descriptions,
        count(*) FILTER(WHERE unit_price <= 0)::VARCHAR nonpositive_prices,
        count(*) FILTER(WHERE quantity < 0)::VARCHAR negative_quantities,
        count(*) FILTER(WHERE starts_with(upper(invoice_no),'C') AND quantity >= 0)::VARCHAR inconsistent_cancellations,
        count(*) FILTER(WHERE invoice_no IS NULL OR stock_code IS NULL OR quantity IS NULL OR invoice_time IS NULL OR unit_price IS NULL)::VARCHAR invalid_required,
        count(DISTINCT source_row)::VARCHAR unique_source_rows FROM facts`))[0];
      if (!q || q.rows === '0' || q.invalid_required !== '0' || q.rows !== q.unique_source_rows) throw new Error('Empty dataset, invalid required fields or repeated source row');
      if (await fileHash(csv) !== digest) throw new Error('CSV changed during import');
      const manifest: Dataset = { id, csv_sha256: digest, rows: String(q.rows), min_time: String(q.min_time), max_time: String(q.max_time), quality: q, source };
      await writeFile(join(temp, 'manifest.json'), JSON.stringify(manifest, null, 2));
      c.closeSync(); db.closeSync(); await rename(temp, dest); return manifest;
    } catch (e) { c.closeSync(); db.closeSync(); await rm(temp, { recursive: true, force: true }); throw e; }
  }
  async dataset(id: string): Promise<Dataset> {
    if (!/^ds_[a-f0-9]{24}$/.test(id)) throw new Error('Invalid dataset ID');
    return JSON.parse(await readFile(join(this.root, id, 'manifest.json'), 'utf8')) as Dataset;
  }
  async list(): Promise<Dataset[]> {
    await mkdir(this.root, { recursive: true });
    return Promise.all((await readdir(this.root)).filter(n => /^ds_[a-f0-9]{24}$/.test(n)).map(n => this.dataset(n)));
  }
  private async query(id: string, sql: string, bindings: string[], signal?: AbortSignal): Promise<Record<string, unknown>[]> {
    signal?.throwIfAborted(); await this.dataset(id); await stat(join(this.root, id, 'data.duckdb'));
    const db = await DuckDBInstance.create(join(this.root, id, 'data.duckdb'), { access_mode: 'READ_ONLY', threads: '2', async_threads: '2', memory_limit: '1GB', enable_external_access: 'false' });
    const c = await db.connect(); const interrupt = () => c.interrupt(); signal?.addEventListener('abort', interrupt, { once: true });
    try { const result = await rows(c, sql, bindings); signal?.throwIfAborted(); return result; } finally { signal?.removeEventListener('abort', interrupt); c.closeSync(); db.closeSync(); }
  }
  async compare(id: string, request: Comparison, signal?: AbortSignal): Promise<Evidence> {
    const ds = await this.dataset(id); validateComparison(request, ds.min_time, ds.max_time);
    const sql = `WITH periods AS (SELECT 'baseline' period, ?::TIMESTAMP a, ?::TIMESTAMP b UNION ALL SELECT 'current', ?::TIMESTAMP, ?::TIMESTAMP)
      SELECT p.period, ${expressions[request.metric]} value, count(DISTINCT CASE WHEN ${sale} THEN invoice_no END)::VARCHAR orders
      FROM periods p LEFT JOIN facts f ON invoice_time >= p.a AND invoice_time < p.b AND (${eligible}) GROUP BY p.period ORDER BY p.period`;
    const bindings = [request.baseline.start, request.baseline.end, request.current.start, request.current.end];
    const data = await this.query(id, sql, bindings, signal);
    const value = (period: string): string | null => {
      const row = data.find(r => r.period === period); if (!row) throw new Error('Missing comparison period');
      return request.metric === 'avg_order_value' ? ratio(fixed(String(row.value)), BigInt(String(row.orders))) : String(row.value);
    };
    const baseline = value('baseline'), current = value('current');
    const result = { metric: request.metric, baseline, current, delta: baseline === null || current === null ? null : decimal(fixed(current) - fixed(baseline)), unit: request.metric.includes('orders') || request.metric.includes('customers') ? 'count' : 'GBP', catalog };
    return this.evidence(id, 'comparison', request, sql, bindings, data, result);
  }
  async breakdown(id: string, request: { comparison: Comparison; dimension: 'country' | 'stock_code'; limit: number }, signal?: AbortSignal): Promise<Evidence> {
    const { comparison: c, dimension, limit } = request; const ds = await this.dataset(id); validateComparison(c, ds.min_time, ds.max_time);
    if (!['net_sales', 'gross_sales', 'returns'].includes(c.metric)) throw new Error('Distinct counts and averages are not additive across groups');
    if (!['country', 'stock_code'].includes(dimension) || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid breakdown');
    const sql = `SELECT ${dimension} dimension, ${expressions[c.metric]} value, CASE WHEN invoice_time < ?::TIMESTAMP THEN 'baseline' ELSE 'current' END period
      FROM facts WHERE (${eligible}) AND ((invoice_time >= ?::TIMESTAMP AND invoice_time < ?::TIMESTAMP) OR (invoice_time >= ?::TIMESTAMP AND invoice_time < ?::TIMESTAMP)) GROUP BY dimension, period ORDER BY dimension, period`;
    const bindings = [c.baseline.end, c.baseline.start, c.baseline.end, c.current.start, c.current.end];
    const data = await this.query(id, sql, bindings, signal);
    const groups = new Map<string | null, { baseline: bigint; current: bigint }>();
    for (const row of data) { const key = row.dimension === null ? null : String(row.dimension); const g = groups.get(key) ?? { baseline: 0n, current: 0n }; if (row.period === 'baseline') g.baseline += fixed(String(row.value)); else g.current += fixed(String(row.value)); groups.set(key, g); }
    const all = [...groups].map(([dimension, g]) => ({ dimension, baseline: decimal(g.baseline), current: decimal(g.current), delta: decimal(g.current - g.baseline) }));
    all.sort((a, b) => { const x = fixed(a.delta), y = fixed(b.delta), ax = x < 0n ? -x : x, ay = y < 0n ? -y : y; return ax === ay ? String(a.dimension).localeCompare(String(b.dimension), 'en') : ax > ay ? -1 : 1; });
    const sum = (items: typeof all, key: 'baseline' | 'current' | 'delta') => items.reduce((n, r) => n + fixed(r[key]), 0n);
    const remainder = all.slice(limit); const totals = { baseline: decimal(sum(all, 'baseline')), current: decimal(sum(all, 'current')), delta: decimal(sum(all, 'delta')) };
    const result = { dimension, metric: c.metric, top: all.slice(0, limit), other: { groups: remainder.length, baseline: decimal(sum(remainder, 'baseline')), current: decimal(sum(remainder, 'current')), delta: decimal(sum(remainder, 'delta')) }, totals, causal: false };
    return this.evidence(id, 'breakdown', request, sql, bindings, data, result);
  }
  private evidence(dataset: string, kind: string, request: unknown, sql: string, bindings: string[], rows: Record<string, unknown>[], result: unknown): Evidence {
    const result_sha256 = hash({ rows, result }); const payload = { dataset, policy: POLICY, kind, request, sql, bindings, rows, result, result_sha256 };
    return { id: `ev_${hash(payload)}`, ...payload };
  }
}
