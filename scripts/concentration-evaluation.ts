import assert from 'node:assert/strict';
import { fixed,decimal,hash,parse,type Comparison } from '../src/domain.js';
import { concentrationBodySchema } from '../src/concentration-client.js';
import type { Evidence } from '../src/warehouse.js';
import type { Report } from '../src/store.js';
import { gradeBusinessReport,type BusinessOracle,type Group } from './business-evaluation.js';
import { verifyRawGroups } from './pressure-business-evaluation.js';
export interface ConcentrationCase {id:string;intent:Comparison;question:string;variant_order:('control'|'retained')[];}
export interface ConcentrationProtocol {cases:ConcentrationCase[];dataset_csv_sha256:string;model:string;max_calls_per_job:number;max_output_per_call:number;global_max_requests:number;request_timeout_ms:number;max_context_bytes:number;}
export interface ConcentrationOracle {csv_sha256:string;rows:number;cases:Record<string,{comparison:{baseline:string;current:string;delta:string};dimensions:Record<string,BusinessOracle>}>;}
const magnitude=(v:bigint)=>v<0n?-v:v;
export function concentrationSelection(top:readonly {dimension:string|null;delta:string}[],total:string){
 const sorted=[...top].sort((a,b)=>{const d=magnitude(fixed(b.delta))-magnitude(fixed(a.delta));return d>0n?1:d<0n?-1:0;});assert.ok(sorted.length>=3);
 const selected=sorted.slice(0,3),opposite=sorted.find(g=>fixed(g.delta)*fixed(total)<0n);
 return {leading_groups:selected.map(g=>({group:g.dimension,delta:g.delta})),top3_absolute_delta_sum:decimal(selected.reduce((n,g)=>n+magnitude(fixed(g.delta)),0n)),offset_group:opposite?{group:opposite.dimension,delta:opposite.delta}:null};
}
export function gradeConcentration(report:Report|null,c:ConcentrationCase,oracle:ConcentrationOracle['cases'][string],csvSha:string){
 try{
  assert.ok(report,'No sealed report');assert.equal(report.evidence.length,3);assert.equal(new Set(report.evidence.map(e=>e.id)).size,3);const body=parse(concentrationBodySchema,JSON.parse(report.interpretation)),comparison=report.evidence.find(e=>e.kind==='comparison'&&hash(e.request)===hash(c.intent));assert.ok(comparison);assert.equal(body.comparison.evidence_id,comparison.id);
  for(const key of ['baseline','current','delta'] as const)assert.equal(fixed(body.comparison[key]),fixed(oracle.comparison[key]));assert.equal(new Set(body.dimensions.map(d=>d.dimension)).size,2);let groups=0;
  for(const d of body.dimensions){
   const expected=oracle.dimensions[d.dimension];assert.ok(expected);const e:Evidence|undefined=report.evidence.find(e=>e.kind==='breakdown'&&hash(e.request)===hash({comparison:c.intent,dimension:d.dimension,limit:20}));assert.ok(e);assert.equal(d.evidence_id,e.id);const grade=gradeBusinessReport(report,expected,csvSha);assert.ok(grade.passed,grade.error??'source mismatch');groups+=verifyRawGroups(e.rows,expected);
   const source=e.result as {top:{dimension:string|null;delta:string}[]};const ranked=[...expected.groups].sort((a,b)=>{const diff=magnitude(fixed(b.delta))-magnitude(fixed(a.delta));return diff>0n?1:diff<0n?-1:0;});assert.ok(ranked.length>=3);const threshold=magnitude(fixed(ranked[2]!.delta));assert.equal(new Set(d.leading_groups.map(g=>g.group)).size,3);
   for(const g of d.leading_groups){const original:Group|undefined=expected.groups.find(v=>v.dimension===g.group);assert.ok(original);assert.equal(fixed(g.delta),fixed(original.delta));assert.ok(magnitude(fixed(g.delta))>=threshold);assert.ok(source.top.some(v=>v.dimension===g.group));}
   const selectedSum=d.leading_groups.reduce((n,g)=>n+magnitude(fixed(g.delta)),0n);assert.equal(fixed(d.top3_absolute_delta_sum),selectedSum);assert.equal(selectedSum,ranked.slice(0,3).reduce((n,g)=>n+magnitude(fixed(g.delta)),0n));
   const opposing=source.top.filter(g=>fixed(g.delta)*fixed(oracle.comparison.delta)<0n);if(!opposing.length)assert.equal(d.offset_group,null);else{assert.ok(d.offset_group);const original=opposing.find(g=>g.dimension===d.offset_group?.group);assert.ok(original);assert.equal(fixed(d.offset_group.delta),fixed(original.delta));assert.ok(opposing.every(g=>magnitude(fixed(g.delta))<=magnitude(fixed(original.delta))));}
  }
  assert.deepEqual([...report.evidence.map(e=>e.id)].sort(),[body.comparison.evidence_id,...body.dimensions.map(d=>d.evidence_id)].sort());return {passed:true,error:null,raw_groups_checked:groups};
 }catch(error){return {passed:false,error:error instanceof Error?error.message:String(error),raw_groups_checked:0};}
}
