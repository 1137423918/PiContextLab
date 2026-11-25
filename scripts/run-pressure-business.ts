import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { ToolCall } from '@earendil-works/pi-ai';
import { Runner,configuredProvider,completedStream,message,scriptedControlModel } from '../src/runtime.js';
import { Warehouse } from '../src/warehouse.js';
import { Store } from '../src/store.js';
import { hash } from '../src/domain.js';
import { exportReport } from '../src/report.js';
import { gradePressureReport,type PressureProtocol,type PressureOracle } from './pressure-business-evaluation.js';

const [datasets,oraclePath,output,flag]=process.argv.slice(2);if(!datasets||!oraclePath||!output)throw new Error('DATASETS ORACLE NEW_OUTPUT [--control]');const control=flag==='--control';assert.ok(flag===undefined||control);
const protocol=JSON.parse(await readFile('examples/pressure-business-protocol.json','utf8')) as PressureProtocol;const oracle=JSON.parse(await readFile(oraclePath,'utf8')) as PressureOracle;assert.equal(oracle.csv_sha256,protocol.dataset_csv_sha256);assert.equal(oracle.rows,541909);
if(!control){assert.equal(process.env.METRICLAB_MODEL_URL,'https://api.deepseek.com');assert.ok(process.env.DEEPSEEK_API_KEY);assert.match(process.env.METRICLAB_PRESSURE_SOURCE_COMMIT??'',/^[a-f0-9]{40}$/);}
await mkdir(output,{recursive:false});const warehouse=new Warehouse(datasets);const all=await warehouse.list();assert.equal(all.length,1);assert.equal(all[0]!.csv_sha256,oracle.csv_sha256);
const provider=control?{model:scriptedControlModel,stream:undefined}:configuredProvider();if(!control)assert.equal(provider.model.id,protocol.model);
const zip=async(path:string,value:unknown)=>writeFile(path,gzipSync(JSON.stringify(value)));const wire:unknown[]=[],results:Record<string,unknown>[]=[],summaries:Record<string,unknown>[]=[];let attempts=0;
const checkpoint=async()=>{await writeFile(join(output,'checkpoint.json'),JSON.stringify({attempts,control,source_commit:process.env.METRICLAB_PRESSURE_SOURCE_COMMIT??null,completed:summaries},null,2)+'\n');await zip(join(output,'wire-checkpoint.json.gz'),{wire});};
await checkpoint();
for(const variant of protocol.variant_order){
 const config=protocol.variants[variant],store=new Store(join(output,variant+'.sqlite'));let runner:Runner|undefined;
 const stream:StreamFn=async(model,context,options)=>{
  assert.ok(attempts<protocol.global_max_requests);attempts++;wire.push({attempt:attempts,variant,model,context,context_JSON_bytes:Buffer.byteLength(JSON.stringify(context)),max_output:options?.maxTokens,max_retries:options?.maxRetries});await checkpoint();
  if(!control){assert.ok(provider.stream);return provider.stream(model,context,options);}
  const done=context.messages.filter(m=>m.role==='toolResult');const call=(id:string,name:string,args:ToolCall['arguments']):ToolCall=>({type:'toolCall',id,name,arguments:args});
  let calls;
  if(!done.some(m=>m.toolName==='inspect_dataset'))calls=[call('inspect','inspect_dataset',{})];
  else if(!done.some(m=>m.toolName==='compare_metric'))calls=['net_sales','gross_sales','returns'].map(metric=>call('compare-'+metric,'compare_metric',{...protocol.intent,metric}));
  else if(!done.some(m=>m.toolName==='breakdown_change'))calls=protocol.components.map(c=>call(c.id,'breakdown_change',{comparison:c.comparison,dimension:c.dimension,limit:c.limit}));
  else{
   const ids:string[]=[];
   for(const result of done.filter(m=>['compare_metric','breakdown_change'].includes(m.toolName))){const text=result.content.find(p=>p.type==='text');assert.ok(text?.type==='text');const value=JSON.parse(text.text) as {id?:string;source_identity?:{id?:string}};const id=value.id??value.source_identity?.id;assert.ok(typeof id==='string'&&id.startsWith('ev_'),'Control must read exact source evidence ID from provider view');ids.push(id);}
   assert.equal(new Set(ids).size,9);calls=[call('seal','submit_investigation',{title:'Multi-metric monthly review',evidence_ids:ids,interpretation:'Explicit scripted CPU control, not model quality',hypotheses:[]})];
  }
  return completedStream(message(model,calls,'toolUse'));
 };
 try{
  runner=new Runner(store,warehouse,stream,provider.model,protocol.request_timeout_ms,config.maxContextBytes,config.contextMode,config.artifactSearch);const job=store.create(all[0]!.id,protocol.question,protocol.max_calls_per_job,protocol.max_output_per_call,protocol.intent);await runner.run(job.id);
  const report=store.report(job.id),events=store.events(job.id),calls=store.calls(job.id) as {status:string;usage:{input:number;output:number;cacheRead:number;cacheWrite:number;cost:{total:number}}|null}[];
  const traces=(events as {kind:string;payload:{trigger:string;afterBytes:number;spilledResults:string[];archivedTurns:string[];routingCache:unknown}}[]).filter(e=>e.kind==='context_prepared').map(e=>e.payload);
  const summary={variant,status:store.job(job.id).status,error:store.job(job.id).error,grade:gradePressureReport(report,protocol,oracle),reserved:calls.length,input_tokens_including_cache:calls.reduce((n,x)=>n+(x.usage?x.usage.input+x.usage.cacheRead+x.usage.cacheWrite:0),0),output_tokens:calls.reduce((n,x)=>n+(x.usage?.output??0),0),estimated_cost_usd:calls.reduce((n,x)=>n+(x.usage?.cost.total??0),0),usage_missing:calls.filter(c=>!c.usage).length,pressure_preparations:traces.filter(t=>t.trigger==='pressure').length,spill_occurrences:traces.reduce((n,t)=>n+t.spilledResults.length,0),archive_occurrences:traces.reduce((n,t)=>n+t.archivedTurns.length,0),max_prepared_JSON_bytes:Math.max(0,...traces.map(t=>t.afterBytes)),last_routing_cache:traces.at(-1)?.routingCache??null};
  summaries.push(summary);const row={summary,job:store.job(job.id),calls,events,evidence:store.evidence(job.id),report};results.push(row);await zip(join(output,variant+'.json.gz'),row);if(report)await writeFile(join(output,variant+'.html'),exportReport(report,null),{flag:'wx'});await checkpoint();console.log(JSON.stringify(summary));
 }finally{await runner?.shutdown();store.close();}
}
const summary={control,source_commit:process.env.METRICLAB_PRESSURE_SOURCE_COMMIT??null,protocol_sha256:hash(protocol),actual_provider_attempts:attempts,model_calls:control?0:attempts,total_reserved:summaries.reduce((n,r)=>n+Number(r.reserved),0),variants:summaries,GPU_used:false,not_an_invoice:true};assert.ok(attempts<=protocol.global_max_requests);
await zip(join(output,'results.json.gz'),{summary,results});await zip(join(output,'wire-transcripts.json.gz'),{wire});await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
if(control){assert.ok(summaries.every(s=>(s.grade as {passed:boolean}).passed),'CPU feasibility task failed');const budgeted=summaries.find(s=>s.variant==='budgeted')!;assert.ok(Number(budgeted.pressure_preparations)>0&&Number(budgeted.spill_occurrences)>0,'Preflight must actually trigger pressure');assert.ok(Number(budgeted.max_prepared_JSON_bytes)<=protocol.variants.budgeted.maxContextBytes);}
