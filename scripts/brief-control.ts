/** Scripted feasibility provider. Every fact is re-read from the current provider view or explicit assistant notes in that view. */
import assert from 'node:assert/strict';
import type { TranscriptContext,ToolCall,AssistantMessage } from '@earendil-works/pi-ai';
import { obj } from '@earendil-works/pi-schema';
import { briefFactsSchema,type BriefBody } from '../src/brief-client.js';
import { fixed,decimal,ratio,parse,comparisonSchema,breakdownSchema } from '../src/domain.js';
import type { BriefCase } from './brief-evaluation.js';

const memoSchema=obj({brief_control_notes:obj({facts:briefFactsSchema})});
const record=(value:unknown):Record<string,unknown>=>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;};
interface Frame{id:string;metric:string;dimension:string|null;artifact?:string;baseline?:string;current?:string;delta?:string;top?:{dimension:string|null;delta:string}[];}
export function briefControl(context:TranscriptContext,c:BriefCase,attempt:number):AssistantMessage['content']{
 const calls=new Map<string,ToolCall>(),frames=new Map<string,Frame>();let noted:BriefBody['facts']|undefined;
 for(const m of context.messages)if(m.role==='assistant')for(const p of m.content){if(p.type==='toolCall')calls.set(p.id,p);if(p.type==='text'&&p.text.startsWith('{"brief_control_notes":'))noted=parse(memoSchema,JSON.parse(p.text)).brief_control_notes.facts;}
 const key=(metric:string,dimension:string|null)=>metric+'::'+(dimension??'comparison');
 for(const m of context.messages){if(m.role!=='toolResult'||m.isError||!['compare_metric','breakdown_change'].includes(m.toolName))continue;const call=calls.get(m.toolCallId);assert.ok(call);const request=m.toolName==='compare_metric'?parse(comparisonSchema,call.arguments):parse(breakdownSchema,call.arguments);const metric='comparison' in request?request.comparison.metric:request.metric;const dimension='dimension' in request?request.dimension:null;const part=m.content.find(p=>p.type==='text');assert.ok(part?.type==='text');const payload=record(JSON.parse(part.text));const id=payload.id??record(payload.source_identity).id;assert.equal(typeof id,'string');const frame:Frame={id:String(id),metric,dimension};
  if(payload.context_artifact){const artifact=record(payload.context_artifact).artifact_id;assert.equal(typeof artifact,'string');frame.artifact=String(artifact);}else if(payload.result){const result=record(payload.result);for(const k of ['baseline','current','delta'] as const)if(typeof result[k]==='string')frame[k]=result[k];if(Array.isArray(result.top))frame.top=result.top.map(row=>{const value=record(row);assert.ok(value.dimension===null||typeof value.dimension==='string');assert.equal(typeof value.delta,'string');return {dimension:value.dimension as string|null,delta:String(value.delta)};});}
  frames.set(key(metric,dimension),frame);
 }
 for(const m of context.messages){if(m.role!=='toolResult'||m.isError||m.toolName!=='read_context_artifact')continue;const part=m.content.find(p=>p.type==='text');if(part?.type!=='text')continue;const payload=record(JSON.parse(part.text));if(!Array.isArray(payload.values))continue;const frame=[...frames.values()].find(f=>f.artifact===payload.artifact_id);if(!frame)continue;for(const item of payload.values){const value=record(item);if(value.has_more!==false||typeof value.text!=='string')continue;for(const k of ['baseline','current','delta'] as const)if(value.json_pointer==='/result/'+k)frame[k]=value.text;if(value.json_pointer==='/result/top/0'){const group=record(JSON.parse(value.text));assert.ok(group.dimension===null||typeof group.dimension==='string');assert.equal(typeof group.delta,'string');frame.top=[{dimension:group.dimension as string|null,delta:String(group.delta)}];}}}
 const call=(name:string,args:ToolCall['arguments'],suffix:string):ToolCall=>({type:'toolCall',id:'control-'+attempt+'-'+suffix,name,arguments:args});
 if(!context.messages.some(m=>m.role==='toolResult'&&m.toolName==='inspect_dataset'&&!m.isError))return [call('inspect_dataset',{},'inspect')];
 const missing=c.metrics.filter(metric=>!frames.has(key(metric,null)));if(missing.length)return missing.map(metric=>call('compare_metric',{...c.intent,metric},metric));
 const facts:BriefBody['facts']=c.metrics.flatMap(metric=>{const frame=frames.get(key(metric,null))!;if(frame.baseline!==undefined&&frame.current!==undefined&&frame.delta!==undefined){const delta=fixed(frame.delta);return [{metric,evidence_id:frame.id,baseline:frame.baseline,current:frame.current,delta:frame.delta,direction:delta>0n?'increase' as const:delta<0n?'decrease' as const:'unchanged' as const}];}return noted?.filter(f=>f.metric===metric)??[];});
 const reads:ToolCall[]=[];
 for(const metric of c.metrics){if(facts.some(f=>f.metric===metric))continue;const frame=frames.get(key(metric,null))!;assert.ok(frame.artifact,'Missing comparison facts have no provider-visible recall handle');reads.push(call('read_context_artifact',{artifact_id:frame.artifact,json_pointers:['/result/baseline','/result/current','/result/delta'],offset:0,limit:4096},'read-'+metric));}
 const notes=facts.length===3&&!noted?[{type:'text' as const,text:JSON.stringify({brief_control_notes:{facts}})}]:[];
 if(reads.length)return [...notes,...reads];
 const needed=c.breakdowns.filter(b=>!frames.has(key(b.metric,b.dimension)));if(needed.length)return [...notes,...needed.map(b=>call('breakdown_change',{comparison:{...c.intent,metric:b.metric},dimension:b.dimension,limit:b.limit},b.id))];
 const priorities:BriefBody['priorities']=[];
 for(const b of c.breakdowns){const frame=frames.get(key(b.metric,b.dimension))!;if(frame.top?.[0])priorities.push({metric:b.metric,dimension:b.dimension,evidence_id:frame.id,group:frame.top[0].dimension,delta:frame.top[0].delta});else{assert.ok(frame.artifact,'Missing priority has no provider-visible recall handle');reads.push(call('read_context_artifact',{artifact_id:frame.artifact,json_pointers:['/result/top/0'],offset:0,limit:4096},'read-'+b.id));}}
 if(reads.length)return [...notes,...reads];assert.equal(facts.length,3);assert.equal(priorities.length,2);
 const number=(metric:string,p:'baseline'|'current')=>{const fact=facts.find(f=>f.metric===metric);assert.ok(fact);return fact[p];};
 const check=(p:'baseline'|'current')=>c.check==='gross_per_order'?ratio(fixed(number('gross_sales',p)),fixed(number('sales_orders',p))/10000n):decimal(fixed(number('gross_sales',p))-fixed(number('returns',p)));const baseline=check('baseline'),current=check('current');assert.ok(baseline&&current);
 const brief:BriefBody={facts,priorities,check:{name:c.check,source_evidence_ids:facts.map(f=>f.evidence_id),baseline,current},note:'Explicit source-view-only scripted feasibility control; not model quality.'};
 return [call('submit_investigation',{title:c.id,evidence_ids:[...new Set([...facts.map(f=>f.evidence_id),...priorities.map(p=>p.evidence_id)])],brief,hypotheses:[]},'seal')];
}
