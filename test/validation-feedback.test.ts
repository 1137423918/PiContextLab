import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { Agent,runToolCall,boundedToolValidationError,VALIDATION_FEEDBACK_MAX_BYTES,type AgentTool,type StreamFn } from '@earendil-works/pi-agent-core';
import { obj,str,int } from '@earendil-works/pi-schema';
import { message,scriptedControlModel,completedStream,Runner } from '../src/runtime.js';
import { fixture,comparison } from './fixtures.js';

const contentBytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
const emptyContext={messages:[]};

test('bounded rejection omits the argument dump, preserves input and blocks execution and hooks',async()=>{
 let executions=0,hooks=0;const tool:AgentTool={name:'save',label:'Save',description:'Save',parameters:obj({body:str({maxLength:64})}),execute:async()=>{executions++;return {content:[],details:{}};}};
 const call={type:'toolCall' as const,id:'invalid',name:'save',arguments:{body:'source-marker '+ 'a'.repeat(12000)}};const original=JSON.stringify(call);const assistant=message(scriptedControlModel,[call],'toolUse');
 const options={tools:[tool],assistantMessage:assistant,context:emptyContext,beforeToolCall:async()=>{hooks++;return undefined;},afterToolCall:async()=>{hooks++;return undefined;}};
 const legacy=await runToolCall(call,options),bounded=await runToolCall(call,{...options,toolValidationFeedback:'bounded'});assert.ok(legacy.isError&&bounded.isError);assert.equal(executions,0);assert.equal(hooks,0);assert.equal(JSON.stringify(call),original);assert.ok(contentBytes(legacy.result.content)>12000);assert.ok(contentBytes(bounded.result.content)<=2048);
 const text=bounded.result.content[0];assert.ok(text?.type==='text');const feedback=JSON.parse(text.text) as {diagnostic:string;fields:{code_points:number}[];received_arguments_omitted:boolean};assert.match(feedback.diagnostic,/body/);assert.equal(feedback.fields[0]?.code_points,12014);assert.ok(feedback.received_arguments_omitted);assert.ok(!text.text.includes('source-marker'));assert.ok(contentBytes(bounded.result.details)<200);
});

test('valid prepareArguments and upstream coercion still execute cloned args and both hooks',async()=>{
 let executions=0,hooks=0;const tool:AgentTool={name:'number',label:'Number',description:'Number',parameters:obj({n:int()}),prepareArguments:args=>({n:(args as {old:unknown}).old}),execute:async(_id,args)=>{executions++;assert.deepEqual(args,{n:4});return {content:[{type:'text',text:'4'}],details:{}};}};
 const call={type:'toolCall' as const,id:'valid',name:'number',arguments:{old:'4'}};const outcome=await runToolCall(call,{tools:[tool],assistantMessage:message(scriptedControlModel,[call],'toolUse'),context:emptyContext,toolValidationFeedback:'bounded',beforeToolCall:async()=>{hooks++;return undefined;},afterToolCall:async()=>{hooks++;return undefined;}});assert.ok(!outcome.isError);assert.equal(executions,1);assert.equal(hooks,2);assert.deepEqual(call.arguments,{old:'4'});
});

test('unknown, aborted and preparation failures retain their original stage and skip schema feedback',async()=>{
 const tool:AgentTool={name:'prepare',label:'Prepare',description:'Prepare',parameters:obj({}),prepareArguments:()=>{throw new Error('prepare-stage-error');},execute:async()=>{throw new Error('must not execute');}};const call={type:'toolCall' as const,id:'stage',name:'prepare',arguments:{}};
 const options={tools:[tool],assistantMessage:message(scriptedControlModel,[call],'toolUse'),context:emptyContext,toolValidationFeedback:'bounded' as const};const prepared=await runToolCall(call,options);assert.deepEqual(prepared.result.content,[{type:'text',text:'prepare-stage-error'}]);
 const missing=await runToolCall({...call,name:'missing'},options);assert.deepEqual(missing.result.content,[{type:'text',text:'Tool missing not found'}]);const aborted=await runToolCall(call,{...options,signal:AbortSignal.abort()});assert.deepEqual(aborted.result.content,[{type:'text',text:'Operation aborted'}]);
});

