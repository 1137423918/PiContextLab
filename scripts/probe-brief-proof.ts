/** CPU regression of sealing semantics using immutable recorded claims; no provider credentials or grader invocation. */
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { join,dirname,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Agent,contentJsonBytes } from '@earendil-works/pi-agent-core';
import { BriefRunner } from '../src/brief-client.js';
import { briefProofMatches } from '../src/brief-proof.js';
import { Store,type Report } from '../src/store.js';
import { Warehouse } from '../src/warehouse.js';
import { completedStream,message,scriptedControlModel } from '../src/runtime.js';
import { hash,parse } from '../src/domain.js';
import { briefBodySchema,type BriefBody } from '../src/brief-schema.js';
import { exportReport } from '../src/report.js';
import type { BriefProtocol } from './brief-evaluation.js';

const [baselinePath,datasets,sourcePath,output]=process.argv.slice(2);if(!baselinePath||!datasets||!sourcePath||!output)throw new Error('FROZEN_V11_CLIENT_JS DATASETS FROZEN_RESULTS_GZ NEW_OUTPUT');
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const protocolBytes=await readFile('examples/brief-proof-replay-protocol.json'),protocol=JSON.parse(protocolBytes.toString()) as {source_results_sha256:string;baseline_brief_client_ts_sha256:string};
const source=await readFile(sourcePath);assert.equal(sha(source),protocol.source_results_sha256);const baselineSource=await readFile(resolve(dirname(baselinePath),'../../src/brief-client.ts'));assert.equal(sha(baselineSource),protocol.baseline_brief_client_ts_sha256);assert.equal((JSON.parse(await readFile(resolve(dirname(baselinePath),'../../vendor/pi-agent-core/package.json'),'utf8')) as {version:string}).version,'1.6.0-contextlab.11');
const old=await import(pathToFileURL(baselinePath).href) as {BriefRunner:typeof BriefRunner};const original=JSON.parse(gunzipSync(source).toString()) as {rows:{report:Report|null;summary:{case:string;variant:string;grade:{passed:boolean}}}[]};const taskProtocol=JSON.parse(await readFile('examples/brief-study-protocol.json','utf8')) as BriefProtocol;await mkdir(output,{recursive:false});const rows=[];
for(const input of original.rows){if(!input.report)continue;const recorded=input.report,c=taskProtocol.cases.find(c=>c.id===input.summary.case);assert.ok(c);
 for(const variant of ['legacy-v11','source-claims-v1'] as const){const name=c.id+'-'+input.summary.variant+'-'+variant;const store=new Store(join(output,name+'.sqlite'));
  try{const job=store.create(recorded.dataset,'CPU regression replay of recorded claims',8,1536,c.intent),claim=store.claim(job.id);for(const e of recorded.evidence)store.commitTool(claim,e.id,{cpu_import:true},{},e);const Constructor=variant==='legacy-v11'?old.BriefRunner:BriefRunner,runner=new Constructor(store,new Warehouse(datasets),m=>completedStream(message(m,[])));const tool=runner.tools(claim).find(t=>t.name==='submit_investigation');assert.ok(tool);
   const args:{title:string;evidence_ids:string[];brief:BriefBody;hypotheses:string[]}={title:'CPU recorded-claim replay: '+c.id,evidence_ids:recorded.evidence.map(e=>e.id),brief:parse(briefBodySchema,JSON.parse(recorded.interpretation)),hypotheses:recorded.hypotheses};const untouched:string=JSON.stringify(args);let scripted=0;const agent=new Agent({streamFn:m=>{scripted++;return completedStream(message(m,[{type:'toolCall',id:'recorded-submit',name:tool.name,arguments:args}],'toolUse'));},toolValidationFeedback:'bounded',initialState:{model:scriptedControlModel,tools:[tool]},finishTurn:()=>({action:'end'})});await agent.prompt('Replay this recorded claim body once for CPU source verification.');assert.equal(scripted,1);assert.equal(JSON.stringify(args),untouched);const report=store.report(job.id),result=agent.state.messages.find(m=>m.role==='toolResult');assert.ok(result?.role==='toolResult');const accepts=report!==null;const errors=result.isError?result.content:[];if(result.isError)assert.ok(contentJsonBytes(result.content)<=2048);
   if(variant==='source-claims-v1'){assert.equal(accepts,input.summary.grade.passed);if(report)assert.equal(briefProofMatches(report),true);else{assert.equal(store.latestEvent(job.id,'report_sealed'),null);assert.equal(store.db.prepare('SELECT count(*) n FROM tools WHERE job=? AND call_id=?').get(job.id,'recorded-submit')?.n,0);}}
   else{assert.equal(accepts,true);assert.equal(report?.claims_proof,undefined);}
   if(report){const repeated=await tool.execute('recorded-submit',args);assert.equal((repeated.details as Report).id,report.id);assert.equal((store.events(job.id) as {kind:string}[]).filter(e=>e.kind==='report_sealed').length,1);await writeFile(join(output,name+'.html'),exportReport(report,null),{flag:'wx'});}
   const row={case:c.id,original_variant:input.summary.variant,variant,original_study_grade:input.summary.grade,accepted:accepts,proof_valid:report?briefProofMatches(report):false,report_id:report?.id??null,original_claim_body_sha256:hash(JSON.parse(recorded.interpretation)),claim_arguments_unchanged:true,scripted_provider_calls:scripted,real_model_calls:0,error_content:errors,error_content_bytes:contentJsonBytes(errors),human_review_written:false};rows.push(row);store.finish(claim,accepts?'completed':'failed',accepts?null:'Recorded claims rejected by current source guard');console.log(JSON.stringify({...row,error_content:undefined}));
  }finally{store.close();}
 }}
assert.equal(rows.length,6);assert.equal(sha(await readFile(sourcePath)),protocol.source_results_sha256);await writeFile(join(output,'results.json'),JSON.stringify({kind:'Application sealing regression on recorded claims, not actual model correction or changed study grade',protocol_sha256:sha(protocolBytes),input_sha256:sha(source),baseline_client_source_sha256:sha(baselineSource),rows,real_model_calls:0,GPU_used:false},null,2)+'\n',{flag:'wx'});
