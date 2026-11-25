import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { app } from '../src/server.js';
import { Runner } from '../src/runtime.js';
import { scriptedProvider } from '../src/demo.js';
import { comparison, fixture } from './fixtures.js';
test('HTTP workflow, strict request validation, origin guard, durable reload, report export and review binding',async()=>{
  const f=await fixture();const runner=new Runner(f.store,f.warehouse,scriptedProvider(comparison),undefined,90000,65536,'budgeted');const server=app(f.store,f.warehouse,runner,'scripted-control');
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;const url=`http://127.0.0.1:${port}`;
  const post=(path:string,value:unknown,origin=url)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(value)});
  try {
    assert.equal((await fetch(url)).status,200);
    assert.equal((await post('/api/jobs',{dataset:f.dataset.id,question:'Question',extra:true})).status,400);
    assert.equal((await post('/api/jobs',{dataset:f.dataset.id,question:'Question'},'http://evil.example')).status,400);
    const start=await post('/api/jobs',{dataset:f.dataset.id,question:'Compare October November net sales by country'});assert.equal(start.status,201);const job=await start.json() as {id:string};
    for(let i=0;i<60 && f.store.job(job.id).status!=='completed';i++)await new Promise(r=>setTimeout(r,50));
    const snapshot=await (await fetch(`${url}/api/jobs/${job.id}`)).json() as {job:{status:string};report:{id:string};calls:unknown[]};assert.equal(snapshot.job.status,'completed');assert.equal(snapshot.calls.length,4);
    const download=await fetch(`${url}/api/jobs/${job.id}/export`);const html=await download.text();assert.ok(html.includes('Result SHA256'));assert.ok(html.includes('Unreviewed'));
    assert.equal((await post(`/api/jobs/${job.id}/review`,{report_id:'stale-version',decision:'accepted',note:'TEST review'})).status,400);
    assert.equal((await post(`/api/jobs/${job.id}/review`,{report_id:snapshot.report.id,decision:'accepted',note:'TEST FIXTURE human route, no real human review claim'})).status,200);
    const state=await (await fetch(`${url}/api/jobs/${job.id}`)).json() as {review:{decision:string}};assert.equal(state.review.decision,'accepted');
    for(let i=0;i<510;i++)f.store.event(job.id,'control_noise',{i});
    const longHistory=await (await fetch(`${url}/api/jobs/${job.id}`)).json() as {events:{kind:string}[];context_policy:{selectedToolNames:string[]}};
    assert.equal(longHistory.events.length,500);assert.ok(longHistory.events.every(e=>e.kind==='control_noise'));assert.ok(longHistory.context_policy.selectedToolNames.includes('submit_investigation'));
    const ctl=new AbortController();const events=await fetch(`${url}/api/jobs/${job.id}/events?after=0`,{signal:ctl.signal});const reader=events.body?.getReader();assert.ok(reader);const chunk=await reader.read();assert.ok(new TextDecoder().decode(chunk.value).includes('id: '));ctl.abort();
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));f.store.close();await rm(f.root,{recursive:true,force:true});}
});