test('Unicode and escaped diagnostics are valid bounded JSON with explicit truncation and no argument dump',()=>{
 const args=Object.fromEntries(Array.from({length:12},(_,i)=>['field_'+i+'🧪'.repeat(15),'secret-value-marker']));const result=boundedToolValidationError(new Error(('字段🧪"\n\t'.repeat(1500))+'\n\nReceived arguments:\nARGUMENT_DUMP_MARKER'),args);assert.equal(result.isError,true);assert.ok(contentBytes(result.content)<=VALIDATION_FEEDBACK_MAX_BYTES);const first=result.content[0];assert.ok(first?.type==='text');const payload=JSON.parse(first.text) as {diagnostic:string;diagnostic_truncated:boolean;fields_omitted:number};assert.ok(payload.diagnostic_truncated);assert.ok(payload.fields_omitted>=4);assert.ok(!first.text.includes('ARGUMENT_DUMP_MARKER'));assert.ok(!first.text.includes('secret-value-marker'));assert.equal(Buffer.from(payload.diagnostic).toString('utf8'),payload.diagnostic);
});

test('native sequential and parallel loops can use bounded feedback while retaining the original assistant call',async()=>{
 for(const toolExecution of ['sequential','parallel'] as const){let requests=0,executions=0;const bad='x'.repeat(4097);const tool:AgentTool={name:'save',label:'Save',description:'Save short text',parameters:obj({body:str({maxLength:64})}),execute:async()=>{executions++;return {content:[{type:'text',text:'done'}],details:{}};}};
  const stream:StreamFn=model=>{requests++;return completedStream(message(model,[{type:'toolCall',id:'call-'+requests,name:'save',arguments:{body:requests===1?bad:'fixed'}}],'toolUse'));};
  const agent=new Agent({streamFn:stream,toolExecution,toolValidationFeedback:'bounded',initialState:{model:scriptedControlModel,tools:[tool]},finishTurn:()=>executions?{action:'end'}:undefined});await agent.prompt('Save short text');assert.equal(requests,2);assert.equal(executions,1);const original=agent.state.messages.find(m=>m.role==='assistant');assert.ok(original?.role==='assistant');assert.deepEqual(original.content[0],{type:'toolCall',id:'call-1',name:'save',arguments:{body:bad}});const error=agent.state.messages.find(m=>m.role==='toolResult'&&m.isError);assert.ok(error?.role==='toolResult');assert.ok(contentBytes(error.content)<=2048);
 }
});

test('host recovery applies the same bounded validation setting without executing invalid report submission',async()=>{
 const f=await fixture();try{const job=f.store.create(f.dataset.id,'Recovery validation feedback',4,1024,comparison),claim=f.store.claim(job.id);const args={title:'Recovery',evidence_ids:['invalid-evidence'],interpretation:'x'.repeat(5000),hypotheses:[]};f.store.messages(claim,[{role:'user',content:job.question,timestamp:0},message(scriptedControlModel,[{type:'toolCall',id:'recover-invalid',name:'submit_investigation',arguments:args}],'toolUse')]);f.store.finish(claim,'paused');
  const stream:StreamFn=model=>completedStream(message(model,[{type:'toolCall',id:'clarify',name:'request_clarification',arguments:{question:'Please review the invalid report arguments.'}}],'toolUse'));const runner=new Runner(f.store,f.warehouse,stream);await runner.run(job.id);await runner.shutdown();const saved=f.store.job(job.id);assert.equal(saved.status,'clarification');assert.equal(f.store.report(job.id),null);const error=saved.messages.find(m=>m.role==='toolResult'&&m.toolCallId==='recover-invalid');assert.ok(error?.role==='toolResult'&&error.isError);assert.ok(contentBytes(error.content)<=2048);
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
