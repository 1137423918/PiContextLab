import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { comparison, fixture } from './fixtures.js';
import { decimal, fixed, parse, comparisonSchema, ratio, validateComparison } from '../src/domain.js';
test('exact decimals, rounding, invalid dates and semantic period guards', () => {
  assert.equal(decimal(fixed('0.1') + fixed('0.2')), '0.3000'); assert.equal(ratio(10005n, 2n), '0.5003'); assert.equal(ratio(-10005n, 2n), '-0.5003'); assert.equal(ratio(1n,0n),null);
  assert.throws(() => fixed('1.00001')); assert.throws(() => parse(comparisonSchema, { ...comparison, sql:'DROP TABLE facts' }));
  assert.throws(() => validateComparison({ ...comparison, current:{start:'2011-11-31',end:'2011-12-01'} },'2011-01-01','2012-01-01'));
  assert.throws(() => validateComparison({ ...comparison, current:{start:'2011-12-01',end:'2012-01-01'} },'2010-12-01','2011-12-09'));
  assert.throws(() => validateComparison({ ...comparison, basis:'equal_days' },'2010-12-01','2011-12-09'));
});
test('business oracle: line grain, unknown customers, returns, exact money, null group and remainder', async () => {
  const f = await fixture(); try {
    const expected = { net_sales:['5.2050','13.0950'], gross_sales:['7.2050','14.1000'], returns:['2.0000','1.0050'], sales_orders:['2','2'], identified_customers:['1','2'], avg_order_value:['3.6025','7.0500'] };
    for (const [metric, values] of Object.entries(expected)) { const e = await f.warehouse.compare(f.dataset.id,{...comparison,metric:metric as keyof typeof expected}); const r = e.result as {baseline:string;current:string}; assert.deepEqual([r.baseline,r.current],values,metric); }
    const e = await f.warehouse.breakdown(f.dataset.id,{comparison,dimension:'country',limit:1});
    const r = e.result as { top:{dimension:string|null;delta:string}[];other:{groups:number;delta:string};totals:{delta:string} };
    assert.equal(r.top[0]?.dimension,'UK'); assert.equal(r.top[0]?.delta,'6.8950'); assert.equal(r.other.groups,2); assert.equal(r.other.delta,'0.9950'); assert.equal(r.totals.delta,'7.8900');
    const nulls = await f.warehouse.breakdown(f.dataset.id,{comparison,dimension:'country',limit:20}); assert.ok((nulls.result as {top:{dimension:unknown}[]}).top.some(r=>r.dimension===null));
    await assert.rejects(f.warehouse.breakdown(f.dataset.id,{comparison:{...comparison,metric:'sales_orders'},dimension:'stock_code',limit:5}),/not additive/);
    assert.equal((await f.warehouse.ingest(f.path,f.manifest)).id,f.dataset.id); assert.equal(f.dataset.quality.nonpositive_prices,'2'); assert.equal(f.dataset.quality.inconsistent_cancellations,'1');
    await assert.rejects(f.warehouse.dataset('../../etc/passwd'));
  } finally { f.store.close(); await rm(f.root,{recursive:true,force:true}); }
});
