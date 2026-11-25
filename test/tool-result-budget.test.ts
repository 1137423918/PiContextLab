import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { Agent,agentLoop,agentLoopContinue,allocateToolResultBudgets,contentJsonBytes,CONTEXT_RECALL_BUDGET_GROUP,createContextReadTool,createContextSearchTool,contextArtifact,runToolCall,type AgentMessage,type AgentTool,type ContextArtifact,type ContextArtifactStore,type StreamFn,type ContextReadContinuation } from '@earendil-works/pi-agent-core';
import { obj,int } from '@earendil-works/pi-schema';
import type { ToolCall } from '@earendil-works/pi-ai';
import { completedStream,message,scriptedControlModel,Runner } from '../src/runtime.js';
import { fixture,comparison } from './fixtures.js';

const caps={ [CONTEXT_RECALL_BUDGET_GROUP]:8192 };
class Artifacts implements ContextArtifactStore {values=new Map<string,ContextArtifact>();async put(a:ContextArtifact){this.values.set(a.id,a);}async get(id:string){return this.values.get(id);}}
const call=(id:string,name:string,argumentsValue:{[key:string]:string|number|string[]})=>({type:'toolCall' as const,id,name,arguments:argumentsValue});
function payload(result:{content:unknown[]}){const text=result.content[0] as {type:string;text:string};assert.equal(text.type,'text');return JSON.parse(text.text) as {status?:string;codepoints_used:number;values?:{text:string;returned_codepoints:number;next_read:ContextReadContinuation|null}[]};}

test('allocator is deterministic, water-fills capped groups, and rejects infeasible or ambiguous batches',()=>{
 const small:AgentTool={name:'small',label:'small',description:'small',parameters:obj({}),resultBudget:{group:'g',minBytes:256,maxBytes:1024},execute:async()=>({content:[],details:{}})};const big={...small,name:'big',resultBudget:{group:'g',minBytes:256,maxBytes:8192}};
 const calls=[call('a','small',{}),call('b','big',{})];assert.deepEqual([...allocateToolResultBudgets(calls,[small,big],{g:8192})],[['a',1024],['b',7168]]);assert.equal(allocateToolResultBudgets(calls,[small,big]).size,0);
 assert.throws(()=>allocateToolResultBudgets(calls,[small,big],{g:256}),/minimum/);assert.throws(()=>allocateToolResultBudgets([calls[0]!,calls[0]!],[small],{g:8192}),/repeated/);assert.throws(()=>allocateToolResultBudgets(calls,[small,big],{g:1}),/safe integers/);
});

test('four native reads share the same hard content budget in sequential and parallel execution',async()=>{
 for(const toolExecution of ['sequential','parallel'] as const){const store=new Artifacts();const artifacts=await Promise.all(Array.from({length:4},(_,i)=>contextArtifact(JSON.stringify({note:`slot${i} `+'甲🧪"\n'.repeat(1000)}),'tool-result')));for(const a of artifacts)await store.put(a);const reader=createContextReadTool(store);const calls=artifacts.map((a,i)=>call('read-'+i,reader.name,{artifact_id:a.id,json_pointers:['/note'],offset:0,limit:4096}));let requests=0;
  const stream:StreamFn=m=>{requests++;return completedStream(message(m,calls,'toolUse'));};const agent=new Agent({streamFn:stream,toolExecution,toolResultBudgets:caps,initialState:{model:scriptedControlModel,tools:[reader]},finishTurn:()=>({action:'end'})});await agent.prompt('Read the saved fields');const results=agent.state.messages.filter(m=>m.role==='toolResult');assert.equal(requests,1);assert.equal(results.length,4);assert.ok(results.reduce((n,r)=>n+contentJsonBytes(r.content),0)<=8192);for(const r of results){assert.ok(contentJsonBytes(r.content)<=2048);const p=payload(r);assert.ok(p.codepoints_used>0);assert.equal(p.values?.[0]?.next_read?.offset,p.values?.[0]?.returned_codepoints);}assert.deepEqual((agent.state.messages.find(m=>m.role==='assistant') as {content:unknown}).content,calls);
 }
});

