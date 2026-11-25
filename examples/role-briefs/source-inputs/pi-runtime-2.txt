/** Source agreement at the sealing boundary. This is not an independent raw-data oracle or narrative verifier. */
import { compile } from '@earendil-works/pi-schema';
import { briefBodySchema } from './brief-schema.js';
import { comparisonSchema,breakdownSchema,fixed,ratio,hash,POLICY,type Comparison } from './domain.js';
import type { Evidence } from './warehouse.js';
import type { Report } from './store.js';

export interface BriefSourceProof {
 policy:'brief-source-claims-v1';
 verified_fields:readonly ['facts','priorities','check'];
 claims_sha256:string;
 evidence_sha256:string;
 evidence_ids:string[];
 dataset:string;
 intent_sha256:string;
}
export interface BriefClaimIssue {path:string;code:string;}
export class BriefClaimError extends Error {
 readonly issues:readonly BriefClaimIssue[];
 constructor(issues:readonly BriefClaimIssue[]){
  const bounded=issues.slice(0,8).map(issue=>({...issue}));
  const payload=()=>JSON.stringify({error:'INVALID_BRIEF_CLAIMS',issues:bounded,issues_truncated:bounded.length<issues.length,instruction:'No report was sealed. Inspect the cited saved evidence before correcting these fields. No values were substituted.'});
  while(bounded.length&&new TextEncoder().encode(JSON.stringify([{type:'text',text:payload()}])).length>2048)bounded.pop();
  super(payload());
  this.name='BriefClaimError';this.issues=bounded;
 }
}
const bodyValidator=compile(briefBodySchema),comparisonValidator=compile(comparisonSchema),breakdownValidator=compile(breakdownSchema);
const fail=(path:string,code:string):never=>{throw new BriefClaimError([{path,code}]);};
function record(value:unknown,path:string):Record<string,unknown>{if(value===null||typeof value!=='object'||Array.isArray(value))return fail(path,'INVALID_SOURCE_SHAPE');return value as Record<string,unknown>;}
function amount(value:unknown,path:string,source=true):bigint {
 if(typeof value!=='string'||value.length>64||!/^\-?\d+(\.\d{1,4})?$/.test(value))return fail(path,source?'INVALID_SOURCE_NUMBER':'INVALID_NUMBER');
 return fixed(value);
}
const periods=(c:Comparison)=>hash({baseline:c.baseline,current:c.current,basis:c.basis});
const magnitude=(v:bigint)=>v<0n?-v:v;

