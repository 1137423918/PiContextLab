import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { comparison, fixture } from './fixtures.js';
import { Runner, completedStream, message } from '../src/runtime.js';
import { scriptedProvider } from '../src/demo.js';

test('recovery uses the response-bound tools beyond500events, ignoring older and newer trace selections',async()=>{
 const f=await fixture();try{
  const job=f.store.create(f.dataset.id,'Recover a rejected comparison call',8,1200,comparison);const claim=f.store.claim(job.id);
  const runner=new Runner(f.store,f.warehouse,scriptedProvider(comparison));
  f.store.recordContextPrepared(claim,{selectedToolNames:runner.tools(claim).map(t=>t.name)});
  for(let i=0;i<510;i++)f.store.event(job.id,'control_noise',{i});
  const assistant=message(runner.model,[{type:'toolCall',id:'forbidden-on-this-request',name:'compare_metric',arguments:comparison}],'toolUse');
  const call=f.store.reserve(claim,'controlled-restricted-response',['request_clarification']);f.store.reply(claim,call.id,assistant);
  f.store.messages(claim,[{role:'user',content:job.question,timestamp:job.created},{...assistant,thinkingLevel:'off'}]);
  // Neither the first UI event page nor a newer preparation represents the saved response.
  f.store.recordContextPrepared(claim,{selectedToolNames:['request_clarification']});
  f.store.recordContextPrepared(claim,{selectedToolNames:runner.tools(claim).map(t=>t.name)});
  f.store.db.prepare('UPDATE jobs SET lease=0 WHERE id=?').run(job.id);
  let requests=0;
  await new Runner(f.store,f.warehouse,model=>{requests++;return completedStream(message(model,[{type:'toolCall',id:'clarify-after-rejected-recovery',name:'request_clarification',arguments:{question:'Please confirm the investigation before continuing.'}}],'toolUse'));}).run(job.id);
  assert.equal(f.store.evidence(job.id).length,0);assert.equal(f.store.job(job.id).status,'clarification');assert.equal(requests,1);
  const result=f.store.job(job.id).messages.find(m=>m.role==='toolResult'&&m.toolCallId==='forbidden-on-this-request');assert.ok(result?.role==='toolResult'&&result.isError);
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('a completed reply cannot be reused with a different execution selection',async()=>{
 const f=await fixture();try{
  const job=f.store.create(f.dataset.id,'Selection-aware cache',2);const claim=f.store.claim(job.id);const call=f.store.reserve(claim,'same-input',['inspect_dataset']);
  f.store.reply(claim,call.id,{role:'assistant',content:[],stopReason:'stop'});
  assert.ok(f.store.reserve(claim,'same-input',['inspect_dataset']).reply);
  assert.throws(()=>f.store.reserve(claim,'same-input',['compare_metric']),/selection differs/);assert.equal(f.store.calls(job.id).length,1);
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('recovery pauses before execution and provider admission when saved assistant has no bound request',async()=>{
 const f=await fixture();try{
  const job=f.store.create(f.dataset.id,'Unbound saved response',8,1200,comparison);const claim=f.store.claim(job.id);const runner=new Runner(f.store,f.warehouse,scriptedProvider(comparison));
  f.store.messages(claim,[{role:'user',content:job.question,timestamp:job.created},message(runner.model,[{type:'toolCall',id:'unbound',name:'compare_metric',arguments:comparison}],'toolUse')]);
  f.store.recordContextPrepared(claim,{selectedToolNames:runner.tools(claim).map(t=>t.name)});f.store.db.prepare('UPDATE jobs SET lease=0 WHERE id=?').run(job.id);
  let requests=0;await new Runner(f.store,f.warehouse,m=>{requests++;return completedStream(message(m,[]));}).run(job.id);
  assert.equal(requests,0);assert.equal(f.store.evidence(job.id).length,0);assert.equal(f.store.job(job.id).status,'paused');assert.match(f.store.job(job.id).error??'',/Missing request-bound/);
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('persisted clarification beyond the first event page settles without another model call',async()=>{
 const f=await fixture();try{
  const job=f.store.create(f.dataset.id,'Clarification interrupted before settlement',8,1200,comparison);const claim=f.store.claim(job.id);
  for(let i=0;i<510;i++)f.store.event(job.id,'control_noise',{i});
  f.store.clarify(claim,'Which exact business definition should be used?');f.store.db.prepare('UPDATE jobs SET lease=0 WHERE id=?').run(job.id);
  let requests=0;await new Runner(f.store,f.warehouse,m=>{requests++;return completedStream(message(m,[]));}).run(job.id);
  assert.equal(requests,0);assert.equal(f.store.job(job.id).status,'clarification');assert.equal(f.store.calls(job.id).length,0);
  assert.ok(f.store.recentEvents(job.id).some(e=>(e as {kind:string}).kind==='clarification'));assert.ok(f.store.latestEvent(job.id,'clarification'));
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