test('byte-constrained Unicode cursors reconstruct exact text without advancing by the requested limit',async()=>{
 const store=new Artifacts(),text='甲🧪"\nB'.repeat(600);const a=await contextArtifact(JSON.stringify({text}),'tool-result');await store.put(a);const reader=createContextReadTool(store);let cursor:ContextReadContinuation|null={artifact_id:a.id,json_pointers:['/text'],offset:0,limit:4096},joined='',pages=0;
 while(cursor){const result=await reader.execute('page-'+pages,cursor,undefined,undefined,{resultBudgetBytes:2048});assert.ok(contentJsonBytes(result.content)<=2048);const p=payload(result);assert.ok(p.codepoints_used>0);joined+=p.values![0]!.text;cursor=p.values![0]!.next_read;assert.ok(++pages<50);}assert.equal(joined,text);assert.ok(pages>1);
});

test('unfittable metadata and search matches defer explicitly, and do not imply EOF or absence',async()=>{
 const store=new Artifacts();const longKey='key'.repeat(120);const a=await contextArtifact(JSON.stringify({[longKey]:'needle '+ 'x'.repeat(5000)}),'tool-result');await store.put(a);const read=createContextReadTool(store),search=createContextSearchTool(store);
 const verify=async(tool:typeof read|typeof search,args:ToolCall['arguments'])=>{const result=await runToolCall({type:'toolCall',id:'defer',name:tool.name,arguments:args},{tools:[tool],assistantMessage:message(scriptedControlModel,[]),context:{messages:[]},resultBudgetBytes:256});assert.ok(contentJsonBytes(result.result.content)<=256);assert.equal(payload(result.result).status,'deferred');};
 await verify(read,{artifact_id:a.id,json_pointers:['/'+longKey],offset:0,limit:4096});await verify(search,{artifact_id:a.id,query:'needle',limit:20});
 assert.equal((await store.get(a.id))?.text,a.text);
});

test('final enforcement caps validation and after-hook output, without claiming executed effects were rolled back',async()=>{
 let executed=0,before=0,after=0;const tool:AgentTool={name:'bounded',label:'bounded',description:'bounded',parameters:obj({n:int()}),resultBudget:{group:'g',minBytes:256,maxBytes:8192},execute:async()=>{executed++;return {content:[{type:'text',text:'ok'}],details:{}};}};
 const calls=[{type:'toolCall' as const,id:'bad',name:tool.name,arguments:{n:'bad'}},{type:'toolCall' as const,id:'valid',name:tool.name,arguments:{n:2}}];const agent=new Agent({streamFn:m=>completedStream(message(m,calls,'toolUse')),toolResultBudgets:{g:512},toolValidationFeedback:'bounded',initialState:{model:scriptedControlModel,tools:[tool]},beforeToolCall:async()=>{before++;return undefined;},afterToolCall:async()=>{after++;return {content:[{type:'text',text:'oversized-marker'.repeat(1000)}]};},finishTurn:()=>({action:'end'})});await agent.prompt('Run');const results=agent.state.messages.filter(m=>m.role==='toolResult');assert.equal(executed,1);assert.equal(before,1);assert.equal(after,1);assert.equal(results.length,2);assert.ok(results.every(r=>r.isError&&contentJsonBytes(r.content)<=256));assert.ok(results.reduce((n,r)=>n+contentJsonBytes(r.content),0)<=512);assert.ok(!JSON.stringify(results).includes('oversized-marker'));
});

test('infeasible group admission stops the Agent before any tool starts',async()=>{
 let executed=0,started=0;const reader:AgentTool={name:'bounded',label:'bounded',description:'bounded',parameters:obj({}),resultBudget:{group:'g',minBytes:256,maxBytes:8192},execute:async()=>{executed++;return {content:[],details:{}};}};const agent=new Agent({streamFn:m=>completedStream(message(m,[call('1',reader.name,{}),call('2',reader.name,{})],'toolUse')),toolResultBudgets:{g:256},initialState:{model:scriptedControlModel,tools:[reader]}});agent.subscribe(e=>{if(e.type==='tool_execution_start')started++;});await agent.prompt('Run');assert.equal(executed,0);assert.equal(started,0);assert.match(agent.state.errorMessage??'',/minimum/);assert.ok(!agent.state.isStreaming);assert.throws(()=>new Agent({streamFn:m=>completedStream(message(m,[])),toolResultBudgets:{g:1}}),/safe integers/);
});

