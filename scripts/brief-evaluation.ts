import assert from 'node:assert/strict';
import { fixed,hash,parse,POLICY,type Comparison,type Metric } from '../src/domain.js';
import { briefBodySchema } from '../src/brief-client.js';
import type { Report } from '../src/store.js';
import type { Evidence } from '../src/warehouse.js';
import { gradeBusinessReport,type Amounts,type BusinessOracle } from './business-evaluation.js';
import { verifyRawGroups } from './pressure-business-evaluation.js';

export interface BriefComponent{id:string;metric:Metric;dimension:'country'|'stock_code';limit:number;}
export interface BriefCase{id:string;intent:Comparison;metrics:Metric[];breakdowns:BriefComponent[];check:'gross_per_order'|'gross_minus_returns';question:string;variant_order:('full'|'budgeted')[];}
export interface BriefProtocol{cases:BriefCase[];variants:Record<'full'|'budgeted',{contextMode:'upstream'|'budgeted';maxContextBytes:number;artifactSearch:boolean}>;model:string;dataset_csv_sha256:string;max_calls_per_job:number;max_output_per_call:number;global_max_requests:number;request_timeout_ms:number;}
export interface BriefOracleCase{facts:Record<string,Amounts>;breakdowns:Record<string,BusinessOracle>;check:{baseline:string;current:string};}
export interface BriefOracle{csv_sha256:string;rows:number;cases:Record<string,BriefOracleCase>;}
export function gradeBrief(report:Report|null,c:BriefCase,oracle:BriefOracleCase,csvSha:string){
 try{
  assert.ok(report,'No sealed report');assert.equal(report.dataset,'ds_'+csvSha.slice(0,24));assert.equal(report.evidence.length,5);assert.equal(new Set(report.evidence.map(e=>e.id)).size,5);
  for(const e of report.evidence){const {id,...payload}=e;assert.equal(e.policy,POLICY);assert.equal(e.dataset,report.dataset);assert.equal(hash({rows:e.rows,result:e.result}),e.result_sha256);assert.equal('ev_'+hash(payload),id);}
  const body=parse(briefBodySchema,JSON.parse(report.interpretation));assert.equal(new Set(body.facts.map(f=>f.metric)).size,3);const comparisons=[];
  for(const metric of c.metrics){const expected=oracle.facts[metric];assert.ok(expected);const evidence:Evidence|undefined=report.evidence.find(e=>e.kind==='comparison'&&hash(e.request)===hash({...c.intent,metric}));assert.ok(evidence,'Missing comparison');comparisons.push(evidence.id);const fact=body.facts.find(f=>f.metric===metric);assert.ok(fact,'Missing model fact');assert.equal(fact.evidence_id,evidence.id);const values=evidence.result as Amounts;for(const k of ['baseline','current','delta'] as const){assert.equal(fixed(values[k]),fixed(expected[k]));assert.equal(fixed(fact[k]),fixed(expected[k]));}const delta=fixed(expected.delta);assert.equal(fact.direction,delta>0n?'increase':delta<0n?'decrease':'unchanged');}
  let groups=0;
  for(const b of c.breakdowns){const expected=oracle.breakdowns[b.id];assert.ok(expected);assert.equal(hash({comparison:expected.comparison,dimension:expected.dimension,limit:expected.limit}),hash({comparison:{...c.intent,metric:b.metric},dimension:b.dimension,limit:b.limit}));const grade=gradeBusinessReport(report,expected,csvSha);assert.ok(grade.passed,grade.error??'Breakdown mismatch');const evidence:Evidence|undefined=report.evidence.find(e=>e.kind==='breakdown'&&hash(e.request)===hash({comparison:{...c.intent,metric:b.metric},dimension:b.dimension,limit:b.limit}));assert.ok(evidence);groups+=verifyRawGroups(evidence.rows,expected);const priority=body.priorities.find(p=>p.metric===b.metric&&p.dimension===b.dimension);assert.ok(priority,'Missing priority');assert.equal(priority.evidence_id,evidence.id);const group=expected.groups.find(g=>g.dimension===priority.group);assert.ok(group,'Unknown priority group');assert.equal(fixed(priority.delta),fixed(group.delta));const magnitude=(s:string)=>{const n=fixed(s);return n<0n?-n:n;};assert.ok(expected.groups.every(g=>magnitude(g.delta)<=magnitude(group.delta)),'Priority not a maximum absolute contribution');}
  assert.equal(body.check.name,c.check);assert.deepEqual([...body.check.source_evidence_ids].sort(),comparisons.sort());for(const p of ['baseline','current'] as const)assert.equal(fixed(body.check[p]),fixed(oracle.check[p]));
  return {passed:true,error:null,model_facts_checked:3,priorities_checked:2,raw_groups_checked:groups};
 }catch(error){return {passed:false,error:error instanceof Error?error.message:String(error),model_facts_checked:0,priorities_checked:0,raw_groups_checked:0};}
}
