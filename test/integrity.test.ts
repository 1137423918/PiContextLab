import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import type { Model } from '@earendil-works/pi-ai';
import { comparison, fixture } from './fixtures.js';
import { hash } from '../src/domain.js';
import { scriptedControlModel, Runner } from '../src/runtime.js';
test('intake rejects hidden decimal rounding instead of accepting rounded money',async()=>{
 const f=await fixture();try{const csv=(await readFile(f.path,'utf8')).replace('0.1000','0.10001');const path=join(f.root,'precise.csv'),manifest=join(f.root,'precise.json');await writeFile(path,csv);await writeFile(manifest,JSON.stringify({csv_sha256:createHash('sha256').update(csv).digest('hex')}));await assert.rejects(f.warehouse.ingest(path,manifest),/precision beyond four/);}finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
test('evidence sealing rejects wrong periods, altered SQL and nonexistent references; repeated sealing is idempotent',async()=>{
 const f=await fixture();try{
  const job=f.store.create(f.dataset.id,'Integrity',8,1200,comparison);const claim=f.store.claim(job.id);const c=await f.warehouse.compare(f.dataset.id,comparison);
  f.store.bindRuntime(claim,{version:'test-v1'});f.store.bindRuntime(claim,{version:'test-v1'});assert.throws(()=>f.store.bindRuntime(claim,{version:'test-v2'}),/configuration changed/);
  const b=await f.warehouse.breakdown(f.dataset.id,{comparison:{...comparison,metric:'gross_sales'},dimension:'country',limit:5});
  f.store.commitTool(claim,'c',{}, {},c);f.store.commitTool(claim,'b',{}, {},b);
  const input={title:'Sealed',evidence_ids:[c.id,b.id],interpretation:'Descriptions only',hypotheses:[]};
  assert.throws(()=>f.store.submit(claim,input),/matching metric and period/);assert.throws(()=>f.store.submit(claim,{...input,evidence_ids:['missing']}),/Missing/);
  const corrupt={...c,sql:'SELECT fabricated'};f.store.db.prepare('UPDATE evidence SET payload=? WHERE job=? AND id=?').run(JSON.stringify(corrupt),job.id,c.id);assert.throws(()=>f.store.submit(claim,{...input,evidence_ids:[c.id]}),/identity mismatch/);
  f.store.db.prepare('UPDATE evidence SET payload=? WHERE job=? AND id=?').run(JSON.stringify(c),job.id,c.id);const report=f.store.submit(claim,{...input,evidence_ids:[c.id]});assert.equal(f.store.submit(claim,{...input,evidence_ids:[c.id]}).id,report.id);assert.throws(()=>f.store.submit(claim,{...input,title:'Changed',evidence_ids:[c.id]}),/already sealed/);
  assert.equal(hash(comparison),hash({basis:comparison.basis,current:comparison.current,baseline:comparison.baseline,metric:comparison.metric}));
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
test('real Pi OpenAI-compatible adapter sends one HTTP attempt for 503, with retries disabled',async()=>{
 const f=await fixture();let requests=0;const server=createServer((_req,res)=>{requests++;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Controlled unavailable'}}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const model={...scriptedControlModel,baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`};const runner=new Runner(f.store,f.warehouse,(m,c,o)=>streamSimple(m as Model<'openai-completions'>,c,{...o,apiKey:'test-only',maxRetries:0}),model);const job=f.store.create(f.dataset.id,'Investigate',1);await runner.run(job.id);assert.equal(requests,1);assert.equal(f.store.calls(job.id).length,1);assert.equal(f.store.job(job.id).status,'failed');assert.ok(f.store.job(job.id).error);}finally{await new Promise<void>(r=>server.close(()=>r()));f.store.close();await rm(f.root,{recursive:true,force:true});}
});
