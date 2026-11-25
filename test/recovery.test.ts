import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparison, fixture } from './fixtures.js';
import { Runner } from '../src/runtime.js';
import { scriptedProvider } from '../src/demo.js';
for (const point of ['assistant','tool']) test(`SIGKILL after durable ${point} barrier recovers in a new process owner`, async()=>{
  const f=await fixture();try{
    const job=f.store.create(f.dataset.id,`Recover ${point}`,8,1200,comparison);let logs='';
    const child=spawn(process.execPath,[fileURLToPath(new URL('./crash-worker.js',import.meta.url)),f.root,job.id,point],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>{logs+=String(c);});child.stderr.on('data',c=>{logs+=String(c);});
    const timer=setTimeout(()=>child.kill('SIGKILL'),20000);
    const outcome=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);
    assert.equal(outcome.signal,'SIGKILL',logs);assert.equal(await readFile(join(f.root,'crash-marker'),'utf8'),point);
    assert.equal(f.store.calls(job.id).length,2);assert.equal(f.store.evidence(job.id).length,point==='tool'?1:0);
    // Production recovery waits for the 15-second lease; the test deterministically expires the dead owner's lease.
    f.store.db.prepare('UPDATE jobs SET lease=0 WHERE id=?').run(job.id);
    await new Runner(f.store,f.warehouse,scriptedProvider(comparison)).run(job.id);
    assert.equal(f.store.job(job.id).status,'completed');assert.equal(f.store.calls(job.id).length,4);assert.equal(f.store.evidence(job.id).length,2);
    assert.equal(f.store.events(job.id).filter(e=>(e as {kind:string}).kind==='tool_committed').length,4);
  }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