test('a new assistant batch gets a fresh deterministic allocation',async()=>{
 const seen:number[]=[];let requests=0;const tool:AgentTool={name:'bounded',label:'bounded',description:'bounded',parameters:obj({}),resultBudget:{group:'g',minBytes:256,maxBytes:8192},execute:async(_id,_args,_signal,_update,execution)=>{seen.push(execution!.resultBudgetBytes);return {content:[{type:'text',text:'ok'}],details:{}};}};const agent=new Agent({streamFn:m=>{requests++;return completedStream(message(m,Array.from({length:requests===1?4:1},(_,i)=>call(requests+'-'+i,tool.name,{})),'toolUse'));},toolResultBudgets:{g:8192},initialState:{model:scriptedControlModel,tools:[tool]},finishTurn:()=>requests===2?{action:'end'}:undefined});await agent.prompt('Run two batches');assert.deepEqual(seen,[2048,2048,2048,2048,8192]);
});

test('low-level event streams settle on admission failure instead of leaving consumers waiting',async()=>{
 let executed=0;const tool:AgentTool={name:'bounded',label:'bounded',description:'bounded',parameters:obj({}),resultBudget:{group:'g',minBytes:256,maxBytes:8192},execute:async()=>{executed++;return {content:[],details:{}};}};
 const config={model:scriptedControlModel,convertToLlm:(messages:AgentMessage[])=>messages,toolResultBudgets:{g:256}};const provider:StreamFn=m=>completedStream(message(m,[call('one',tool.name,{}),call('two',tool.name,{})],'toolUse'));
 const streams=[agentLoop([{role:'user',content:'Run',timestamp:0}],{messages:[],tools:[tool]},config,undefined,provider),agentLoopContinue({messages:[{role:'user',content:'Run',timestamp:0}],tools:[tool]},config,undefined,provider)];
 for(const stream of streams){let timer:ReturnType<typeof setTimeout>|undefined;try{const messages=await Promise.race([stream.result(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Stream failed to settle')),2000);})]);const last=messages.at(-1);assert.ok(last?.role==='assistant'&&last.stopReason==='error');assert.match(last.errorMessage??'',/minimum/);assert.equal(executed,0);}finally{if(timer)clearTimeout(timer);}}
});

test('host recovery retains original-batch allocations instead of granting a fresh pool to remaining calls',async()=>{
 const f=await fixture();try{const job=f.store.create(f.dataset.id,'Recover four archived reads',8,1024,comparison),claim=f.store.claim(job.id);const store:ContextArtifactStore={put:async a=>{f.store.putContextArtifact(claim,a);},get:async id=>f.store.getContextArtifact(job.id,id)};const artifacts=await Promise.all(Array.from({length:4},(_,i)=>contextArtifact(JSON.stringify({note:`source${i} `+'x'.repeat(6000)}),'tool-result')));for(const a of artifacts)await store.put(a);const reader=createContextReadTool(store);const calls=artifacts.map((a,i)=>call('recover-'+i,reader.name,{artifact_id:a.id,json_pointers:['/note'],offset:0,limit:4096}));const assistant=message(scriptedControlModel,calls,'toolUse');const reservation=f.store.reserve(claim,'saved-read-batch',[reader.name,'request_clarification']);f.store.reply(claim,reservation.id,assistant);
  const prior=await Promise.all(calls.slice(0,2).map(async c=>{const value=await reader.execute(c.id,c.arguments as {artifact_id:string;json_pointers:string[];offset:number;limit:number},undefined,undefined,{resultBudgetBytes:2048});return {role:'toolResult' as const,toolCallId:c.id,toolName:c.name,content:value.content,isError:false,timestamp:1};}));f.store.messages(claim,[{role:'user',content:job.question,timestamp:0},assistant,...prior]);f.store.finish(claim,'paused');let requests=0;
  const stream:StreamFn=m=>{requests++;return completedStream(message(m,[call('clarify','request_clarification',{question:'Please review the restored read results.'})],'toolUse'));};const runner=new Runner(f.store,f.warehouse,stream,undefined,90000,65536,'budgeted');await runner.run(job.id);await runner.shutdown();assert.equal(requests,1);assert.equal(f.store.job(job.id).status,'clarification');const results=f.store.job(job.id).messages.filter(m=>m.role==='toolResult'&&m.toolName===reader.name);assert.equal(results.length,4);assert.ok(results.every(r=>contentJsonBytes(r.content)<=2048));assert.ok(results.reduce((n,r)=>n+contentJsonBytes(r.content),0)<=8192);
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
