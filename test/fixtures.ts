import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Warehouse } from '../src/warehouse.js';
import { Store } from '../src/store.js';
import type { Comparison } from '../src/domain.js';
export const comparison: Comparison = { metric: 'net_sales', baseline: { start: '2011-10-01', end: '2011-11-01' }, current: { start: '2011-11-01', end: '2011-12-01' }, basis: 'calendar_month' };
export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'metriclab-test-'));
  const csv = `source_row,invoice_no,stock_code,description,quantity,invoice_time,unit_price,customer_id,country
1,A,X,Item,2,2011-10-03T10:00:00,0.1000,1,UK
2,A,Y,Item,1,2011-10-03T10:00:00,1.0050,1,UK
3,B,X,Item,3,2011-10-04T10:00:00,2.0000,,FR
4,C1,X,Return,-1,2011-10-05T10:00:00,2.0000,2,FR
5,Z,X,Free,1,2011-10-06T10:00:00,0.0000,1,UK
6,CA,X,Invalid cancel,2,2011-10-07T10:00:00,10.0000,1,UK
7,D,X,Item,4,2011-11-02T10:00:00,2.0000,1,UK
8,D,Y,Item,1,2011-11-02T10:00:00,0.1000,1,UK
9,E,X,Item,2,2011-11-03T10:00:00,3.0000,3,
10,C2,X,Return,-1,2011-11-04T10:00:00,1.0050,3,
11,F,X,Negative price,1,2011-11-04T10:00:00,-2.0000,3,UK
12,G,X,Boundary,1,2011-12-02T10:00:00,1.0000,4,UK
13,START,X,Coverage marker,0,2011-10-01T00:00:00,1.0000,,UK
`;
  const path = join(root, 'input.csv'); await writeFile(path, csv); const manifest = join(root, 'source.json');
  await writeFile(manifest, JSON.stringify({ source: 'synthetic business arithmetic fixture', csv_sha256: createHash('sha256').update(csv).digest('hex') }));
  const warehouse = new Warehouse(join(root, 'datasets')); const dataset = await warehouse.ingest(path, manifest); const store = new Store(join(root, 'jobs.sqlite'));
  return { root, warehouse, dataset, store, path, manifest };
}
