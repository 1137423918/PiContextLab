import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Agent,BudgetedContextPolicy,type BudgetedPolicyTrace } from '@earendil-works/pi-agent-core';
import { Agent as UpstreamAgent } from '@pi-context-lab/upstream-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import { configuredProvider,durableStream } from '../src/runtime.js';
import { Store,type Report } from '../src/store.js';
import { hash,type Comparison } from '../src/domain.js';
import { auditExpected,gradeAudit } from './audit-evaluation.js';

type Variant='upstream-full'|'native-read'|'native-search';
interface Case{id:string;documentation_turns:number;documentation_codepoints_per_turn?:number;max_calls:number;max_output:number;variant_order:Variant[];}
interface Protocol {source_case:string;comparison:Comparison;dimension:string;limit:number;question:string;system:string;cases:Case[];}
interface Usage {input:number;output:number;cacheRead:number;cacheWrite:number;cost:{total:number};}
interface StudyResult {case:string;variant:Variant;shared_input_sha256:string;expected:ReturnType<typeof auditExpected>;answer:unknown;passed:boolean;error:string|null;requests:number;input_tokens:number;output_tokens:number;estimated_cost_usd:number;wall_seconds:number;calls:unknown[];wire:unknown[];traces:BudgetedPolicyTrace[];new_tool_calls:unknown[];}
const [sourcePath,outputArgument]=process.argv.slice(2);if(!sourcePath||!outputArgument)throw new Error('NEW_NATIVE_RESULTS NEW_OUTPUT_DIRECTORY');const output:string=outputArgument;await mkdir(output,{recursive:false});
const protocol=JSON.parse(await readFile('examples/context-v4-protocol.json','utf8')) as Protocol;
const source=JSON.parse(await readFile(sourcePath,'utf8')) as {cases:{case:string;job:{dataset:string;status:string;messages:Message[]};report:Report|null}[]};
const original=source.cases.find(c=>c.case===protocol.source_case);
if(!original?.report||original.job.status!=='completed')throw new Error('New successful source report missing; no fallback or paid audit requests');
const expected=auditExpected(original.report,protocol.comparison,protocol.dimension,protocol.limit);
const provider=configuredProvider();if(provider.model.provider!=='deepseek')throw new Error('Official DeepSeek required');
const docs=await readFile('vendor/pi-agent-core/UPSTREAM_README.md','utf8');
const store=new Store(join(output,'ledger.sqlite'));const results:StudyResult[]=[];
let stopping=false;let current:Agent|UpstreamAgent|undefined;
const stop=()=>{stopping=true;current?.abort();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
function history(c:Case):Message[]{
 const messages:Message[]=structuredClone(original!.job.messages.filter(m=>m.role!=='system').map(m=>{if(m.role==='toolResult'){const {details:_details,...view}=m;return view;}return m;}));
 for(let i=0;i<c.documentation_turns;i++){
  const excerpt=Array.from(docs).slice(i*900,i*900+(c.documentation_codepoints_per_turn??1200)).join('');
  messages.push({role:'user',content:`Controlled SDK reference ${i+1}: retain this excerpt for a later question.`,timestamp:100+i*2},{role:'assistant',content:[{type:'text',text:excerpt}],api:provider.model.api,provider:provider.model.provider,model:provider.model.id,stopReason:'stop',timestamp:101+i*2,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
 }
 return messages;
}
async function checkpoint(terminal:boolean):Promise<void>{
 const total=Number(store.db.prepare('SELECT count(*) n FROM calls').get()?.n??0);if(total>24)throw new Error('Frozen audit request ceiling exceeded');
 const state={study:'V4: new gross-sales provenance audit, full vs native-read vs native-search;2cases, not an accuracy benchmark',terminal,complete:results.length===6&&!stopping,stopped:stopping,source_commit:process.env.METRICLAB_AUDIT_SOURCE_COMMIT??null,protocol_sha256:hash(protocol),source_sha256:hash(source),model:provider.model,total_requests:total,GPU_used:false,local_model_deployment:false,results};
 const path=join(output,'results.json');await writeFile(path+'.tmp',JSON.stringify(state,null,2)+'\n');await rename(path+'.tmp',path);
}
try{
 outer:for(const c of protocol.cases)for(const variant of c.variant_order){
  if(stopping)break outer;
  const shared=history(c);const sharedHash=hash({system:protocol.system,history:shared,question:protocol.question});
  const job=store.create(original.job.dataset,protocol.question,c.max_calls,c.max_output);const claim=store.claim(job.id);const traces:BudgetedPolicyTrace[]=[];const wire:{bytes:number;sha256:string}[]=[];let selected:string[]|undefined;
  const policy=variant==='upstream-full'?undefined:new BudgetedContextPolicy({artifacts:{put:async a=>store.putContextArtifact(claim,a),get:async id=>store.getContextArtifact(claim.id,id)},artifactSearch:variant==='native-search',maxContextBytes:16384,inlineToolResultBytes:2048,maxTools:2,maxSchemaBytes:4096,alwaysInclude:[],onPrepared:t=>{store.recordContextPrepared(claim,t);traces.push(t);selected=[...t.selectedToolNames];}});
  const options={streamFn:durableStream(store,claim,provider.stream,90000,65536,policy?()=>{if(!selected)throw new Error('Missing request tool selection');return selected;}:undefined),initialState:{model:provider.model,systemPrompt:protocol.system,tools:[],messages:[{role:'system' as const,content:protocol.system,toolsAdded:[],timestamp:0},...shared]},onPayload:(payload:unknown)=>{wire.push({bytes:Buffer.byteLength(JSON.stringify(payload),'utf8'),sha256:hash(payload)});}};
  const agent=policy?new Agent({...options,modelContextPolicy:policy}):new UpstreamAgent(options);current=agent;
  const heartbeat=setInterval(()=>{try{store.heartbeat(claim);}catch{agent.abort();}},2000);const began=performance.now();let failure:string|null=null;
  agent.subscribe(event=>{if(event.type==='message_end')store.messages(claim,agent.state.messages);});
  try{store.bindRuntime(claim,{variant,sharedHash,model:provider.model,protocol:hash(protocol)});await agent.prompt({role:'user',content:protocol.question,timestamp:0});await agent.waitForIdle();}catch(error){failure=String(error);}finally{clearInterval(heartbeat);current=undefined;}
  const last=agent.state.messages.at(-1);const answerText=last?.role==='assistant'?last.content.filter(b=>b.type==='text').map(b=>b.type==='text'?b.text:'').join(''):'';
  const grade=gradeAudit(answerText,expected);const passed=grade.passed&&last?.role==='assistant'&&last.stopReason==='stop';failure=failure??agent.state.errorMessage??null;
  const rows=store.db.prepare('SELECT id,status,reply FROM calls WHERE job=? ORDER BY created,id').all(job.id);let input=0,outputTokens=0,cost=0;
  const calls=rows.map(row=>{const reply=row.reply?JSON.parse(String(row.reply)) as {usage?:Usage;stopReason:string;errorMessage?:string}:null;if(reply?.usage){input+=reply.usage.input+reply.usage.cacheRead+reply.usage.cacheWrite;outputTokens+=reply.usage.output;cost+=reply.usage.cost.total;}return {id:row.id,status:row.status,stop:reply?.stopReason??null,error:reply?.errorMessage??null,usage:reply?.usage??null};});
  const error=failure??(passed?null:'Exact six-field answer mismatch');store.finish(claim,passed?'completed':'failed',error);
  const result:StudyResult={case:c.id,variant,shared_input_sha256:sharedHash,expected,answer:grade.answer,passed,error,requests:calls.length,input_tokens:input,output_tokens:outputTokens,estimated_cost_usd:cost,wall_seconds:(performance.now()-began)/1000,calls,wire,traces,new_tool_calls:agent.state.messages.slice(shared.length+1).filter(m=>m.role==='assistant').flatMap(m=>m.role==='assistant'?m.content.filter(b=>b.type==='toolCall').map(b=>b.type==='toolCall'?{name:b.name,arguments:b.arguments}:null):[])};
  results.push(result);await writeFile(join(output,`${c.id}-${variant}.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx'});await checkpoint(false);console.log(JSON.stringify({...result,calls:undefined,wire:undefined,traces:undefined,new_tool_calls:undefined}));
 }
 await checkpoint(true);
}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);store.close();}
