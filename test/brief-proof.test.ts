import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { contentJsonBytes } from '@earendil-works/pi-agent-core';
import { BriefRunner } from '../src/brief-client.js';
import { BriefClaimError,verifyBriefClaims,briefProofMatches } from '../src/brief-proof.js';
import { hash } from '../src/domain.js';
import { completedStream,message,Runner } from '../src/runtime.js';
import { exportReport } from '../src/report.js';
import type { BriefBody } from '../src/brief-schema.js';
import { proofFixture } from './brief-proof-fixture.js';

test('source proof checks exact values and raw group priorities, and is bound into the sealed report identity',async()=>{
 const f=await proofFixture();try{const proof=verifyBriefClaims(f.body,f.evidence,f.dataset.id,f.intent);assert.equal(proof.policy,'brief-source-claims-v1');assert.deepEqual(proof.verified_fields,['facts','priorities','check']);const report=f.store.submit(f.claim,f.submission,(e,j,intent)=>verifyBriefClaims(f.body,e,j.dataset,intent));assert.equal(briefProofMatches(report),true);assert.ok(report.claims_proof);assert.equal(f.store.submit(f.claim,f.submission,(e,j,intent)=>verifyBriefClaims(f.body,e,j.dataset,intent)).id,report.id);assert.equal(f.store.reviewFor(report.id),null);
  for(const mutate of [(r:typeof report)=>{r.interpretation=r.interpretation.replace('7.2050','7.2051');},(r:typeof report)=>{r.claims_proof!.verified_fields=['facts','priorities','check'];r.claims_proof!.claims_sha256='0'.repeat(64);},(r:typeof report)=>{r.hypotheses.push('Changed after sealing');},(r:typeof report)=>{r.evidence[0]!.rows[0]!.value='999';}]){const copy=structuredClone(report);mutate(copy);assert.equal(briefProofMatches(copy),false);}
  assert.ok(exportReport(report,null).includes('id="claims-proof"'));const changed=structuredClone(report);changed.interpretation='{}';assert.ok(!exportReport(changed,null).includes('id="claims-proof"'));
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('wrong values, directions, evidence bindings, maximum groups and arithmetic sources cannot pass',async()=>{
 const f=await proofFixture();try{
  const mutations:((b:BriefBody)=>void)[]=[b=>{b.facts[0]!.current='14.1001';},b=>{b.facts[1]!.direction='increase';},b=>{b.facts[0]!.evidence_id=f.evidence[3]!.id;},b=>{b.facts[1]!.metric='gross_sales';},b=>{b.priorities[0]!.group='FR';b.priorities[0]!.delta='-6.0000';},b=>{b.priorities[1]!.group='NO_SUCH_GROUP';},b=>{b.priorities[0]!.delta='999';},b=>{b.check.current='7.0501';},b=>{b.check.source_evidence_ids[0]=f.evidence[3]!.id;},b=>{b.check.name='gross_minus_returns';},b=>{b.facts[0]!.baseline='not-a-number';}];
  for(const mutate of mutations){const copy=structuredClone(f.body);mutate(copy);assert.throws(()=>verifyBriefClaims(copy,f.evidence,f.dataset.id,f.intent),BriefClaimError);}
  assert.throws(()=>verifyBriefClaims(f.body,f.evidence,'ds_'+'0'.repeat(24),f.intent),BriefClaimError);assert.throws(()=>verifyBriefClaims(f.body,f.evidence,f.dataset.id,{...f.intent,current:{start:'2011-09-01',end:'2011-10-01'}}),BriefClaimError);
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('self-consistent source hashes do not hide contradictory saved rows and result totals',async()=>{
 const f=await proofFixture();try{for(const index of [0,3]){const evidence=structuredClone(f.evidence),body=structuredClone(f.body),e=evidence[index]!;const old=e.id;e.rows[0]!.value='999.0000';e.result_sha256=hash({rows:e.rows,result:e.result});const {id:_id,...payload}=e;e.id='ev_'+hash(payload);for(const fact of body.facts)if(fact.evidence_id===old)fact.evidence_id=e.id;for(const priority of body.priorities)if(priority.evidence_id===old)priority.evidence_id=e.id;body.check.source_evidence_ids=body.check.source_evidence_ids.map(id=>id===old?e.id:id);assert.throws(()=>verifyBriefClaims(body,evidence,f.dataset.id,f.intent),BriefClaimError);}}
 finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('null groups and tied maximum contributions are valid source-backed priorities',async()=>{
 const f=await proofFixture();try{const evidence=structuredClone(f.evidence),e=evidence[3]!,body=structuredClone(f.body);for(const row of e.rows)if(row.period==='current'){if(row.dimension==='UK')row.value='7.6525';if(row.dimension===null)row.value='6.4475';}const result=e.result as {top:unknown[];other:unknown};result.top=[{dimension:'UK',baseline:'1.2050',current:'7.6525',delta:'6.4475'},{dimension:null,baseline:'0.0000',current:'6.4475',delta:'6.4475'}];result.other={groups:1,baseline:'6.0000',current:'0.0000',delta:'-6.0000'};e.result_sha256=hash({rows:e.rows,result:e.result});const {id:_id,...payload}=e;e.id='ev_'+hash(payload);body.priorities[0]!.evidence_id=e.id;body.priorities[0]!.delta='6.4475';assert.equal(verifyBriefClaims(body,evidence,f.dataset.id,f.intent).policy,'brief-source-claims-v1');body.priorities[0]!.group=null;assert.equal(verifyBriefClaims(body,evidence,f.dataset.id,f.intent).policy,'brief-source-claims-v1');}
 finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('a rejected native submit leaves no sealed report or tool cache; a new valid call can complete inside the original budget',async()=>{
 const f=await proofFixture();try{f.store.finish(f.claim,'paused');let requests=0;const bad=structuredClone(f.body);bad.priorities[0]!.delta='999.0000';const before=JSON.stringify(bad);const runner=new BriefRunner(f.store,f.warehouse,(model,context)=>{requests++;if(requests===2){assert.equal(f.store.report(f.job.id),null);const result=context.messages.at(-1);assert.ok(result?.role==='toolResult'&&result.isError);const text=JSON.stringify(result.content);assert.ok(text.includes('INVALID_BRIEF_CLAIMS'));assert.ok(!text.includes('6.8950'));}return completedStream(message(model,[{type:'toolCall',id:requests===1?'bad-submit':'corrected-submit',name:'submit_investigation',arguments:{title:'Native proof fixture',evidence_ids:f.evidence.map(e=>e.id),brief:requests===1?bad:f.body,hypotheses:[]}}],'toolUse'));});await runner.run(f.job.id);assert.equal(requests,2);assert.equal(f.store.calls(f.job.id).length,2);const job=f.store.job(f.job.id);assert.equal(job.status,'completed');const report=f.store.report(f.job.id)!;assert.equal(briefProofMatches(report),true);assert.equal(JSON.stringify(bad),before);assert.equal(f.store.db.prepare('SELECT count(*) n FROM tools WHERE job=? AND call_id=?').get(f.job.id,'bad-submit')?.n,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM reports WHERE job=?').get(f.job.id)?.n,1);assert.equal(f.store.reviewFor(report.id),null);const config=f.store.db.prepare('SELECT payload FROM runtime_configs WHERE job=?').get(f.job.id);assert.equal(JSON.parse(String(config?.payload)).application_policy,'brief-source-claims-v1');}
 finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('failed report insertion rolls back sealing/proof together, without changing the existing evidence',async()=>{
 const f=await proofFixture();try{const before=JSON.stringify(f.store.evidence(f.job.id));f.store.db.exec("CREATE TRIGGER fail_report BEFORE INSERT ON reports BEGIN SELECT RAISE(ABORT,'forced insert failure');END");assert.throws(()=>f.store.submit(f.claim,f.submission,(e,j,intent)=>verifyBriefClaims(f.body,e,j.dataset,intent)),/forced insert failure/);assert.equal(f.store.report(f.job.id),null);assert.equal(f.store.latestEvent(f.job.id,'report_sealed'),null);assert.equal(JSON.stringify(f.store.evidence(f.job.id)),before);f.store.db.exec('DROP TRIGGER fail_report');assert.equal(briefProofMatches(f.store.submit(f.claim,f.submission,(e,j,intent)=>verifyBriefClaims(f.body,e,j.dataset,intent))),true);}
 finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('source proof diagnostics are bounded and do not echo supplied or expected numeric values',async()=>{
 const f=await proofFixture();try{const body=structuredClone(f.body);for(const fact of body.facts){fact.baseline='999999.0001';fact.current='999999.0001';fact.delta='999999.0001';}try{verifyBriefClaims(body,f.evidence,f.dataset.id,f.intent);assert.fail('Expected rejection');}catch(error){assert.ok(error instanceof BriefClaimError);assert.ok(contentJsonBytes([{type:'text',text:error.message}])<=2048);assert.ok(!error.message.includes('999999'));assert.ok(!error.message.includes('7.2050'));assert.ok(error.issues.length<=8);}const extreme=new BriefClaimError([{path:'🧪'.repeat(4000),code:'x'.repeat(4000)}]);assert.ok(contentJsonBytes([{type:'text',text:extreme.message}])<=2048);}
 finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('legacy report path remains unverified, and stale/cross-job submissions cannot obtain a proof',async()=>{
 const f=await proofFixture();try{const legacy=f.store.submit(f.claim,f.submission);assert.equal(legacy.claims_proof,undefined);assert.equal(briefProofMatches(legacy),false);assert.ok(!exportReport(legacy,null).includes('id="claims-proof"'));f.store.finish(f.claim,'paused');const other=f.store.create(f.dataset.id,'Other job scope',8,1536,f.intent),claim=f.store.claim(other.id);assert.throws(()=>f.store.submit(claim,f.submission,(e,j,intent)=>verifyBriefClaims(f.body,e,j.dataset,intent)),/evidence/);assert.equal(f.store.report(other.id),null);assert.throws(()=>f.store.submit({...claim,epoch:claim.epoch-1},f.submission,(e,j,intent)=>verifyBriefClaims(f.body,e,j.dataset,intent)),/Stale writer/);}
 finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('a legacy cached tool result cannot bypass the new source-proof policy',async()=>{
 const f=await proofFixture();try{const base=new Runner(f.store,f.warehouse,m=>completedStream(message(m,[]))),oldTool=base.tools(f.claim).find(t=>t.name==='submit_investigation');assert.ok(oldTool);await oldTool.execute('legacy-cache',f.submission);const original=f.store.report(f.job.id)!;assert.equal(original.claims_proof,undefined);const current=new BriefRunner(f.store,f.warehouse,m=>completedStream(message(m,[]))),tool=current.tools(f.claim).find(t=>t.name==='submit_investigation');assert.ok(tool);await assert.rejects(tool.execute('legacy-cache',{title:f.submission.title,evidence_ids:f.submission.evidence_ids,brief:f.body,hypotheses:[]}),/CACHED_REPORT_UNVERIFIED/);assert.equal(f.store.report(f.job.id)?.id,original.id);assert.equal(f.store.report(f.job.id)?.claims_proof,undefined);}
 finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('old structured runtime fingerprints pause before provider calls under the stronger policy',async()=>{
 const f=await proofFixture();try{f.store.finish(f.claim,'paused');await new BriefRunner(f.store,f.warehouse,m=>completedStream(message(m,[]))).run(f.job.id);const row=f.store.db.prepare('SELECT payload FROM runtime_configs WHERE job=?').get(f.job.id),payload=JSON.parse(String(row?.payload)) as Record<string,unknown>;assert.equal(payload.application_policy,'brief-source-claims-v1');delete payload.application_policy;f.store.db.prepare('UPDATE runtime_configs SET fingerprint=?,payload=? WHERE job=?').run(hash(payload),JSON.stringify(payload),f.job.id);f.store.db.prepare("UPDATE jobs SET status='paused' WHERE id=?").run(f.job.id);let requests=0;await new BriefRunner(f.store,f.warehouse,m=>{requests++;return completedStream(message(m,[]));}).run(f.job.id);assert.equal(requests,0);assert.equal(f.store.job(f.job.id).status,'paused');assert.match(f.store.job(f.job.id).error??'',/Runtime configuration changed/);assert.equal(f.store.report(f.job.id),null);}
 finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
