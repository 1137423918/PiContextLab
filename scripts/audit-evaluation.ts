/** Fixed evidence-derived provenance grading, separate from model input construction. */
import { hash, POLICY, type Comparison } from '../src/domain.js';
import type { Report } from '../src/store.js';

export const auditFields = ['dataset_id','metric','dimension','baseline_start','current_end','breakdown_result_sha256'] as const;
export type AuditAnswer = Record<typeof auditFields[number],string>;

export function auditExpected(report:Report,comparison:Comparison,dimension:string,topGroups?:number):AuditAnswer {
 const same=(value:unknown)=>value!==undefined&&hash(value)===hash(comparison);
 const compare=report.evidence.find(e=>e.kind==='comparison'&&same(e.request));
 const breakdown=report.evidence.find(e=>e.kind==='breakdown'&&e.request!==null&&typeof e.request==='object'&&'comparison' in e.request&&same(e.request.comparison)&&(topGroups===undefined||'limit' in e.request&&e.request.limit===topGroups)&&e.result!==null&&typeof e.result==='object'&&'dimension' in e.result&&e.result.dimension===dimension);
 if(!compare||!breakdown)throw new Error('New audit source lacks the requested comparison and matching dimension breakdown');
 for(const e of [compare,breakdown]){
  const {id:_id,...payload}=e;
  if(e.dataset!==report.dataset||e.policy!==POLICY||hash({rows:e.rows,result:e.result})!==e.result_sha256||`ev_${hash(payload)}`!==e.id)throw new Error('Audit source evidence identity mismatch');
 }
 return {dataset_id:report.dataset,metric:comparison.metric,dimension,baseline_start:comparison.baseline.start,current_end:comparison.current.end,breakdown_result_sha256:breakdown.result_sha256};
}

export function gradeAudit(text:string,expected:AuditAnswer):{answer:unknown;passed:boolean} {
 let answer:unknown=null;
 try{answer=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{return {answer,passed:false};}
 const candidate=answer!==null&&typeof answer==='object'&&!Array.isArray(answer)?answer as Record<string,unknown>:null;
 const passed=candidate!==null&&auditFields.every(key=>Object.hasOwn(candidate,key)&&typeof candidate[key]==='string'&&candidate[key]===expected[key]);
 return {answer,passed};
}
