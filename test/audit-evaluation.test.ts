import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { comparison,fixture } from './fixtures.js';
import { auditExpected,gradeAudit } from '../scripts/audit-evaluation.js';

test('provenance grader derives labels from matching validated evidence and rejects partial/wrong answers',async()=>{
 const f=await fixture();try{
  const job=f.store.create(f.dataset.id,'Audit grading control',8,1200,comparison);const claim=f.store.claim(job.id);
  const c=await f.warehouse.compare(f.dataset.id,comparison),b=await f.warehouse.breakdown(f.dataset.id,{comparison,dimension:'country',limit:5});
  for(const e of [c,b])f.store.commitTool(claim,e.id,{controlled:true},{},e);
  const report=f.store.submit(claim,{title:'Control provenance',evidence_ids:[c.id,b.id],interpretation:'Synthetic grading fixture',hypotheses:[]});
  const expected=auditExpected(report,comparison,'country',5);assert.equal(expected.breakdown_result_sha256,b.result_sha256);assert.equal(expected.dataset_id,f.dataset.id);assert.throws(()=>auditExpected(report,comparison,'country',4),/lacks/);
  assert.equal(gradeAudit(JSON.stringify(expected),expected).passed,true);assert.equal(gradeAudit('```json\n'+JSON.stringify({...expected,extra:'allowed'})+'\n```',expected).passed,true);
  assert.equal(gradeAudit(JSON.stringify({...expected,breakdown_result_sha256:c.result_sha256}),expected).passed,false);
  assert.equal(gradeAudit(JSON.stringify({...expected,current_end:null}),expected).passed,false);assert.equal(gradeAudit('Explanation '+JSON.stringify(expected),expected).passed,false);
  const corrupted={...report,evidence:report.evidence.map(e=>e.id===b.id?{...e,result_sha256:'wrong'}:e)};assert.throws(()=>auditExpected(corrupted,comparison,'country'),/identity mismatch/);
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

test('audit source gate rejects missing breakdowns and different metric/period/dimension rather than substituting old evidence',async()=>{
 const f=await fixture();try{
  const job=f.store.create(f.dataset.id,'Audit source gate control',8,1200,comparison);const claim=f.store.claim(job.id);const c=await f.warehouse.compare(f.dataset.id,comparison);f.store.commitTool(claim,c.id,{controlled:true},{},c);
  const report=f.store.submit(claim,{title:'Comparison only',evidence_ids:[c.id],interpretation:'Synthetic fixture',hypotheses:[]});
  assert.throws(()=>auditExpected(report,comparison,'country'),/lacks/);assert.throws(()=>auditExpected(report,{...comparison,metric:'returns'},'stock_code'),/lacks/);
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});
