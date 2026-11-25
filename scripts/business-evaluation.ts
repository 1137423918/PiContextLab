import { strict as assert } from 'node:assert';
import { auditExpected } from './audit-evaluation.js';
import { fixed,decimal,hash,type Comparison } from '../src/domain.js';
import type { Report } from '../src/store.js';

export interface Amounts {baseline:string;current:string;delta:string;}
export interface Group extends Amounts {dimension:string|null;}
export interface BusinessOracle {comparison:Comparison;dimension:string;limit:number;totals:Amounts;groups:Group[];}

export function gradeBusinessReport(report:Report|null,oracle:BusinessOracle,csvSha256:string):{passed:boolean;error:string|null;groups_checked:number} {
 try{
  assert.ok(report,'No sealed report');assert.equal(report.dataset,'ds_'+csvSha256.slice(0,24));
  auditExpected(report,oracle.comparison,oracle.dimension,oracle.limit);
  const compare=report.evidence.find(e=>e.kind==='comparison'&&hash(e.request)===hash(oracle.comparison))!;
  const breakdown=report.evidence.find(e=>e.kind==='breakdown'&&typeof e.request==='object'&&e.request!==null&&'comparison' in e.request&&hash(e.request.comparison)===hash(oracle.comparison)&&'dimension' in e.request&&e.request.dimension===oracle.dimension&&'limit' in e.request&&e.request.limit===oracle.limit)!;
  const result=breakdown.result as {top:Group[];other:Amounts&{groups:number};totals:Amounts};
  const comparison=compare.result as Amounts;for(const key of ['baseline','current','delta'] as const){assert.equal(fixed(comparison[key]),fixed(oracle.totals[key]));assert.equal(fixed(result.totals[key]),fixed(oracle.totals[key]));}
  assert.equal(result.top.length,Math.min(oracle.limit,oracle.groups.length));const included=new Set<string|null>();
  for(const group of result.top){assert.ok(!included.has(group.dimension));included.add(group.dimension);const exact=oracle.groups.find(g=>g.dimension===group.dimension);assert.ok(exact,'Unknown group');for(const key of ['baseline','current','delta'] as const)assert.equal(fixed(group[key]),fixed(exact[key]));}
  const remainder=oracle.groups.filter(g=>!included.has(g.dimension));assert.equal(result.other.groups,remainder.length);
  for(const key of ['baseline','current','delta'] as const)assert.equal(fixed(result.other[key]),fixed(decimal(remainder.reduce((n,g)=>n+fixed(g[key]),0n))));
  const magnitude=(s:string)=>{const n=fixed(s);return n<0n?-n:n;};const smallest=result.top.reduce<bigint|undefined>((n,g)=>n===undefined||magnitude(g.delta)<n?magnitude(g.delta):n,undefined);
  assert.ok(remainder.every(g=>smallest===undefined||magnitude(g.delta)<=smallest),'Omitted group outranks a selected group');
  return {passed:true,error:null,groups_checked:oracle.groups.length};
 }catch(error){return {passed:false,error:error instanceof Error?error.message:String(error),groups_checked:0};}
}
