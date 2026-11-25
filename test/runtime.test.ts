import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { Runner, completedStream, message } from '../src/runtime.js';
import { scriptedProvider } from '../src/demo.js';
import { comparison, fixture } from './fixtures.js';
import { Store } from '../src/store.js';
import { join } from 'node:path';
import { hash } from '../src/domain.js';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
test('actual Pi runtime drives four tools, seals evidence, reuses tools and binds human review', async () => {
  const f = await fixture(); try {
    const job = f.store.create(f.dataset.id,'Compare October and November net sales by country.',8,1200,comparison);
    await new Runner(f.store,f.warehouse,scriptedProvider(comparison)).run(job.id);
    assert.equal(f.store.job(job.id).status,'completed'); assert.equal(f.store.calls(job.id).length,4); const report=f.store.report(job.id); assert.ok(report); assert.equal(report.evidence.length,2); assert.equal(f.store.reviewFor(report.id),null);
    assert.throws(()=>f.store.review(job.id,'wrong','accepted','Human check complete'),/version/); f.store.review(job.id,report.id,'accepted','TEST FIXTURE review, not a real human approval'); assert.ok(f.store.reviewFor(report.id));
    assert.equal(f.store.events(job.id).filter(e=>(e as {kind:string}).kind==='tool_committed').length,4);
  } finally {f.store.close();await rm(f.root,{recursive:true,force:true});}
});
test('unknown pending request stays charged across connections; stale owner fenced; completed reply reused', async()=>{
  const f=await fixture();try{
    const job=f.store.create(f.dataset.id,'Budget recovery',2);const a=f.store.claim(job.id);f.store.reserve(a,'request-1');
    assert.throws(()=>f.store.claim(job.id),/active writer/);
    f.store.db.prepare('UPDATE jobs SET lease=0 WHERE id=?').run(job.id);const other=new Store(join(f.root,'jobs.sqlite'));
    try {const b=other.claim(job.id);assert.equal((other.calls(job.id)[0] as {status:string}).status,'unknown');assert.throws(()=>f.store.messages(a,[]),/Stale writer/);const r=other.reserve(b,'request-2');other.reply(b,r.id,{saved:true});assert.deepEqual(other.reserve(b,'request-2').reply,{saved:true});assert.throws(()=>other.reserve(b,'request-3'),/budget exhausted/);}finally{other.close();}
  }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
test('restart reconciles committed assistant tools through Pi with cached results, without an extra provider request',async()=>{
  const f=await fixture();try{
    const job=f.store.create(f.dataset.id,'Recover assistant batch',8,1200,comparison);const c=f.store.claim(job.id);const runner=new Runner(f.store,f.warehouse,scriptedProvider(comparison));
    const tools=runner.tools(c);const compareTool=tools.find(t=>t.name==='compare_metric');assert.ok(compareTool);
    const assistant=message(runner.model,[{type:'toolCall',id:'recovered-compare',name:'compare_metric',arguments:comparison}], 'toolUse');
    f.store.messages(c,[{role:'user',content:job.question,timestamp:Date.now()},assistant]);
    f.store.event(job.id,'context_prepared',{selectedToolNames:tools.map(t=>t.name)});
    const reserved=f.store.reserve(c,'controlled-before-crash',tools.map(t=>t.name));f.store.reply(c,reserved.id,assistant);
    const e=await f.warehouse.compare(f.dataset.id,comparison);const output={content:[{type:'text',text:JSON.stringify({id:e.id,result:e.result})}],details:{id:e.id}};
    f.store.commitTool(c,'recovered-compare',{name:'compare_metric',input:comparison},output,e);
    f.store.db.prepare('UPDATE jobs SET lease=0 WHERE id=?').run(job.id);
    let requests=0;const recovery=new Runner(f.store,f.warehouse,(model,context)=>{requests++;const ids=context.messages.filter(m=>m.role==='toolResult').flatMap(m=>{const text=m.content.find(c=>c.type==='text');const d=JSON.parse(text?.type==='text'?text.text:'{}') as {id?:string};return d.id?[d.id]:[]});return completedStream(message(model,[{type:'toolCall',id:'final',name:'submit_investigation',arguments:{title:'Recovered',evidence_ids:ids,interpretation:'Control',hypotheses:[]}}],'toolUse'));});
    await recovery.run(job.id);assert.equal(f.store.job(job.id).status,'completed');assert.equal(requests,1);assert.equal(f.store.evidence(job.id).length,1);
    assert.equal(hash(f.store.report(job.id)?.evidence[0]?.request),hash(comparison));
  }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
test('cancellation is durable and prevents further provider reservation',async()=>{
  const f=await fixture();try{const job=f.store.create(f.dataset.id,'Cancel');const c=f.store.claim(job.id);f.store.cancel(job.id);assert.throws(()=>f.store.reserve(c,'x'),/Cancelled/);assert.throws(()=>f.store.claim(job.id));assert.equal(f.store.job(job.id).status,'cancelled');}finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
test('graceful shutdown pauses an in-flight request; explicit resume charges the aborted attempt and completes',async()=>{
 const f=await fixture();try{
  const job=f.store.create(f.dataset.id,'Pause then recover',8,1200,comparison);let started!:()=>void;const ready=new Promise<void>(r=>{started=r;});
  const runner=new Runner(f.store,f.warehouse,(model,_context,options)=>{const stream=createAssistantMessageEventStream();started();options?.signal?.addEventListener('abort',()=>{const reply=message(model,[],'aborted');reply.errorMessage='Controlled shutdown';stream.push({type:'error',reason:'aborted',error:reply});stream.end(reply);},{once:true});return stream;});
  const pending=runner.run(job.id);await ready;await runner.shutdown();await pending;assert.equal(f.store.job(job.id).status,'paused');assert.equal(f.store.calls(job.id).length,1);
  await new Runner(f.store,f.warehouse,scriptedProvider(comparison)).run(job.id);assert.equal(f.store.job(job.id).status,'completed');assert.equal(f.store.calls(job.id).length,5);
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
test('an ambiguous user request cannot expose query/report tools or invent its own date contract',async()=>{
 const f=await fixture();try{
  const job=f.store.create(f.dataset.id,'最近经营情况怎么样？');let step=0;
  const runner=new Runner(f.store,f.warehouse,model=>completedStream(message(model,[step++===0?{type:'toolCall',id:'invented',name:'compare_metric',arguments:comparison}:{type:'toolCall',id:'clarify',name:'request_clarification',arguments:{question:'Which metric and exact date ranges should I compare?'}}],'toolUse')));
  await runner.run(job.id);assert.equal(f.store.job(job.id).status,'clarification');assert.equal(f.store.evidence(job.id).length,0);assert.equal(f.store.intent(job.id),null);assert.ok(f.store.job(job.id).messages.some(m=>m.role==='toolResult'&&m.toolName==='compare_metric'&&m.isError));
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
test('a model cannot substitute different periods for an explicitly bound comparison',async()=>{
 const f=await fixture();try{const job=f.store.create(f.dataset.id,'Fixed periods',8,1200,comparison);const changed={...comparison,basis:'equal_days' as const,baseline:{start:'2011-10-02',end:'2011-10-03'},current:{start:'2011-11-02',end:'2011-11-03'}};await new Runner(f.store,f.warehouse,m=>completedStream(message(m,[{type:'toolCall',id:'changed',name:'compare_metric',arguments:changed}],'toolUse'))).run(job.id);assert.equal(f.store.job(job.id).status,'clarification');assert.equal(f.store.evidence(job.id).length,0);}finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
