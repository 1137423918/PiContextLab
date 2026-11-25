import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Warehouse } from '../src/warehouse.js';
import { Store } from '../src/store.js';
import { Runner } from '../src/runtime.js';
import { demoComparison, scriptedProvider } from '../src/demo.js';
import { exportReport } from '../src/report.js';
import type { Metric } from '../src/domain.js';
const [datasetPath, oraclePath, output] = process.argv.slice(2); if (!datasetPath || !oraclePath || !output) throw new Error('DATASET_DIR ORACLE_JSON OUTPUT_DIR');
await mkdir(output, { recursive: true });
const oracle = JSON.parse(await readFile(oraclePath, 'utf8')) as { metrics: Record<string, Record<Metric, string>>; quality: Record<string, number>; countries: { dimension: string | null; baseline: string; current: string; delta: string }[] };
const warehouse = new Warehouse(join(output, 'home/datasets')); const dataset = await warehouse.ingest(join(datasetPath, 'transactions.csv'), join(datasetPath, 'source-manifest.json'));
assert.equal(dataset.rows, '541909');
for (const [key, value] of Object.entries(oracle.quality)) assert.equal(String(dataset.quality[key]), String(value), `quality ${key}`);
const checks = [];
for (const metric of ['net_sales', 'gross_sales', 'returns', 'sales_orders', 'identified_customers', 'avg_order_value'] as const) {
  const evidence = await warehouse.compare(dataset.id, { ...demoComparison, metric });
  const result = evidence.result as { baseline: string; current: string };
  assert.equal(result.baseline, oracle.metrics.baseline?.[metric], `${metric} baseline`); assert.equal(result.current, oracle.metrics.current?.[metric], `${metric} current`);
  checks.push(evidence);
}
const breakdown = await warehouse.breakdown(dataset.id, { comparison: demoComparison, dimension: 'country', limit: 20 });
const groups = new Map<string | null, { dimension: string | null; baseline: string; current: string }>();
for (const row of breakdown.rows) { const dimension = row.dimension === null ? null : String(row.dimension); const g = groups.get(dimension) ?? { dimension, baseline: '0.0000', current: '0.0000' }; if (row.period === 'baseline') g.baseline = String(row.value); else g.current = String(row.value); groups.set(dimension, g); }
for (const country of oracle.countries) { const group = groups.get(country.dimension); assert.ok(group); assert.equal(group.baseline,country.baseline); assert.equal(group.current,country.current); }
assert.equal(groups.size, oracle.countries.length);
const store = new Store(join(output, 'home/jobs.sqlite'));
try {
  const job = store.create(dataset.id,'Compare October and November 2011 net sales using full calendar months, explain country contribution.',8,1200,demoComparison);
  await new Runner(store, warehouse, scriptedProvider()).run(job.id); assert.equal(store.job(job.id).status,'completed'); const report = store.report(job.id); assert.ok(report);
  await writeFile(join(output,'demo-report.html'),exportReport(report,null));
  const result = { passed: true, validation: 'real dataset / deterministic independent arithmetic + scripted actual Pi runtime, not real model inference', dataset, metric_checks: checks.length * 2, country_groups_checked: groups.size, quality_checks: Object.keys(oracle.quality).length, job:store.job(job.id), calls:store.calls(job.id), report, checks, breakdown, GPU_used:false, model_calls:0 };
  await writeFile(join(output,'validation.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify({passed:true,dataset:dataset.id,rows:dataset.rows,metric_checks:12,country_groups_checked:groups.size,scripted_Pi_provider_requests:store.calls(job.id).length,real_model_calls:0}));
} finally { store.close(); }
