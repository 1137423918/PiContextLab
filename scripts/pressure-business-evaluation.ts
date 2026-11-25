import assert from 'node:assert/strict';
import { fixed,hash,type Comparison } from '../src/domain.js';
import type { Report } from '../src/store.js';
import type { Evidence } from '../src/warehouse.js';
import { gradeBusinessReport,type BusinessOracle } from './business-evaluation.js';

export interface PressureComponent {id:string;comparison:Comparison;dimension:'country'|'stock_code';limit:number;}
export interface PressureProtocol {intent:Comparison;components:PressureComponent[];question:string;variant_order:('full'|'budgeted')[];variants:Record<'full'|'budgeted',{contextMode:'upstream'|'budgeted';maxContextBytes:number;artifactSearch:boolean}>;model:string;max_calls_per_job:number;max_output_per_call:number;request_timeout_ms:number;global_max_requests:number;dataset_csv_sha256:string;}
export interface PressureOracle {csv_sha256:string;rows:number;components:Record<string,BusinessOracle>;}

export function verifyRawGroups(rows:Record<string,unknown>[],expected:BusinessOracle):number {
 const actual=new Map<string|null,{baseline:bigint;current:bigint}>(),seen=new Set<string>();
 for(const row of rows){assert.ok(row.dimension===null||typeof row.dimension==='string');assert.ok(row.period==='baseline'||row.period==='current');assert.equal(typeof row.value,'string');const key=JSON.stringify([row.dimension,row.period]);assert.ok(!seen.has(key),'Repeated group/period');seen.add(key);const pair=actual.get(row.dimension)??{baseline:0n,current:0n};pair[row.period]=fixed(String(row.value));actual.set(row.dimension,pair);}
 assert.equal(actual.size,expected.groups.length);
 for(const group of expected.groups){const pair=actual.get(group.dimension);assert.ok(pair,'Missing group');assert.equal(pair.baseline,fixed(group.baseline));assert.equal(pair.current,fixed(group.current));assert.equal(pair.current-pair.baseline,fixed(group.delta));}
 return actual.size;
}

export function gradePressureReport(report:Report|null,protocol:PressureProtocol,oracle:PressureOracle):{passed:boolean;error:string|null;components:number;raw_groups_checked:number} {
 try{
  assert.ok(report,'No sealed report');assert.equal(report.evidence.length,9,'Requires all three comparisons and six breakdowns');assert.equal(new Set(report.evidence.map(e=>e.id)).size,9,'Evidence IDs must be distinct');let groups=0;
  for(const component of protocol.components){const expected=oracle.components[component.id];assert.ok(expected);assert.equal(hash({comparison:expected.comparison,dimension:expected.dimension,limit:expected.limit}),hash({comparison:component.comparison,dimension:component.dimension,limit:component.limit}));const grade=gradeBusinessReport(report,expected,oracle.csv_sha256);assert.ok(grade.passed,grade.error??'Business grade failed');const evidence=report.evidence.find(e=>e.kind==='breakdown'&&hash(e.request)===hash({comparison:component.comparison,dimension:component.dimension,limit:component.limit}));assert.ok(evidence);groups+=verifyRawGroups(evidence.rows,expected);}
  for(const period of ['baseline','current'] as const){const values=(metric:string):bigint=>{const e:Evidence|undefined=report.evidence.find(e=>e.kind==='comparison'&&hash(e.request)===hash({...protocol.intent,metric}));assert.ok(e);return fixed((e.result as {baseline:string;current:string})[period]);};assert.equal(values('gross_sales')-values('returns'),values('net_sales'));}
  return {passed:true,error:null,components:protocol.components.length,raw_groups_checked:groups};
 }catch(e){return {passed:false,error:e instanceof Error?e.message:String(e),components:0,raw_groups_checked:0};}
}