export function verifyBriefClaims(input:unknown,evidence:readonly Evidence[],dataset:string,intent:Comparison|null):BriefSourceProof {
 if(!bodyValidator.check(input))return fail('/brief','INVALID_SHAPE');
 if(!intent)return fail('/brief','MISSING_INTENT');
 if(evidence.length!==5||new Set(evidence.map(e=>e.id)).size!==5)return fail('/evidence_ids','REQUIRES_FIVE_DISTINCT_SOURCES');
 const body=input,byID=new Map(evidence.map(e=>[e.id,e])),used=new Set<string>(),issues:BriefClaimIssue[]=[];
 const add=(path:string,code:string)=>{issues.push({path,code});};
 const equal=(value:string,expected:bigint,path:string)=>{
  if(!/^-?\d+(\.\d{1,4})?$/.test(value))add(path,'INVALID_NUMBER');
  else if(fixed(value)!==expected)add(path,'SOURCE_VALUE_MISMATCH');
 };
 for(const e of evidence){const {id,...payload}=e;if(e.dataset!==dataset||e.policy!==POLICY||hash({rows:e.rows,result:e.result})!==e.result_sha256||'ev_'+hash(payload)!==id)return fail('/evidence_ids','SOURCE_INTEGRITY_OR_SCOPE');}
 const family=body.check.name==='gross_per_order'?['gross_sales','sales_orders','avg_order_value']:['gross_sales','returns','net_sales'];
 if(new Set(body.facts.map(f=>f.metric)).size!==3||body.facts.some(f=>!family.includes(f.metric))||!body.facts.some(f=>f.metric===intent.metric))return fail('/brief/facts','RELATION_METRIC_SET_MISMATCH');
 const values=new Map<string,{id:string;baseline:bigint;current:bigint;delta:bigint}>();
 for(const [index,fact] of body.facts.entries()){
  const path='/brief/facts/'+index,e=byID.get(fact.evidence_id);
  if(!e||e.kind!=='comparison')return fail(path+'/evidence_id','COMPARISON_SOURCE_REQUIRED');
  const request:unknown=e.request;if(!comparisonValidator.check(request)||request.metric!==fact.metric||periods(request)!==periods(intent))return fail(path+'/evidence_id','SOURCE_REQUEST_MISMATCH');
  const result=record(e.result,path),rows=new Map<string,Record<string,unknown>>();
  if(result.metric!==fact.metric)return fail(path,'SOURCE_METRIC_MISMATCH');
  for(const row of e.rows){if((row.period!=='baseline'&&row.period!=='current')||rows.has(row.period))return fail(path,'INVALID_SOURCE_PERIOD_ROWS');rows.set(row.period,row);}
  if(rows.size!==2)return fail(path,'INVALID_SOURCE_PERIOD_ROWS');
  const read=(period:'baseline'|'current')=>{
   const row=rows.get(period)!;let n=amount(row.value,path);
   if(fact.metric==='avg_order_value'){
    if(typeof row.orders!=='string'||!/^[0-9]{1,64}$/.test(row.orders))return fail(path,'INVALID_SOURCE_ORDER_COUNT');
    const average=ratio(n,BigInt(row.orders));if(average===null)return fail(path,'SOURCE_VALUE_UNAVAILABLE');n=fixed(average);
   }
   if(amount(result[period],path)!==n)return fail(path,'SOURCE_ROWS_RESULT_MISMATCH');
   return n;
  };
  const baseline=read('baseline'),current=read('current'),delta=current-baseline;
  if(amount(result.delta,path)!==delta)return fail(path,'SOURCE_ROWS_RESULT_MISMATCH');
  equal(fact.baseline,baseline,path+'/baseline');equal(fact.current,current,path+'/current');equal(fact.delta,delta,path+'/delta');
  if(fact.direction!==(delta>0n?'increase':delta<0n?'decrease':'unchanged'))add(path+'/direction','DIRECTION_MISMATCH');
  values.set(fact.metric,{id:e.id,baseline,current,delta});used.add(e.id);
 }
 if(new Set(body.priorities.map(p=>p.dimension)).size!==2)return fail('/brief/priorities','ONE_COUNTRY_AND_ONE_PRODUCT_REQUIRED');
 for(const [index,priority] of body.priorities.entries()){
  const path='/brief/priorities/'+index,e=byID.get(priority.evidence_id);
  if(!e||e.kind!=='breakdown')return fail(path+'/evidence_id','BREAKDOWN_SOURCE_REQUIRED');
  const request:unknown=e.request;
  if(!breakdownValidator.check(request)||request.comparison.metric!==priority.metric||request.dimension!==priority.dimension||periods(request.comparison)!==periods(intent)||!values.has(priority.metric))return fail(path+'/evidence_id','SOURCE_REQUEST_MISMATCH');
  const groups=new Map<string|null,{baseline:bigint;current:bigint}>(),seen=new Set<string>();
  for(const row of e.rows){
   if((row.dimension!==null&&typeof row.dimension!=='string')||(row.period!=='baseline'&&row.period!=='current'))return fail(path,'INVALID_SOURCE_GROUP_ROWS');
   const identity=JSON.stringify([row.dimension,row.period]);if(seen.has(identity))return fail(path,'INVALID_SOURCE_GROUP_ROWS');seen.add(identity);
   const pair=groups.get(row.dimension)??{baseline:0n,current:0n};pair[row.period]=amount(row.value,path);groups.set(row.dimension,pair);
  }
  const result=record(e.result,path),totals=record(result.totals,path),comparison=values.get(priority.metric)!;
  if(result.metric!==priority.metric||result.dimension!==priority.dimension)return fail(path,'SOURCE_METRIC_MISMATCH');
  for(const period of ['baseline','current'] as const){const sum=[...groups.values()].reduce((n,g)=>n+g[period],0n);if(sum!==comparison[period]||amount(totals[period],path)!==sum)return fail(path,'SOURCE_GROUP_TOTAL_MISMATCH');}
  if(amount(totals.delta,path)!==comparison.delta)return fail(path,'SOURCE_GROUP_TOTAL_MISMATCH');
  if(!Array.isArray(result.top)||result.top.length!==Math.min(request.limit,groups.size))return fail(path,'INVALID_SOURCE_TOP_GROUPS');
  const included=new Set<string|null>();let smallest:bigint|undefined;
  for(const item of result.top){
   const top=record(item,path);if((top.dimension!==null&&typeof top.dimension!=='string')||included.has(top.dimension))return fail(path,'INVALID_SOURCE_TOP_GROUPS');
   const pair=groups.get(top.dimension);if(!pair)return fail(path,'INVALID_SOURCE_TOP_GROUPS');included.add(top.dimension);
   if(amount(top.baseline,path)!==pair.baseline||amount(top.current,path)!==pair.current||amount(top.delta,path)!==pair.current-pair.baseline)return fail(path,'SOURCE_ROWS_RESULT_MISMATCH');
   const change=magnitude(pair.current-pair.baseline);smallest=smallest===undefined||change<smallest?change:smallest;
  }
  const remainder=[...groups].filter(([key])=>!included.has(key)),other=record(result.other,path);
  if(other.groups!==remainder.length||remainder.some(([,g])=>smallest!==undefined&&magnitude(g.current-g.baseline)>smallest))return fail(path,'INVALID_SOURCE_TOP_GROUPS');
  for(const period of ['baseline','current'] as const)if(amount(other[period],path)!==remainder.reduce((n,[,g])=>n+g[period],0n))return fail(path,'SOURCE_OTHER_MISMATCH');
  if(amount(other.delta,path)!==remainder.reduce((n,[,g])=>n+g.current-g.baseline,0n))return fail(path,'SOURCE_OTHER_MISMATCH');
  const selected=groups.get(priority.group);
  if(!selected)add(path+'/group','SOURCE_GROUP_MISSING');
  else{
   const delta=selected.current-selected.baseline;equal(priority.delta,delta,path+'/delta');
   if([...groups.values()].some(g=>magnitude(g.current-g.baseline)>magnitude(delta)))add(path+'/group','NOT_MAXIMUM_ABSOLUTE_CHANGE');
  }
  used.add(e.id);
 }
 if(used.size!==5)return fail('/evidence_ids','UNUSED_OR_REPEATED_SOURCE');
 const comparisonIDs=[...values.values()].map(v=>v.id).sort();
 if(JSON.stringify([...body.check.source_evidence_ids].sort())!==JSON.stringify(comparisonIDs))add('/brief/check/source_evidence_ids','CHECK_SOURCE_SET_MISMATCH');
 for(const period of ['baseline','current'] as const){
  const gross=values.get('gross_sales')![period];let expected:bigint;
  if(body.check.name==='gross_minus_returns'){
   expected=gross-values.get('returns')![period];if(expected!==values.get('net_sales')![period])return fail('/brief/check','SOURCE_RELATION_MISMATCH');
  }else{
   const orders=values.get('sales_orders')![period];if(orders%10000n!==0n||orders<0n)return fail('/brief/check','INVALID_SOURCE_ORDER_COUNT');
   const average=ratio(gross,orders/10000n);if(average===null)return fail('/brief/check','SOURCE_VALUE_UNAVAILABLE');expected=fixed(average);
   if(expected!==values.get('avg_order_value')![period])return fail('/brief/check','SOURCE_RELATION_MISMATCH');
  }
  equal(body.check[period],expected,'/brief/check/'+period);
 }
 if(issues.length)throw new BriefClaimError(issues);
 return {policy:'brief-source-claims-v1',verified_fields:['facts','priorities','check'],claims_sha256:hash({facts:body.facts,priorities:body.priorities,check:body.check}),evidence_sha256:hash(evidence),evidence_ids:evidence.map(e=>e.id),dataset,intent_sha256:hash(intent)};
}

/** Check the stored proof's report/content binding before displaying its verification scope. */
export function briefProofMatches(report:Report):boolean {
 try{
  const proof=report.claims_proof;
  if(!proof||proof.policy!=='brief-source-claims-v1'||JSON.stringify(proof.verified_fields)!==JSON.stringify(['facts','priorities','check'])||proof.dataset!==report.dataset)return false;
  const body:unknown=JSON.parse(report.interpretation);if(!bodyValidator.check(body))return false;
  if(proof.claims_sha256!==hash({facts:body.facts,priorities:body.priorities,check:body.check})||proof.evidence_sha256!==hash(report.evidence)||JSON.stringify(proof.evidence_ids)!==JSON.stringify(report.evidence.map(e=>e.id)))return false;
  if(!report.evidence.some(e=>e.kind==='comparison'&&hash(e.request)===proof.intent_sha256))return false;
  const {id,created:_created,...payload}=report;return id==='report_'+hash(payload);
 }catch{return false;}
}
