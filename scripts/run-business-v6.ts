import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { configuredProvider,Runner } from '../src/runtime.js';
import { Warehouse } from '../src/warehouse.js';
import { Store } from '../src/store.js';
import { hash,type Comparison } from '../src/domain.js';
import { exportReport } from '../src/report.js';
import { gradeBusinessReport,type BusinessOracle } from './business-evaluation.js';

const [datasetRoot,oraclePath,output]=process.argv.slice(2);if(!datasetRoot||!oraclePath||!output)throw new Error('DATASETS ORACLE NEW_OUTPUT');
assert.ok(/^https:\/\/api\.deepseek\.com\/?$/.test(process.env.METRICLAB_MODEL_URL??''));assert.ok(process.env.DEEPSEEK_API_KEY);assert.match(process.env.METRICLAB_BUSINESS_SOURCE_COMMIT??'',/^[a-f0-9]{40}$/);
await mkdir(output,{recursive:false});
interface Case {id:string;comparison:Comparison;dimension:string;limit:number;question:string;variant_order:('full'|'budgeted')[];}
interface Protocol {cases:Case[];variants:Record<'full'|'budgeted',{contextMode:'upstream'|'budgeted';maxContextBytes:number;artifactSearch:boolean}>;model:string;max_calls_per_job:number;max_output_per_call:number;request_timeout_ms:number;global_max_requests:number;dataset_csv_sha256:string;}
const protocol=JSON.parse(await readFile('examples/business-v6-protocol.json','utf8')) as Protocol;
const oracle=JSON.parse(await readFile(oraclePath,'utf8')) as {csv_sha256:string;rows:number;cases:Record<string,BusinessOracle>};assert.equal(oracle.csv_sha256,protocol.dataset_csv_sha256);assert.equal(oracle.rows,541909);
const warehouse=new Warehouse(datasetRoot),datasets=await warehouse.list();assert.equal(datasets.length,1);const dataset=datasets[0]!;assert.equal(dataset.csv_sha256,oracle.csv_sha256);
const provider=configuredProvider();assert.equal(provider.model.id,protocol.model);
const wire:unknown[]=[];const results:Record<string,unknown>[]=[];let attempts=0;
const checkpoint=async()=>writeFile(join(output,'checkpoint.json'),JSON.stringify({source_commit:process.env.METRICLAB_BUSINESS_SOURCE_COMMIT,protocol_sha256:hash(protocol),attempts,wire,results},null,2)+'\n');
await checkpoint();
for(const c of protocol.cases){for(const variant of c.variant_order){
 const config=protocol.variants[variant];const name=c.id+'-'+variant;const store=new Store(join(output,name+'.sqlite'));let runner:Runner|undefined;
 const base:StreamFn=async(model,context,options)=>{assert.ok(attempts<protocol.global_max_requests,'Global wire request budget exhausted');attempts++;wire.push({attempt:attempts,case:c.id,variant,model,context,context_JSON_bytes:Buffer.byteLength(JSON.stringify(context)),max_output:options?.maxTokens,max_retries:options?.maxRetries});await checkpoint();return provider.stream(model,context,options);};
 try{
  runner=new Runner(store,warehouse,base,provider.model,protocol.request_timeout_ms,config.maxContextBytes,config.contextMode,config.artifactSearch);
  const job=store.create(dataset.id,c.question,protocol.max_calls_per_job,protocol.max_output_per_call,c.comparison);const began=performance.now();await runner.run(job.id);
  const report=store.report(job.id),calls=store.calls(job.id) as {status:string;usage:{input:number;output:number;cacheRead:number;cacheWrite:number;cost:{total:number}}|null}[];
  const row={case:c.id,variant,question:c.question,config,wall_seconds:(performance.now()-began)/1000,job:store.job(job.id),calls,evidence:store.evidence(job.id),report,events:store.events(job.id),grade:gradeBusinessReport(report,oracle.cases[c.id]!,oracle.csv_sha256),reserved:calls.length,input_tokens_including_cache:calls.reduce((n,x)=>n+(x.usage?(x.usage.input+x.usage.cacheRead+x.usage.cacheWrite):0),0),output_tokens:calls.reduce((n,x)=>n+(x.usage?.output??0),0),estimated_cost_usd:calls.reduce((n,x)=>n+(x.usage?.cost.total??0),0),usage_missing:calls.filter(x=>!x.usage).length};
  results.push(row);await writeFile(join(output,name+'.json'),JSON.stringify(row,null,2)+'\n',{flag:'wx'});if(report)await writeFile(join(output,name+'.html'),exportReport(report,null),{flag:'wx'});await checkpoint();console.log(JSON.stringify({case:c.id,variant,status:row.job.status,reserved:row.reserved,grade:row.grade}));
 }finally{await runner?.shutdown();store.close();}
}}
const reserved=results.reduce((n,r)=>n+Number(r.reserved),0);assert.ok(reserved<=protocol.global_max_requests);assert.ok(attempts<=reserved);
await writeFile(join(output,'results.json'),JSON.stringify({kind:'New real DeepSeek business integration; two fixed tasks, not an accuracy benchmark',source_commit:process.env.METRICLAB_BUSINESS_SOURCE_COMMIT,protocol_sha256:hash(protocol),model:provider.model,actual_wire_attempts:attempts,total_reserved:reserved,oracle_csv_sha256:oracle.csv_sha256,cases:results,GPU_used:false,local_model_deployment:false,not_an_invoice:true},null,2)+'\n',{flag:'wx'});
await writeFile(join(output,'wire-transcripts.json'),JSON.stringify({wire},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({finished:true,actual_wire_attempts:attempts,total_reserved:reserved}));
